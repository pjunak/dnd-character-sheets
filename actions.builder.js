export const BUILDER_ACTIONS = Object.freeze(['builderField','builderAbility','builderToggleManual','builderAbilitySet','builderClassSet','builderLevelSet','builderSubclassSet','builderAddClass','builderRemoveClass','builderTab','builderTabKey','builderNavigate','builderToggleLevel','builderExtraFeatAdd','builderExtraFeatRemove','builderAsiSet','builderChoose']);

export function registerBuilderActions(deps) {
  const { host, plural, num, uid, ABILITIES, pointBuyFor, pointCost, pointsSpent, uiState, sheetOf, getRules } = deps;
  const { builderMutate, reconcile, builderModel } = deps.engine;
  const register = (name, fn) => host.registerAction(name, fn);
  const timers = new Set();
  const later = (fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, 0); timers.add(id); };
  // ── Builder (engine mode) — edit the rich decision model + materialize ────
  const applyChoice = (sheet, engine, change) => {
    if (!engine) return;
    const next = engine.applyBuilderChoice(sheet, change);
    sheet.featureChoices = { ...(next.featureChoices || {}) };
    sheet.abilityGrants = Array.isArray(next.abilityGrants) ? next.abilityGrants : [];
  };

  register('builderField', (cid, field, value) => {
    builderMutate(cid, (s, engine) => {
      s[field] = String(value);
      if (field === 'race') s.lineage = '';
      if (engine) reconcile(s, engine);
    });
  });
  register('builderAbility', (cid, ability, value) => {
    if (!ABILITIES.includes(String(ability))) return;
    builderMutate(cid, (s, engine) => {
      const range = engine.getBuilderPlan(s).abilityScoreRange;
      s.baseStats = {
        ...(s.baseStats || {}),
        [ability]: Math.max(range.min, Math.min(range.max, num(value, 10))),
      };
    });
  });
  // Toggle point-buy ↔ manual base scores. Leaving manual (→ point buy) clamps
  // each base into the 8–15 point-buy range so the pool math stays valid.
  register('builderToggleManual', (cid) => {
    builderMutate(cid, (s, engine) => {
      const on = !s.manualScores;
      s.manualScores = on;
      if (!on) {
        const pointBuy = pointBuyFor(engine);
        const base = { ...(s.baseStats || {}) };
        for (const a of ABILITIES) base[a] = Math.max(pointBuy.min, Math.min(pointBuy.max, num(base[a], pointBuy.min)));
        s.baseStats = base;
      }
    });
  });
  // Point-buy set: the host `.codex-stepper` input fires change with the new
  // score; clamp to the point-buy floor/ceiling, then step down until within the
  // 27-point budget.
  register('builderAbilitySet', (cid, ability, value) => {
    if (ABILITIES.indexOf(ability) < 0) return;
    let left = null;   // remaining point-buy budget, captured post-clamp
    builderMutate(cid, (s, engine) => {
      const pointBuy = pointBuyFor(engine);
      const base = { ...(s.baseStats || {}) };
      const cur = num(base[ability], pointBuy.min);
      let next = Math.max(pointBuy.min, Math.min(pointBuy.max, num(value, pointBuy.min)));
      while (next > pointBuy.min && (pointsSpent(base, engine) - pointCost(cur, engine) + pointCost(next, engine)) > pointBuy.budget) next--;
      base[ability] = next;
      s.baseStats = base;
      left = pointBuy.budget - pointsSpent(base, engine);
    });
    // Announce the new remaining budget through the HOST's persistent live
    // region — the full-panel re-render destroys any in-page live region, so
    // this is what actually reaches screen readers. Feature-detected.
    if (left != null && typeof host.ui.announce === 'function') host.ui.announce(plural('builder.pointsLeft', left));
  });
  // Structural edits (class/level/subclass/remove) can orphan level- or
  // owner-scoped decisions (ASI picks, pool picks) — reconcile prunes them so a
  // stale abilityGrant can't keep bumping scores (grants apply unconditionally).
  register('builderClassSet', (cid, idx, classId) => {
    builderMutate(cid, (s, engine) => { if (s.classes[idx]) { s.classes[idx] = { ...s.classes[idx], classId: String(classId), subclass: '' }; } if (engine) reconcile(s, engine); });
  });
  // Set a class level from the host stepper. Reconciles orphaned
  // decisions, and — like the old +/- stepper — focuses (opens) the new top level
  // when the level grows so that level's choices are right there to resolve.
  register('builderLevelSet', (cid, idx, value) => {
    let classId = '', newLevel = 1, grew = false;
    builderMutate(cid, (s, engine) => {
      const cl = s.classes[idx];
      if (cl) {
        const old = num(cl.level, 1);
        newLevel = Math.max(1, Math.min(20, num(value, 1)));
        grew = newLevel > old; classId = cl.classId;
        s.classes[idx] = { ...cl, level: newLevel };
      }
      if (engine) reconcile(s, engine);
    });
    if (grew && classId) {
      uiState.update(cid, 'builder', state => ({
        ...state,
        tab: String(classId),
        open: `${classId}:${newLevel}`,
      }), {});
      host.ui.rerender();
    }
  });
  register('builderSubclassSet', (cid, idx, subclass) => {
    builderMutate(cid, (s, engine) => { if (s.classes[idx]) s.classes[idx] = { ...s.classes[idx], subclass: String(subclass) }; if (engine) reconcile(s, engine); });
  });
  register('builderAddClass', (cid) => {
    builderMutate(cid, (s) => { s.classes = s.classes.concat([{ classId: '', level: 1, subclass: '' }]); });
  });
  register('builderRemoveClass', (cid, idx) => {
    builderMutate(cid, (s, engine) => { if (s.classes.length > 1) s.classes = s.classes.filter((_, i) => i !== idx); if (engine) reconcile(s, engine); });
  });
  // Builder sub-tab switch (Character | <classId>) — in-memory, clears any open level row.
  register('builderTab', (cid, tab) => {
    uiState.update(cid, 'builder', state => ({ ...state, tab: String(tab), open: null }), {});
    host.ui.rerender();
  });
  register('builderNavigate', (cid, tab, classId, level) => {
    if (tab === 'spellbook') {
      uiState.setTab(cid, 'spellbook');
    } else {
      uiState.setTab(cid, 'builder');
      const selectedClass = String(classId || '');
      const selectedLevel = Math.max(0, num(level));
      uiState.set(cid, 'builder', {
        tab: selectedClass || 'character',
        open: selectedClass && selectedLevel ? `${selectedClass}:${selectedLevel}` : null,
      });
    }
    host.ui.rerender();
  });
  // Roving-tabindex keyboard nav across the Builder sub-tabs (Character + one per
  // class), mirroring the top tab bar's `tabKey`: Arrow keys move + focus follows.
  register('builderTabKey', (ev, cid, tabId) => {
    const key = ev && ev.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    if (ev.preventDefault) ev.preventDefault();
    const s = sheetOf(host.store.getCharacters().find((x) => x && x.id === cid) || {});
    const engine = getRules(s);
    if (!engine) return;
    const classes = builderModel(s, engine).classes || [];
    const ids = ['character', ...classes.filter((cl) => cl.classId).map((cl) => cl.classId)];
    const cur = ids.indexOf(String(tabId));
    if (cur < 0) return;
    let next = cur;
    if (key === 'ArrowLeft') next = (cur - 1 + ids.length) % ids.length;
    else if (key === 'ArrowRight') next = (cur + 1) % ids.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = ids.length - 1;
    uiState.update(cid, 'builder', state => ({ ...state, tab: ids[next], open: null }), {});
    host.ui.rerender();
    // Move focus to the newly-active tab after the re-render (DOM only — guarded so
    // the async callback never throws in a headless/test env).
    if (typeof document !== 'undefined') {
      const fid = 'dse-btab-' + cid + '-' + ids[next];
      later(() => { try { const el = document.getElementById(fid); if (el) el.focus(); } catch (_) {} }, 0);
    }
  });
  // Expand/collapse one level row (accordion — one open at a time; click again to close).
  register('builderToggleLevel', (cid, key) => {
    uiState.update(cid, 'builder', state => ({
      ...state,
      open: state.open === String(key) ? null : String(key),
    }), {});
    host.ui.rerender();
  });
  // Level-independent extra feats: read the picker and optional custom name,
  // note at click time. A compendium featId feeds the engine (mechanics apply); a
  // free-text name is tracked. builderMutate so a real feat re-materializes the sheet.
  register('builderExtraFeatAdd', (cid) => {
    let featId = '', name = '', note = '';
    try {
      featId = (document.getElementById('dse-xfeat-id-' + cid) || {}).value || '';
      name = (document.getElementById('dse-xfeat-name-' + cid) || {}).value || '';
      note = (document.getElementById('dse-xfeat-note-' + cid) || {}).value || '';
    } catch (_) {}
    if (!featId && !String(name).trim()) { host.ui.rerender(); return; }
    builderMutate(cid, (s, engine) => {
      s.extraFeats = (Array.isArray(s.extraFeats) ? s.extraFeats : []).concat([{ id: uid('xfeat'), featId: String(featId) || null, name: featId ? '' : String(name).trim(), sourceNote: String(note) }]);
      if (engine) reconcile(s, engine);
    });
  });
  register('builderExtraFeatRemove', (cid, id) => {
    builderMutate(cid, (s, engine) => {
      s.extraFeats = (Array.isArray(s.extraFeats) ? s.extraFeats : []).filter((f) => f.id !== id);
      if (engine) reconcile(s, engine);
    });
  });
  // Distribute-N-points ASI picker: set one ability's delta (from the host
  // `.codex-stepper` input's change) in an ability grant (bg ASI 'bgasi' / class ASI
  // 'asi:<c>:<l>:ability' / half-feat '…:featability'), clamping to [0, perMax] and to
  // the shared `budget` server-side. The abilityGrants `assign` map is the source of
  // truth the engine hydrates; the grant's source type is derived from the key so
  // hydrate/reconcile treat it exactly as the old split-select did.
  register('builderAsiSet', (cid, key, ability, value, budget) => {
    if (ABILITIES.indexOf(String(ability)) < 0) return;
    let left = null;
    builderMutate(cid, (s, engine) => {
      applyChoice(s, engine, {
        choiceId: String(key),
        value: { ability: String(ability), amount: num(value, 0) },
      });
      const assign = (s.abilityGrants || []).find(grant => grant?.id === String(key))?.assign || {};
      const spent = Object.values(assign).reduce((total, amount) => total + Math.max(0, num(amount)), 0);
      left = Math.max(0, num(budget, 0) - spent);
    });
    // Same persistent-live-region announcement as point-buy (builderAbilitySet).
    if (left != null && typeof host.ui.announce === 'function') host.ui.announce(plural('builder.pointsLeft', left));
  });
  register('builderChoose', (cid, key, value) => {
    builderMutate(cid, (s, engine) => {
      const k = String(key);
      const slotMatch = /#(\d+)$/.exec(k);
      applyChoice(s, engine, {
        choiceId: slotMatch ? k.slice(0, slotMatch.index) : k,
        ...(slotMatch ? { slot: num(slotMatch[1]) } : {}),
        value,
      });
    });
  });

  return () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}

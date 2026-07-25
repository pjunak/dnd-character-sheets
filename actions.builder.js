export const BUILDER_ACTIONS = Object.freeze(['builderField','builderAbility','builderToggleManual','builderAbilitySet','builderClassSet','builderLevelSet','builderSubclassSet','builderAddClass','builderRemoveClass','builderTab','builderTabKey','builderToggleLevel','builderExtraFeatAdd','builderExtraFeatRemove','builderAsiSet','builderChoose']);

export function registerBuilderActions(deps) {
  const { host, plural, num, uid, ABILITIES, POINT_BUY, pointCost, pointsSpent, featAsiFrom, featAbilityCap, uiState, sheetOf, getRules } = deps;
  const { builderMutate, reconcile, builderModel } = deps.engine;
  const register = (name, fn) => host.registerAction(name, fn);
  const timers = new Set();
  const later = (fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, 0); timers.add(id); };
  // ── Builder (engine mode) — edit the rich decision model + materialize ────
  const removeGrant = (s, id) => { s.abilityGrants = (s.abilityGrants || []).filter((g) => g.id !== id); };
  // `cap` (optional) is a RAISED per-ability max the grant carries (AB-4 —
  // 2024 Epic Boons: 30); absent → the engine's default 20 applies.
  const upsertGrant = (s, id, source, assign, cap) => { removeGrant(s, id); if (assign && Object.keys(assign).length) s.abilityGrants = (s.abilityGrants || []).concat([{ id, source, assign, ...(cap ? { cap: num(cap) } : {}) }]); };

  register('builderField', (cid, field, value) => {
    builderMutate(cid, (s) => {
      s[field] = String(value);
      if (field === 'race') s.lineage = '';
      if (field === 'background') { delete s.featureChoices['bgasi']; removeGrant(s, 'bgasi'); }
    });
  });
  register('builderAbility', (cid, ability, value) => {
    builderMutate(cid, (s) => { s.baseStats = { ...(s.baseStats || {}), [ability]: Math.max(1, Math.min(30, num(value, 10))) }; });
  });
  // Toggle point-buy ↔ manual base scores. Leaving manual (→ point buy) clamps
  // each base into the 8–15 point-buy range so the pool math stays valid.
  register('builderToggleManual', (cid) => {
    builderMutate(cid, (s) => {
      const on = !s.manualScores;
      s.manualScores = on;
      if (!on) {
        const base = { ...(s.baseStats || {}) };
        for (const a of ABILITIES) base[a] = Math.max(POINT_BUY.min, Math.min(POINT_BUY.max, num(base[a], POINT_BUY.min)));
        s.baseStats = base;
      }
    });
  });
  // Point-buy SET (B5): the host `.codex-stepper` input fires change with the new
  // score; clamp to the point-buy floor/ceiling, then step down until within the
  // 27-point budget.
  register('builderAbilitySet', (cid, ability, value) => {
    if (ABILITIES.indexOf(ability) < 0) return;
    let left = null;   // remaining point-buy budget, captured post-clamp
    builderMutate(cid, (s) => {
      const base = { ...(s.baseStats || {}) };
      const cur = num(base[ability], POINT_BUY.min);
      let next = Math.max(POINT_BUY.min, Math.min(POINT_BUY.max, num(value, POINT_BUY.min)));
      while (next > POINT_BUY.min && (pointsSpent(base) - pointCost(cur) + pointCost(next)) > POINT_BUY.budget) next--;
      base[ability] = next;
      s.baseStats = base;
      left = POINT_BUY.budget - pointsSpent(base);
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
  // Set a class level (host `.codex-stepper` input change, B5). Reconciles orphaned
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
  // Level-independent extra feats (B4.5b) — read the picker + optional custom name +
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
    builderMutate(cid, (s) => { s.extraFeats = (Array.isArray(s.extraFeats) ? s.extraFeats : []).concat([{ id: uid('xfeat'), featId: String(featId) || null, name: featId ? '' : String(name).trim(), sourceNote: String(note) }]); });
  });
  register('builderExtraFeatRemove', (cid, id) => {
    builderMutate(cid, (s) => { s.extraFeats = (Array.isArray(s.extraFeats) ? s.extraFeats : []).filter((f) => f.id !== id); });
  });
  // Distribute-N-points ASI picker (B5): set one ability's delta (from the host
  // `.codex-stepper` input's change) in an ability grant (bg ASI 'bgasi' / class ASI
  // 'asi:<c>:<l>:ability' / half-feat '…:featability'), clamping to [0, perMax] and to
  // the shared `budget` server-side. The abilityGrants `assign` map is the source of
  // truth the engine hydrates; the grant's source type is derived from the key so
  // hydrate/reconcile treat it exactly as the old split-select did.
  register('builderAsiSet', (cid, key, ability, value, budget, perMax) => {
    if (ABILITIES.indexOf(String(ability)) < 0) return;
    let left = null;   // remaining ASI budget, captured post-clamp
    builderMutate(cid, (s, engine) => {
      const k = String(key);
      const type = k === 'bgasi' ? 'background' : /:featability$/.test(k) ? 'feat' : 'asi';
      // A half-feat/boon ability pick inherits its feat's raised cap (Epic
      // Boons: max 30) so the engine can clamp past 20 for exactly this grant.
      let cap = null;
      if (type === 'feat' && engine) {
        const featId = s.featureChoices[k.replace(/:featability$/, ':feat')];
        cap = featAbilityCap(featId ? engine.getItem('feat', String(featId)) : null);
      }
      const g = (s.abilityGrants || []).find((x) => x.id === k);
      const assign = { ...((g && g.assign) || {}) };
      const pmax = Math.max(1, num(perMax, 2));
      const bud = Math.max(1, num(budget, 2));
      const others = ABILITIES.reduce((n, a) => n + (a === String(ability) ? 0 : num(assign[a], 0)), 0);
      let v = Math.max(0, Math.min(pmax, num(value, 0)));   // clamp 0..perMax
      v = Math.min(v, bud - others);                        // clamp to the remaining budget
      if (v <= 0) delete assign[ability]; else assign[ability] = v;
      left = bud - others - Math.max(0, v);
      upsertGrant(s, k, { type }, assign, cap);
    });
    // Same persistent-live-region announcement as point-buy (builderAbilitySet).
    if (left != null && typeof host.ui.announce === 'function') host.ui.announce(plural('builder.pointsLeft', left));
  });
  register('builderChoose', (cid, key, value) => {
    builderMutate(cid, (s, engine) => {
      const k = String(key);
      if (value === '' || value == null) delete s.featureChoices[k];
      else s.featureChoices[k] = String(value);
      if (/:featability$/.test(k)) {
        const featId = s.featureChoices[k.replace(/:featability$/, ':feat')];
        const cap = engine ? featAbilityCap(featId ? engine.getItem('feat', String(featId)) : null) : null;
        upsertGrant(s, k, { type: 'feat' }, value ? { [String(value)]: 1 } : null, cap);
      } else if (/:ability$/.test(k)) {
        upsertGrant(s, k, { type: 'asi' }, value ? { [String(value)]: 2 } : null);
      } else if (/:feat$/.test(k)) {
        const abilKey = k.replace(/:feat$/, '') + ':featability';
        removeGrant(s, abilKey); delete s.featureChoices[abilKey];
        const feat = value && engine ? engine.getItem('feat', String(value)) : null;
        const asi = feat && feat.grants && feat.grants.abilityScoreIncrease;
        // 'ANY' (Boon of Skill) expands to all six — never auto-applied; a
        // genuine single-option bump applies with its feat's cap (boons: 30).
        const from = featAsiFrom(asi);
        if (asi && from.length === 1) {
          upsertGrant(s, abilKey, { type: 'feat' }, { [from[0]]: num(asi.amount, 1) }, featAbilityCap(feat));
        }
      } else if (/^asi:[^:]+:\d+$/.test(k)) {
        if (value !== 'asi') { removeGrant(s, k + ':ability'); delete s.featureChoices[k + ':ability']; }
        if (value !== 'feat') { delete s.featureChoices[k + ':feat']; delete s.featureChoices[k + ':featability']; removeGrant(s, k + ':featability'); }
      }
    });
  });

  return () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}

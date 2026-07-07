// ═══════════════════════════════════════════════════════════════
//  panel.builder.js — the Builder (guided progression + edit surface, engine mode).
//
//  Writes the rich decision model (classes[]/baseStats/grants/choices); every edit
//  re-hydrates + materializes the DEG-1 fallback. Reached only when rulebook
//  data is present (the tab is gated on `getRules()`), and the rules api is
//  built in-addon (rules/api.js) with a guaranteed shape — its list* members
//  return [] while data is missing, so sections degrade to empty pickers
//  rather than throwing. (The old cross-addon `callEngine` feature-detection
//  died with the dnd55e-core-rules merge.)
// ═══════════════════════════════════════════════════════════════

export function makeBuilderPanel(ctx) {
  const { host, t, ABILITIES, SKILLS, num, signed, abilityMod, titleize, firstPara, featureRecordFor, ui, engine: E, POINT_BUY, pointCost, pointsSpent, builderState } = ctx;
  const { esc, dataAction, dataOn } = host.h;
  const { section, miniStat, selectBox, fieldRow, choiceBlock, warningsBlock, numField, entityRef } = ui;
  const { builderModel, collectChoices } = E;

  function panelBuilder(c, s, editable, comp, warnings, engine) {
    if (!engine) return panelBuilderStub();
    const ro = !editable;
    const model = builderModel(s, engine);
    const classes = model.classes;
    const base = model.baseStats;
    const totalLevel = classes.reduce((n, cl) => n + Math.max(1, num(cl.level, 1)), 0);
    const d = (comp && comp.derived) || {};

    const summary = [
      miniStat(t('stat.hp'), num(d.maxHp, 0)),
      miniStat(t('stat.ac'), num(d.armorClass, 10)),
      miniStat(t('stat.pb'), signed(num(d.proficiencyBonus, 2))),
      miniStat(t('builder.totalLevel'), totalLevel),
    ].join('');

    // Internal sub-tabs: a Character tab (level-independent) + one per class. State
    // is in-memory (ctx.builderState) and defaults to Character on load (B4.5b).
    const st = (builderState && builderState[c.id]) || {};
    const classTabs = classes.filter((cl) => cl.classId);
    const active = classTabs.some((cl) => cl.classId === st.tab) ? st.tab : 'character';

    const body = active === 'character'
      ? `${builderAbilities(c, s, base, comp, ro)}
         ${builderIdentity(c, s, engine, ro)}
         ${builderClasses(c, classes, engine, ro)}
         ${builderCreationChoices(c, s, engine, ro)}
         ${builderExtraFeats(c, s, engine, ro)}`
      : builderClassTab(c, s, active, classes, engine, comp, ro);

    return `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        ${warningsBlock(warnings)}
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">${summary}</div>
        ${builderTabStrip(c, classTabs, active, engine)}
        ${body}
      </div>`;
  }

  // Sub-tab strip: Character + one tab per (set) class. Switching is a plain action
  // that flips the in-memory state; the active tab gets the gold underline.
  function builderTabStrip(c, classTabs, active, engine) {
    // Host `.codex-tab-strip` / `.codex-tab` component (widgets.css) — same tablist
    // the sheet's top tab bar uses (entry.js), so the Builder's sub-tabs share the
    // unified style + gold active indicator rather than a hand-rolled look-alike.
    const tab = (id, label, on) => `<button role="tab" class="codex-tab${on ? ' is-active' : ''}" aria-selected="${on ? 'true' : 'false'}"${dataAction(host.action('builderTab'), c.id, id)}>${esc(label)}</button>`;
    const tabs = [tab('character', t('builder.tabCharacter'), active === 'character')];
    for (const cl of classTabs) {
      const rec = engine.getItem('class', cl.classId);
      tabs.push(tab(cl.classId, (rec ? rec.name : cl.classId) + ' ' + num(cl.level, 1), active === cl.classId));
    }
    return `<div role="tablist" class="codex-tab-strip" aria-label="${esc(t('builder.tabsAria'))}">${tabs.join('')}</div>`;
  }

  // One class's progression spine — a row per class level: features gained + the
  // choices made at that level (as chips). Rows with choices are click-to-expand
  // (accordion, one open at a time via ctx.builderState.open) into that level's
  // editors; unresolved levels get a soft "needs choices" flag (never blocks — FE-7).
  function builderClassTab(c, s, classId, classes, engine, comp, ro) {
    const cl = classes.find((x) => x.classId === classId);
    if (!cl) return '';
    const idx = classes.findIndex((x) => x.classId === classId);
    const rec = engine.getItem('class', classId);
    const clsName = rec ? rec.name : classId;
    const features = (comp && comp.features) || [];
    const chDescs = collectChoices([cl], engine);   // this class's choices, each tagged with source.level
    const subclassLevel = rec ? num(rec.subclassLevel, 3) : 3;
    const hasSubclasses = (engine.listSubclasses(classId) || []).length > 0;
    const st = (builderState && builderState[c.id]) || {};
    const lvl = num(cl.level, 1);
    const rows = [];
    for (let l = 1; l <= lvl; l++) {
      const feats = spineFeatureLinks(cl, l, features, engine);
      const levelChoices = chDescs.filter((ch) => num(ch.source && ch.source.level) === l);
      const isSubLevel = hasSubclasses && l === subclassLevel;
      const chips = [];
      let unresolved = 0;
      // The subclass (structural `cl.subclass`) surfaces as the first choice at the
      // subclass level: a chip when chosen, a dropdown when the row is expanded.
      if (isSubLevel) {
        if (cl.subclass) { const sr = engine.getItem('subclass', cl.subclass); chips.push(chipHtml((sr && sr.name) || titleize(cl.subclass))); }
        else unresolved++;
      }
      for (const ch of levelChoices) {
        const sum = choiceSummary(ch, s, engine);
        if (sum.text) chips.push(chipHtml(sum.text));
        if (!sum.done) unresolved++;
      }
      // Recorded spell swaps done at this class level (FE-4) — shown where they happened.
      for (const sw of (s.spellSwaps || [])) {
        if (sw.classId === classId && num(sw.classLevel != null ? sw.classLevel : sw.level) === l) chips.push(swapChip(sw, engine));
      }
      const key = classId + ':' + l;
      const expandable = (levelChoices.length > 0 || isSubLevel) && !ro;
      const open = expandable && st.open === key;
      let editors = '';
      if (open) {
        const eds = [];
        if (isSubLevel) {
          const subOpts = engine.listSubclasses(classId).map((o) => ({ value: o.id, label: o.name }));
          eds.push(choiceBlock(t('builder.subclass'), selectBox(cl.subclass, subOpts, dataOn('change', host.action('builderSubclassSet'), c.id, idx, '$value'), t('builder.subclass'), ro)));
        }
        for (const ch of levelChoices) eds.push(renderDescriptor(c, s, ch, engine, ro));
        editors = `<div style="padding:var(--space-1) 0 var(--space-2) 3.5rem;display:flex;flex-direction:column;gap:var(--space-2)">${eds.join('')}</div>`;
      }
      rows.push(spineRow(c, key, l, feats, chips, unresolved, expandable, open, editors, ro));
    }
    return section(clsName, `${levelStepper(c, idx, lvl, ro)}${rows.join('')}`);
  }

  // Level a class up/down (+/-) — the guided add-a-level control at the top of a class tab.
  function levelStepper(c, idx, lvl, ro) {
    if (ro) return `<div style="color:var(--text-muted);font-size:var(--text-xs);margin-bottom:var(--space-2)">${esc(t('field.level'))} ${esc(String(lvl))}</div>`;
    // Host `.codex-stepper` (numField): the class level 1–20. builderLevelSet reconciles
    // orphaned choices and opens the new top level when it grows.
    return `<div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-3)">
      <span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.03em">${esc(t('field.level'))}</span>
      ${numField(dataOn('change', host.action('builderLevelSet'), c.id, idx, '$value'), lvl, { min: 1, max: 20, ariaLabel: t('field.level') })}
    </div>`;
  }

  // A summary chip (collapsed spine row) — small, muted, plain text.
  function chipHtml(txt) {
    return `<span style="display:inline-flex;align-items:center;background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0 var(--space-1);font-size:var(--text-xs);color:var(--text-light)">${esc(txt)}</span>`;
  }

  // A recorded spell-swap chip (out → in), both linked to the compendium + hovered.
  // Read-only here — swaps are made/removed on the Spellbook tab; the spine just shows
  // them at the level they happened (FE-4 / B4.5b).
  function swapChip(sw, engine) {
    const nm = (ref) => { const r = engine.getItem && engine.getItem('spell', ref); return r ? r.name : String(ref); };
    const leg = (ref) => { const r = engine.getItem && engine.getItem('spell', ref); return r && r.text ? { title: r.name, desc: firstPara(r.text), aria: r.name } : null; };
    // pe() keeps the spell links clickable inside a pointer-events:none spine row.
    const pe = (h) => `<span style="pointer-events:auto">${h}</span>`;
    return `<span style="display:inline-flex;align-items:center;gap:2px;background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0 var(--space-1);font-size:var(--text-xs);color:var(--text-light)">🔄 ${pe(entityRef('spell', sw.out, nm(sw.out), leg(sw.out)))} → ${pe(entityRef('spell', sw.in, nm(sw.in), leg(sw.in)))}</span>`;
  }

  // Human label for a resolved choice value (skill / feature-pool / weapon / feat).
  function labelValue(ch, v, engine) {
    if (ch.kind === 'skills' || ch.kind === 'expertise') return t('skill.' + v) || titleize(v);
    const fr = engine.getFeature && engine.getFeature(v); if (fr && fr.name) return fr.name;
    if (ch.kind === 'weaponMastery') { const w = engine.getItem && engine.getItem('weapon', v); if (w) return w.name; }
    if (ch.kind === 'feat') { const f = engine.getItem && engine.getItem('feat', v); if (f) return f.name; }
    return titleize(v);
  }

  // Summarize a choice's resolved value(s) for the collapsed row + whether it's fully
  // resolved (drives the "needs choices" flag). asiMode: mode + its ability/feat pick.
  function choiceSummary(ch, s, engine) {
    const fc = s.featureChoices || {};
    if (ch.kind === 'asiMode') {
      const mode = fc[ch.id];
      if (mode === 'feat') { const f = fc[ch.id + ':feat']; return { text: f ? ((engine.getItem('feat', f) || {}).name || titleize(f)) : t('builder.featOption'), done: !!f }; }
      if (mode === 'asi') {
        const assign = assignOf(s, ch.id + ':ability');
        const parts = ABILITIES.filter((a) => num(assign[a], 0) > 0).map((a) => '+' + num(assign[a]) + ' ' + t('ability.' + a));
        const total = ABILITIES.reduce((n, a) => n + num(assign[a], 0), 0);
        return { text: parts.length ? parts.join(', ') : t('builder.asiOption'), done: total >= 2 };
      }
      return { text: null, done: false };
    }
    const count = Math.max(1, num(ch.count, 1));
    const vals = [];
    for (let i = 0; i < count; i++) { const v = fc[count > 1 ? ch.id + '#' + i : ch.id]; if (v && !vals.includes(v)) vals.push(v); }
    return { text: vals.length ? vals.map((v) => labelValue(ch, v, engine)).join(', ') : null, done: vals.length >= count };
  }

  // One spine row: the level label (with a ▸/▾ caret when the level has choices), the
  // features gained (compendium links), the made-choice chips + optional "needs choices"
  // flag, then the expanded editors below when open. When expandable, the WHOLE head is
  // the click target: a full-row <button> is layered behind the content (a sibling of the
  // links, not an ancestor — so a link click resolves to no data-action and navigates
  // normally). The content sits on top with pointer-events:none so dead-space clicks fall
  // through to the button; the inner links are re-enabled to pointer-events:auto. The
  // real <button> also gives keyboard focus + native Enter/Space, and aria-expanded.
  function spineRow(c, key, l, feats, chips, unresolved, expandable, open, editors, ro) {
    const caret = expandable ? (open ? '▾ ' : '▸ ') : '';
    const featHtml = feats.length
      ? feats.map((f) => `<span style="pointer-events:auto">${f}</span>`).join('<span style="color:var(--text-muted)">, </span>')
      : '<span style="color:var(--text-muted)">—</span>';
    const badge = (unresolved && !ro) ? `<span style="background:rgba(var(--accent-gold-rgb),.15);color:var(--accent-gold);border-radius:var(--radius-sm);padding:0 var(--space-1);font-size:var(--text-xs)">${esc(t('builder.needsChoices'))}</span>` : '';
    const content = `<div style="display:flex;gap:var(--space-2);align-items:center;padding:var(--space-1) 0;font-size:var(--text-sm)${expandable ? ';position:relative;z-index:1;pointer-events:none' : ''}">
      <span style="color:var(--text-muted);min-width:3.5rem;padding-left:${expandable ? '4px' : 'calc(4px + 1ch)'}">${caret}L${esc(String(l))}</span>
      <span style="color:var(--text-parchment);flex:1">${featHtml}</span>
      <span style="display:flex;flex-wrap:wrap;gap:var(--space-1);align-items:center">${chips.join('')}${badge}</span>
    </div>`;
    if (!expandable) return `<div style="border-bottom:1px solid rgba(var(--gold-muted),.1)">${content}${editors}</div>`;
    const toggle = `<button aria-expanded="${open ? 'true' : 'false'}" aria-label="${esc(t('builder.levelAria', { n: l }))}" style="position:absolute;inset:0;background:none;border:none;padding:0;margin:0;cursor:pointer;border-radius:var(--radius-sm)"${dataAction(host.action('builderToggleLevel'), c.id, key)}></button>`;
    return `<div style="border-bottom:1px solid rgba(var(--gold-muted),.1)"><div style="position:relative">${toggle}${content}</div>${editors}</div>`;
  }

  // Feature names gained by a class (or its subclass) at a given class level, each a
  // compendium link + hover card. Shared by the class spine and the Character-tab log.
  function spineFeatureLinks(cl, l, features, engine) {
    return features
      .filter((f) => f.source && num(f.source.level) === l && (f.source.type === 'subclass' ? f.source.id === cl.subclass : f.source.id === cl.classId))
      .map((f) => {
        const name = f.name || titleize(f.id);
        const recF = featureRecordFor(engine, cl, l, f);
        const legend = recF && recF.text ? { title: recF.name || name, desc: firstPara(recF.text), aria: name } : null;
        return entityRef('feature', recF && recF.id, name, legend);
      });
  }

  function panelBuilderStub() {
    return `<div style="color:var(--text-muted);font-size:var(--text-sm)">${esc(t('builder.soon'))}</div>`;
  }

  // Ability scores — point buy by default (27 pts, each base 8–15), or free
  // manual entry when the box is ticked. Either way this sets only the BASE
  // scores; the engine adds species / background / feat increases on top.
  function builderAbilities(c, s, base, comp, ro) {
    const manual = !!s.manualScores;
    const toggle = ro ? '' : `<label style="display:inline-flex;align-items:center;gap:6px;font-size:var(--text-xs);color:var(--text-muted);cursor:pointer">
      <input type="checkbox" style="accent-color:var(--accent-gold);cursor:pointer"${manual ? ' checked' : ''}${dataOn('change', host.action('builderToggleManual'), c.id)}> ${esc(t('builder.manualScores'))}</label>`;

    // base + grants → final score preview, shared by both modes.
    const finPreview = (a, b) => {
      const fin = comp && comp.abilities && comp.abilities[a] ? num(comp.abilities[a].score, b) : b;
      const bonus = fin - b;
      return `<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--space-1)">→ <strong style="color:var(--text-parchment)">${esc(String(fin))}</strong> ${esc(signed(abilityMod(fin)))}${bonus ? ` <span style="color:var(--color-success)">${esc(signed(bonus))}</span>` : ''}</div>`;
    };
    const tile = (a, controlHtml, b) => `<div style="text-align:center;background:var(--bg-raised);border-radius:var(--radius);padding:var(--space-2)">
      <div style="font-size:var(--text-xs);color:var(--text-muted)">${esc(a)}</div>${controlHtml}${finPreview(a, b)}</div>`;

    if (manual) {
      const cells = ABILITIES.map((a) => {
        const b = num(base[a], 10);
        const ctrl = ro
          ? `<div style="color:var(--text-parchment);font-weight:700;font-size:var(--text-lg)">${esc(String(b))}</div>`
          : numField(dataOn('change', host.action('builderAbility'), c.id, a, '$value'), b, { min: 1, max: 30, ariaLabel: a });
        return tile(a, ctrl, b);
      }).join('');
      return section(t('builder.abilities'),
        `<div style="color:var(--text-muted);font-size:var(--text-xs);margin-bottom:var(--space-2)">${esc(t('builder.baseHint'))}</div>
         <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(4.5rem,1fr));gap:var(--space-2)">${cells}</div>`,
        { right: toggle });
    }

    // ── Point buy ──
    const spent = pointsSpent(base);
    const remaining = POINT_BUY.budget - spent;
    const remColor = remaining < 0 ? 'var(--color-danger)' : remaining === 0 ? 'var(--text-muted)' : 'var(--accent-gold)';
    const budget = `<span style="font-size:var(--text-xs);font-weight:600;color:${remColor};font-variant-numeric:tabular-nums">${esc(t('builder.pointsLeft', { n: remaining }))}</span>`;
    const cells = ABILITIES.map((a) => {
      const b = Math.max(POINT_BUY.min, Math.min(POINT_BUY.max, num(base[a], POINT_BUY.min)));
      // Host `.codex-stepper` (numField): min = the point-buy floor, max = the highest
      // score still affordable within the budget, so the ± buttons can't overspend;
      // builderAbilitySet re-clamps a typed value the same way.
      let cap = b; while (cap < POINT_BUY.max && (spent - pointCost(b) + pointCost(cap + 1)) <= POINT_BUY.budget) cap++;
      const ctrl = ro
        ? `<div style="color:var(--text-parchment);font-weight:700;font-size:var(--text-lg)">${esc(String(b))}</div>`
        : numField(dataOn('change', host.action('builderAbilitySet'), c.id, a, '$value'), b, { min: POINT_BUY.min, max: cap, ariaLabel: a });
      return tile(a, ctrl, b);
    }).join('');
    return section(t('builder.abilities'),
      `<div style="color:var(--text-muted);font-size:var(--text-xs);margin-bottom:var(--space-2)">${esc(t('builder.pointBuyHint'))}</div>
       <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(5.5rem,1fr));gap:var(--space-2)">${cells}</div>`,
      { right: `${budget}${toggle}` });
  }

  // Identity: species (+lineage), background, alignment, player.
  function builderIdentity(c, s, engine, ro) {
    const speciesOpts = engine.listSpecies().map((o) => ({ value: o.name, label: o.name }));
    const bgOpts = engine.listBackgrounds().map((o) => ({ value: o.name, label: o.name }));
    const speciesRec = s.race ? (engine.getItemByName('species', s.race) || engine.getItem('species', s.race)) : null;
    const lineageOpts = (speciesRec && speciesRec.lineages || []).map((l) => ({ value: l.id, label: l.name }));
    const rows = [
      fieldRow(t('field.race'), selectBox(s.race, speciesOpts, dataOn('change', host.action('builderField'), c.id, 'race', '$value'), t('builder.choose'), ro)),
    ];
    if (lineageOpts.length) rows.push(fieldRow(t('builder.lineage'), selectBox(s.lineage, lineageOpts, dataOn('change', host.action('builderField'), c.id, 'lineage', '$value'), t('builder.choose'), ro)));
    rows.push(fieldRow(t('field.background'), selectBox(s.background, bgOpts, dataOn('change', host.action('builderField'), c.id, 'background', '$value'), t('builder.choose'), ro)));
    return section(t('builder.identity'), rows.join(''));
  }

  // Class roster: which classes the character has. Pick/change the class + remove;
  // the LEVEL (+/-) and SUBCLASS now live in each class's own tab (its spine), so the
  // roster shows the level read-only and points you to the tab to level up.
  function builderClasses(c, classes, engine, ro) {
    const classOpts = engine.listClasses().map((o) => ({ value: o.id, label: o.name }));
    const rows = classes.map((cl, idx) => {
      const rec = cl.classId ? engine.getItem('class', cl.classId) : null;
      const sub = cl.subclass ? (engine.getItem('subclass', cl.subclass) || {}).name : '';
      const lvlHint = cl.classId
        ? `<span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('field.level'))} ${esc(String(num(cl.level, 1)))}${sub ? ' · ' + esc(sub) : ''}</span>`
        : '';
      const removeBtn = (!ro && classes.length > 1) ? `<button class="inline-create-btn" title="${esc(t('action.remove'))}"${dataAction(host.action('builderRemoveClass'), c.id, idx)}>✕</button>` : '';
      return `<div style="display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;padding:var(--space-1) 0;border-bottom:1px solid rgba(var(--gold-muted),.12)">
        <div style="min-width:9rem">${selectBox(cl.classId, classOpts, dataOn('change', host.action('builderClassSet'), c.id, idx, '$value'), t('builder.choose'), ro)}</div>
        ${lvlHint}
        ${removeBtn}
      </div>`;
    }).join('');
    const addBtn = ro ? '' : `<button class="inline-create-btn" style="margin-top:var(--space-2)"${dataAction(host.action('builderAddClass'), c.id)}>＋ ${esc(t('builder.addClass'))}</button>`;
    return section(t('builder.classes'), rows + addBtn);
  }

  // Creation-time choices on the Character tab: the background ASI (AB-1) + the
  // origin-feat note. Per-class / per-level choices (skills, grants, ASI/feat, pools)
  // now live in each class tab's spine (bucketed by source.level), not a flat list.
  function builderCreationChoices(c, s, engine, ro) {
    const bgRec = s.background ? (engine.getItemByName('background', s.background) || engine.getItem('background', s.background)) : null;
    if (!(bgRec && Array.isArray(bgRec.abilityScores) && bgRec.abilityScores.length)) return '';
    // 2024 background ASI: distribute 3 points across the background's abilities
    // (+2/+1 or +1/+1/+1), max +2 to any one — a number picker, not a split-select (B5).
    const pickers = abilityBudgetPickers(c, 'bgasi', bgRec.abilityScores, assignOf(s, 'bgasi'), 3, 2, ro);
    const blocks = [choiceBlock(t('builder.bgAsi', { bg: bgRec.name }), pickers)];
    if (bgRec.originFeat) blocks.push(`<div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('builder.originFeat', { feat: titleize(bgRec.originFeat) }))}</div>`);
    return section(t('builder.choices'), `<div style="display:flex;flex-direction:column;gap:var(--space-2)">${blocks.join('')}</div>`);
  }

  // Level-independent extra feats (B4.5b) — feats from a boon / magic item / homebrew,
  // separate from leveling. Pick a compendium feat (its mechanics apply via the engine)
  // or type a custom name (tracked only); each carries an optional source note. Remove
  // any of them. This is the "extras" home the maintainer asked for on the Character tab.
  function builderExtraFeats(c, s, engine, ro) {
    const list = Array.isArray(s.extraFeats) ? s.extraFeats : [];
    if (!list.length && ro) return '';
    const rows = list.map((ef) => {
      const rec = ef.featId ? engine.getItem('feat', ef.featId) : null;
      const nm = rec ? rec.name : (ef.name || titleize(ef.featId || 'feat'));
      const leg = rec && rec.text ? { title: rec.name, desc: firstPara(rec.text), aria: rec.name } : null;
      const label = ef.featId ? entityRef('feat', ef.featId, nm, leg) : esc(nm);
      const note = ef.sourceNote ? ` <span style="color:var(--text-muted);font-size:var(--text-xs);font-style:italic">— ${esc(ef.sourceNote)}</span>` : '';
      const rm = ro ? '' : `<button class="inline-create-btn" title="${esc(t('action.remove'))}"${dataAction(host.action('builderExtraFeatRemove'), c.id, ef.id)}>✕</button>`;
      return `<div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm)"><span style="flex:1">${label}${note}</span>${rm}</div>`;
    }).join('');
    const featOpts = (engine.listFeats ? engine.listFeats() : []).map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    const adder = ro ? '' : `<div style="display:flex;flex-wrap:wrap;gap:var(--space-1);align-items:center;margin-top:var(--space-2)">
      <select id="dse-xfeat-id-${esc(c.id)}" class="edit-input" style="max-width:12rem"><option value="">${esc(t('builder.pickFeat'))}</option>${featOpts}</select>
      <input id="dse-xfeat-name-${esc(c.id)}" class="edit-input" style="max-width:10rem" placeholder="${esc(t('builder.customFeatName'))}">
      <input id="dse-xfeat-note-${esc(c.id)}" class="edit-input" style="max-width:10rem" placeholder="${esc(t('spell.sourceNote'))}">
      <button class="inline-create-btn"${dataAction(host.action('builderExtraFeatAdd'), c.id)}>＋ ${esc(t('builder.addExtraFeat'))}</button>
    </div>`;
    const body = rows || `<div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('builder.noExtraFeats'))}</div>`;
    return section(t('builder.extraFeats'), `${body}${adder}`);
  }

  // The applied per-ability deltas for an ability grant (bg ASI / class ASI /
  // half-feat) — the abilityGrants `assign` map is the single source of truth that
  // the engine hydrates, so the number pickers read + write it directly.
  function assignOf(s, id) {
    const g = (Array.isArray(s.abilityGrants) ? s.abilityGrants : []).find((x) => x.id === id);
    return (g && g.assign) || {};
  }

  // "Distribute N points across these abilities" — a +/- stepper per eligible
  // ability sharing a cumulative `budget` (ASI = 2, background = 3, a half-feat =
  // its amount), each capped at `perMax`. Replaces the old split-select dropdowns
  // (B5), mirroring the point-buy stepper; every step routes through builderAsiStep,
  // which re-validates the budget server-side. `key` is the abilityGrant id.
  function abilityBudgetPickers(c, key, eligible, assign, budget, perMax, ro) {
    const spent = eligible.reduce((n, a) => n + num(assign[a], 0), 0);
    const remaining = budget - spent;
    const tiles = eligible.map((a) => {
      const v = num(assign[a], 0);
      // Host `.codex-stepper` (via numField): min 0, max = perMax capped by the
      // budget left for THIS ability (others' spend held fixed), so the ± buttons
      // can't overspend; builderAsiSet re-clamps a typed value the same way.
      const cap = Math.min(perMax, budget - (spent - v));
      const ctrl = ro
        ? `<strong style="color:${v ? 'var(--color-success)' : 'var(--text-muted)'};font-variant-numeric:tabular-nums">${v ? '+' + v : '0'}</strong>`
        : numField(dataOn('change', host.action('builderAsiSet'), c.id, key, a, '$value', budget, perMax), v, { min: 0, max: cap, ariaLabel: t('ability.' + a), width: '3.2rem' });
      return `<div style="text-align:center;background:var(--bg-raised);border-radius:var(--radius);padding:var(--space-2)">
        <div style="font-size:var(--text-xs);color:var(--text-muted)">${esc(t('ability.' + a))}</div>
        <div style="margin-top:var(--space-1);display:flex;justify-content:center">${ctrl}</div>
      </div>`;
    }).join('');
    const remColor = remaining === 0 ? 'var(--text-muted)' : 'var(--accent-gold)';
    const tag = `<span style="font-size:var(--text-xs);font-weight:600;color:${remColor};font-variant-numeric:tabular-nums">${esc(t('builder.pointsLeft', { n: remaining }))}</span>`;
    return `<div style="display:flex;flex-direction:column;gap:var(--space-1)">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(4.5rem,1fr));gap:var(--space-2)">${tiles}</div>
      ${ro ? '' : tag}</div>`;
  }

  // Render one choice descriptor from collectChoices (skills / expertise /
  // weaponMastery / feat / enumerated; asiMode delegates to renderAsiLevel).
  function renderDescriptor(c, s, ch, engine, ro) {
    if (ch.kind === 'asiMode') return renderAsiLevel(c, s, ch, engine, ro);
    const count = Math.max(1, num(ch.count, 1));
    let options = null;
    let label = ch.prompt || titleize(ch.id);
    if (ch.kind === 'skills' || ch.kind === 'expertise') {
      const pool = (ch.kind === 'skills' && Array.isArray(ch.from) && ch.from.length) ? ch.from : SKILLS.map((sk) => sk.id);
      options = pool.map((id) => ({ value: id, label: t('skill.' + id) }));
      label = ch.kind === 'skills' ? t('builder.skillProfs') : t('builder.expertise');
    } else if (Array.isArray(ch.from)) {
      // Values may be feature ids (option pools like Metamagic/maneuvers) — label
      // them by the feature's name rather than a titleized id when resolvable.
      options = ch.from.map((v) => { const fr = engine.getFeature && engine.getFeature(v); return { value: v, label: fr ? fr.name : titleize(v) }; });
    } else if (ch.kind === 'weaponMastery') {
      options = engine.listWeapons().map((w) => ({ value: w.id, label: w.name }));
      label = t('builder.weaponMastery');
    } else if (ch.kind === 'feat') {
      options = engine.listFeats(ch.category ? { category: ch.category } : undefined).map((f) => ({ value: f.id, label: f.name }));
    }
    if (!options || !options.length) {
      return choiceBlock(label, `<span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('builder.contentPending'))}</span>`);
    }
    // Uniqueness across a multi-pick choice (FE-7): a value taken in ANOTHER box is
    // excluded here, so the same option can't be chosen twice. You can still change
    // THIS box to any free option, and changing another box frees its value — the
    // whole-state editor never locks you out of correcting an earlier pick (which is
    // also how a level-up "swap" works: just edit the box). A value that duplicates
    // an earlier box (e.g. legacy stored data) renders empty, to be re-picked.
    const picks = [];
    for (let i = 0; i < count; i++) picks.push(s.featureChoices[count > 1 ? ch.id + '#' + i : ch.id] || '');
    const pickers = [];
    for (let i = 0; i < count; i++) {
      const key = count > 1 ? ch.id + '#' + i : ch.id;
      const mine = picks.slice(0, i).includes(picks[i]) ? '' : picks[i];
      const taken = new Set(picks.filter((p, j) => j !== i && p));
      const opts = options.filter((o) => o.value === mine || !taken.has(o.value));
      pickers.push(`<div style="min-width:9rem">${selectBox(mine, opts, dataOn('change', host.action('builderChoose'), c.id, key, '$value'), t('builder.choose'), ro)}</div>`);
    }
    return choiceBlock(count > 1 ? label + ' (' + count + ')' : label, `<div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">${pickers.join('')}</div>`);
  }

  // ASI-vs-Feat at an ability-score-improvement level (descriptor kind asiMode).
  function renderAsiLevel(c, s, ch, engine, ro) {
    const key = ch.id;   // 'asi:<classId>:<level>'
    const mode = s.featureChoices[key] || '';
    const modeOpts = [
      { value: 'asi', label: t('builder.asiOption') },
      { value: 'feat', label: t('builder.featOption') },
    ];
    const label = t('builder.asiLevel', { cls: (engine.getItem('class', ch.classId) || {}).name || ch.classId, lvl: ch.level });
    let detail = '';
    if (mode === 'asi') {
      // 2024 ASI: distribute 2 points (+2 to one, or +1/+1 to two) — number pickers (B5).
      detail = `<div style="margin-top:var(--space-2)">${abilityBudgetPickers(c, key + ':ability', ABILITIES, assignOf(s, key + ':ability'), 2, 2, ro)}</div>`;
    } else if (mode === 'feat') {
      const featKey = key + ':feat';
      const chosenFeat = s.featureChoices[featKey] || '';
      const featOpts = engine.listFeats({ category: 'general' }).map((f) => ({ value: f.id, label: f.name }));
      const featRec = chosenFeat ? engine.getItem('feat', chosenFeat) : null;
      // Chosen feat → a ↗ link to its compendium page (+ summary hover) beside the
      // picker, since a <select><option> can't itself be a link (B2.2, folded in).
      const featLink = featRec ? ' ' + entityRef('feat', chosenFeat, '↗', featRec.text ? { title: featRec.name, desc: firstPara(featRec.text), aria: featRec.name } : null) : '';
      detail = `<div style="margin-top:var(--space-1);min-width:12rem">${selectBox(chosenFeat, featOpts, dataOn('change', host.action('builderChoose'), c.id, featKey, '$value'), t('builder.choose'), ro)}${featLink}</div>`;
      // Half-feat with a CHOICE of ability → ability sub-pick (AB-2). A fixed
      // single-option bump is auto-applied in builderChoose; granted spells +
      // the applied bump flow through the engine via abilityGrants.
      const asi = featRec && featRec.grants && featRec.grants.abilityScoreIncrease;
      if (asi && Array.isArray(asi.from) && asi.from.length > 1) {
        // Half-feat with a choice of ability → distribute its amount (usually +1) — pickers (B5).
        const amt = Math.max(1, num(asi.amount, 1));
        detail += `<div style="margin-top:var(--space-2)">${abilityBudgetPickers(c, key + ':featability', asi.from, assignOf(s, key + ':featability'), amt, amt, ro)}</div>`;
      }
    }
    return choiceBlock(label, `${selectBox(mode, modeOpts, dataOn('change', host.action('builderChoose'), c.id, key, '$value'), t('builder.choose'), ro)}${detail}`);
  }

  return { panelBuilder };
}

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
  const { host, t, ABILITIES, SKILLS, num, signed, abilityMod, titleize, ui, engine: E, POINT_BUY, pointCost, pointsSpent } = ctx;
  const { esc, dataAction, dataOn } = host.h;
  const { section, miniStat, selectBox, fieldRow, choiceBlock, warningsBlock, numField, statTip } = ui;
  const { builderModel, collectChoices } = E;

  // Href into the Player's Handbook compendium (the handbook addon owns the
  // `/compendium` route). Callers gate on a resolved record, so without the book
  // the name stays plain text (no dead link).
  const compendiumHref = (kind, id) => `#/compendium/${kind}:${id}`;

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

    return `
      <div style="display:flex;flex-direction:column;gap:var(--space-5)">
        ${warningsBlock(warnings)}
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">${summary}</div>
        ${builderAbilities(c, s, base, comp, ro)}
        ${builderIdentity(c, s, engine, ro)}
        ${builderClasses(c, classes, engine, ro)}
        ${builderChoices(c, s, classes, engine, comp, ro)}
        ${builderLog(classes, engine, comp)}
      </div>`;
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
      const canDec = !ro && b > POINT_BUY.min;
      const canInc = !ro && b < POINT_BUY.max && (spent - pointCost(b) + pointCost(b + 1)) <= POINT_BUY.budget;
      const stepBtn = (dir, sym, on, title) => `<button class="inline-create-btn" title="${esc(title)}" style="min-width:1.9rem;padding:var(--space-1) var(--space-2);opacity:${on ? '1' : '.35'}"${on ? '' : ' disabled'}${on ? dataAction(host.action('builderAbilityStep'), c.id, a, dir) : ''}>${sym}</button>`;
      const ctrl = ro
        ? `<div style="color:var(--text-parchment);font-weight:700;font-size:var(--text-lg)">${esc(String(b))}</div>`
        : `<div style="display:flex;align-items:center;justify-content:center;gap:var(--space-1)">${stepBtn(-1, '−', canDec, t('tracker.minus'))}<strong style="color:var(--text-parchment);font-size:var(--text-lg);min-width:1.5rem;text-align:center;font-variant-numeric:tabular-nums">${esc(String(b))}</strong>${stepBtn(1, '＋', canInc, t('tracker.plus'))}</div>`;
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

  // Classes: ordered classes[] with class / level / subclass + add/remove.
  function builderClasses(c, classes, engine, ro) {
    const classOpts = engine.listClasses().map((o) => ({ value: o.id, label: o.name }));
    const rows = classes.map((cl, idx) => {
      const rec = cl.classId ? engine.getItem('class', cl.classId) : null;
      const subLevel = rec ? num(rec.subclassLevel, 3) : 3;
      const subOpts = engine.listSubclasses(cl.classId).map((o) => ({ value: o.id, label: o.name }));
      const showSub = rec && num(cl.level, 1) >= subLevel;
      const levelCtl = ro
        ? `<span style="color:var(--text-parchment)">${esc(String(num(cl.level, 1)))}</span>`
        : numField(dataOn('change', host.action('builderLevelSet'), c.id, idx, '$value'), num(cl.level, 1), { min: 1, max: 20, ariaLabel: t('field.level') });
      const removeBtn = (!ro && classes.length > 1) ? `<button class="inline-create-btn" title="${esc(t('action.remove'))}"${dataAction(host.action('builderRemoveClass'), c.id, idx)}>✕</button>` : '';
      return `<div style="display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;padding:var(--space-1) 0;border-bottom:1px solid rgba(var(--gold-muted),.12)">
        <div style="min-width:9rem">${selectBox(cl.classId, classOpts, dataOn('change', host.action('builderClassSet'), c.id, idx, '$value'), t('builder.choose'), ro)}</div>
        <span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('field.level'))}</span> ${levelCtl}
        ${showSub ? `<div style="min-width:9rem">${selectBox(cl.subclass, subOpts, dataOn('change', host.action('builderSubclassSet'), c.id, idx, '$value'), t('builder.subclass'), ro)}</div>` : ''}
        ${removeBtn}
      </div>`;
    }).join('');
    const addBtn = ro ? '' : `<button class="inline-create-btn" style="margin-top:var(--space-2)"${dataAction(host.action('builderAddClass'), c.id)}>＋ ${esc(t('builder.addClass'))}</button>`;
    return section(t('builder.classes'), rows + addBtn);
  }

  // Choices: background ASI + per-class grant choices + ASI-level feat/ASI.
  // Collected from the build; resolutions persist in featureChoices / grants.
  function builderChoices(c, s, classes, engine, comp, ro) {
    const blocks = [];

    // Background ASI (AB-1).
    const bgRec = s.background ? (engine.getItemByName('background', s.background) || engine.getItem('background', s.background)) : null;
    if (bgRec && Array.isArray(bgRec.abilityScores) && bgRec.abilityScores.length) {
      const abil = bgRec.abilityScores;
      const splits = [];
      for (const x of abil) for (const y of abil) if (x !== y) splits.push({ value: `${x}:2,${y}:1`, label: `+2 ${x}, +1 ${y}` });
      splits.push({ value: abil.map((a) => a + ':1').join(','), label: '+1 ' + abil.join(', +1 ') });
      const cur = s.featureChoices['bgasi'] || '';
      blocks.push(choiceBlock(t('builder.bgAsi', { bg: bgRec.name }), selectBox(cur, splits, dataOn('change', host.action('builderBgAsi'), c.id, '$value'), t('builder.choose'), ro)));
      if (bgRec.originFeat) blocks.push(`<div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('builder.originFeat', { feat: titleize(bgRec.originFeat) }))}</div>`);
    }

    // Per-class choices (skills / grants / ASI levels) from the shared collector.
    for (const ch of collectChoices(classes, engine)) blocks.push(renderDescriptor(c, s, ch, engine, ro));

    if (!blocks.length) return '';
    return section(t('builder.choices'), `<div style="display:flex;flex-direction:column;gap:var(--space-2)">${blocks.join('')}</div>`);
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
    const pickers = [];
    for (let i = 0; i < count; i++) {
      const key = count > 1 ? ch.id + '#' + i : ch.id;
      pickers.push(`<div style="min-width:9rem">${selectBox(s.featureChoices[key] || '', options, dataOn('change', host.action('builderChoose'), c.id, key, '$value'), t('builder.choose'), ro)}</div>`);
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
      const abilKey = key + ':ability';
      detail = `<div style="margin-top:var(--space-1);min-width:9rem">${selectBox(s.featureChoices[abilKey] || '', ABILITIES.map((a) => ({ value: a, label: t('ability.' + a) })), dataOn('change', host.action('builderChoose'), c.id, abilKey, '$value'), t('builder.asiAbility'), ro)}</div>`;
    } else if (mode === 'feat') {
      const featKey = key + ':feat';
      const chosenFeat = s.featureChoices[featKey] || '';
      const featOpts = engine.listFeats({ category: 'general' }).map((f) => ({ value: f.id, label: f.name }));
      detail = `<div style="margin-top:var(--space-1);min-width:12rem">${selectBox(chosenFeat, featOpts, dataOn('change', host.action('builderChoose'), c.id, featKey, '$value'), t('builder.choose'), ro)}</div>`;
      // Half-feat with a CHOICE of ability → ability sub-pick (AB-2). A fixed
      // single-option bump is auto-applied in builderChoose; granted spells +
      // the applied bump flow through the engine via abilityGrants.
      const featRec = chosenFeat ? engine.getItem('feat', chosenFeat) : null;
      const asi = featRec && featRec.grants && featRec.grants.abilityScoreIncrease;
      if (asi && Array.isArray(asi.from) && asi.from.length > 1) {
        const abilKey = key + ':featability';
        detail += `<div style="margin-top:var(--space-1);min-width:9rem">${selectBox(s.featureChoices[abilKey] || '', asi.from.map((a) => ({ value: a, label: t('ability.' + a) })), dataOn('change', host.action('builderChoose'), c.id, abilKey, '$value'), t('builder.asiAbility'), ro)}</div>`;
      }
    }
    return choiceBlock(label, `${selectBox(mode, modeOpts, dataOn('change', host.action('builderChoose'), c.id, key, '$value'), t('builder.choose'), ro)}${detail}`);
  }

  // First paragraph of a feature's prose, flattened for the hover card. statTip
  // renders `desc` as ESCAPED plain text, so drop a leading heading + emphasis
  // markers and collapse whitespace; cap the length so the card stays compact.
  function firstPara(md) {
    const body = String(md || '').replace(/\r/g, '').replace(/^#{1,6}\s+[^\n]*\n+/, '').trim();
    const para = (body.split(/\n\s*\n/)[0] || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return para.length > 300 ? para.slice(0, 297) + '…' : para;
  }

  // Resolve a shown feature (class OR subclass) → its `feature` record, for the
  // hover card + link. Subclass features resolve within the selected subclass (by
  // name, then by local id). Class features join by (classId, level, name) with a
  // level-agnostic and a shared-generic (ASI / Epic Boon, classId null) fallback.
  // Returns null (→ statTip shows a plain name) when the book addon predates
  // feature records.
  function featureRecordFor(engine, cl, level, f) {
    if (!engine.listFeatures || !engine.getFeature) return null;
    const norm = (x) => String(x || '').trim().toLowerCase();
    const name = f.name || titleize(f.id);   // class features carry the name in `id` (no `name`)
    if (f.source && f.source.type === 'subclass') {
      const subs = engine.listFeatures({ subclassId: f.source.id });
      const hit = subs.find((x) => norm(x.name) === norm(name)) || subs.find((x) => x.localId === f.id);
      return hit ? engine.getFeature(hit.id) : null;
    }
    const owned = engine.listFeatures({ classId: cl.classId });
    const hit = owned.find((x) => !x.subclassId && x.level === level && norm(x.name) === norm(name))
             || owned.find((x) => !x.subclassId && norm(x.name) === norm(name))
             || engine.listFeatures().find((x) => x.classId == null && norm(x.name) === norm(name));
    return hit ? engine.getFeature(hit.id) : null;
  }

  // Progression log — what each level granted (the "when did I choose what").
  function builderLog(classes, engine, comp) {
    const features = (comp && comp.features) || [];
    const rows = [];
    let charLvl = 0;
    for (const cl of classes) {
      const rec = cl.classId ? engine.getItem('class', cl.classId) : null;
      const clsName = rec ? rec.name : (cl.classId || '?');
      for (let l = 1; l <= num(cl.level, 1); l++) {
        charLvl++;
        // Feature names for this class-level, each wrapped in a hover card that
        // reveals the feature's prose (statTip degrades to the bare name if the
        // record is missing). Each name is esc()'d inside the trigger, so the
        // joined result is HTML and must NOT be re-escaped.
        // This class's features at this level: CLASS features (source.id = classId)
        // AND the selected subclass's features (source.id = the subclass id).
        const feats = features
          .filter((f) => f.source && num(f.source.level) === l && (f.source.type === 'subclass' ? f.source.id === cl.subclass : f.source.id === cl.classId))
          .map((f) => {
            const name = f.name || titleize(f.id);
            const recF = featureRecordFor(engine, cl, l, f);
            // When the feature resolves to a record, its name links to the compendium
            // detail page; otherwise (no book / unresolved) it stays plain text.
            const inner = (recF && recF.id)
              ? `<a href="${esc(compendiumHref('feature', recF.id))}">${esc(name)}</a>`
              : `<span>${esc(name)}</span>`;
            const legend = recF && recF.text ? { title: recF.name || name, desc: firstPara(recF.text), aria: name } : null;
            return statTip(inner, legend, { underline: true });
          });
        rows.push(`<div style="display:flex;gap:var(--space-2);padding:var(--space-1) 0;border-bottom:1px solid rgba(var(--gold-muted),.1);font-size:var(--text-sm)">
          <span style="color:var(--text-muted);min-width:2.5rem">L${esc(String(charLvl))}</span>
          <span style="color:var(--text-light);min-width:7rem">${esc(clsName)} ${esc(String(l))}</span>
          <span style="color:var(--text-parchment);flex:1">${feats.length ? feats.join(', ') : '<span style="color:var(--text-muted)">—</span>'}</span>
        </div>`);
      }
    }
    if (!rows.length) return '';
    return section(t('builder.progression'), rows.join(''));
  }

  return { panelBuilder };
}

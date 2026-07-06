// ═══════════════════════════════════════════════════════════════
//  panel.print.js — a self-contained, print / PDF-friendly character sheet.
//
//  Opened in a NEW WINDOW by the `printSheet` action, so it is isolated from the
//  host chrome AND the host theme (its CSS vars + component classes live only in
//  the host page). It therefore ships its OWN inline light-theme styles (good on
//  paper) and pulls from the computed sheet (`comp`) + `viewModel`, degrading to
//  the hand-filled flat fields when the engine is absent. Labels are English (the
//  addon ships EN only today); i18n of the print sheet can follow localization.
//  (B4.6)
// ═══════════════════════════════════════════════════════════════

export function makePrintPanel(ctx) {
  const { host, t, ABILITIES, SKILLS, num, signed, abilityMod, titleize, viewModel } = ctx;
  const { esc } = host.h;

  const spellName = (engine, ref) => {
    const r = engine && engine.getItem ? engine.getItem('spell', ref) : null;
    return esc(r ? r.name : String(ref));
  };

  // Build a full standalone HTML document (doctype→body) for a new print window.
  function buildPrintHtml(c, s, comp, engine) {
    const vm = viewModel(s, comp);
    const name = esc((c && c.name) || t('misc.unnamed'));
    const total = comp ? num(comp.totalLevel, num(s.level, 1)) : num(s.level, 1);

    // Identity line — classes from the builder model when present, else className.
    const classes = (Array.isArray(s.classes) ? s.classes : []).filter((cl) => cl.classId);
    const classStr = classes.length
      ? classes.map((cl) => {
        const cn = (engine && engine.getItem ? (engine.getItem('class', cl.classId) || {}).name : '') || titleize(cl.classId);
        const sub = cl.subclass ? ' (' + ((engine && engine.getItem && (engine.getItem('subclass', cl.subclass) || {}).name) || titleize(cl.subclass)) + ')' : '';
        return esc(cn + ' ' + num(cl.level, 1) + sub);
      }).join(' / ')
      : esc(s.className || '');
    const ident = [classStr, s.race && esc(s.race), s.background && esc(s.background), s.alignment && esc(s.alignment)].filter(Boolean).join(' · ');

    // Ability scores + saves.
    const abilCells = ABILITIES.map((a) => {
      const score = comp && comp.abilities && comp.abilities[a] ? num(comp.abilities[a].score, num(s.abilities[a], 10)) : num(s.abilities[a], 10);
      const mod = comp && comp.abilities && comp.abilities[a] ? num(comp.abilities[a].mod, abilityMod(score)) : abilityMod(score);
      const sv = vm.save(a);
      return `<div class="cell"><div class="k">${esc(a)}</div><div class="big">${esc(String(score))}</div><div>${esc(signed(mod))}</div><div class="k">save ${esc(signed(sv.total))}${sv.prof ? ' &#9679;' : ''}</div></div>`;
    }).join('');

    // Combat vitals.
    const vit = [['AC', vm.ac], ['HP', vm.maxHp], ['Init', signed(vm.init)], ['Speed', vm.speed], ['Prof', signed(vm.pb)], ['Passive Perc', vm.passivePerc]]
      .map(([k, v]) => `<div class="cell"><div class="k">${esc(k)}</div><div class="big">${esc(String(v))}</div></div>`).join('');

    // Skills.
    const skills = SKILLS.map((sk) => {
      const x = vm.skill(sk.id, sk.ability);
      return `<div>${x.prof ? '&#9679;' : '&#9675;'} ${esc(t('skill.' + sk.id))} <b>${esc(signed(x.total))}</b> <span class="k">${esc(sk.ability)}</span></div>`;
    }).join('');

    // Attacks (engine-computed weapons).
    const weapons = (comp && comp.weapons) || [];
    const attacks = weapons.length
      ? `<table>${weapons.map((w) => `<tr><td>${esc(w.name)}</td><td>${esc(signed(num(w.attackBonus)))}</td><td>${esc(w.damage || '')}${w.damageType ? ' ' + esc(w.damageType) : ''}</td></tr>`).join('')}</table>`
      : '';

    // Features.
    const features = (comp && comp.features) || [];
    const featList = features.length
      ? `<ul class="feat">${features.map((f) => `<li>${esc(f.name || titleize(f.id))}${f.source && f.source.level ? ' <span class="k">L' + esc(String(f.source.level)) + '</span>' : ''}</li>`).join('')}</ul>`
      : '';

    // Spellcasting.
    let spells = '';
    const sc = comp && comp.spellcasting;
    if (sc && Array.isArray(sc.perClass) && sc.perClass.length) {
      const per = sc.perClass.map((p) => {
        const cants = ((s.cantrips && s.cantrips[p.classId]) || []).map((r) => spellName(engine, r));
        const prep = ((s.preparedSpells && s.preparedSpells[p.classId]) || []).map((r) => spellName(engine, r));
        const cn = (engine && engine.getItem && (engine.getItem('class', p.classId) || {}).name) || titleize(p.classId);
        return `<div style="margin-bottom:4px"><b>${esc(cn)}</b> &mdash; DC ${esc(String(num(p.saveDC)))}, atk ${esc(signed(num(p.spellAttack)))}${p.pact ? ', pact ' + num(p.pact.slots) + '&times;L' + num(p.pact.level) : ''}
          ${cants.length ? `<div><span class="k">Cantrips:</span> ${cants.join(', ')}</div>` : ''}
          ${prep.length ? `<div><span class="k">Prepared:</span> ${prep.join(', ')}</div>` : ''}</div>`;
      }).join('');
      const slots = (sc.slots || []).map((n, i) => (n > 0 ? 'L' + (i + 1) + ':' + n : '')).filter(Boolean).join('  ');
      const granted = (sc.granted || []).map((g) => esc(g.name)).join(', ');
      spells = `${per}${slots ? `<div><span class="k">Slots:</span> ${esc(slots)}</div>` : ''}${granted ? `<div><span class="k">Always prepared:</span> ${granted}</div>` : ''}`;
    }
    const extraSpells = (s.spells || []).map((sp) => esc(sp.name || '')).filter(Boolean).join(', ');

    // Equipment + currency.
    const inv = (s.inventory || []).map((it) => `<li>${esc(it.name || '')}${num(it.qty, 1) !== 1 ? ' &times;' + num(it.qty, 1) : ''}${it.location ? ' <span class="k">' + esc(it.location) + '</span>' : ''}</li>`).join('');
    const coins = ['pp', 'gp', 'ep', 'sp', 'cp'].map((k) => { const v = num((s.currency || {})[k], 0); return v ? v + ' ' + k : ''; }).filter(Boolean).join(', ');

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><style>
      @page { margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; color:#1a1a1a; background:#fff; margin:0; padding:16px; font-size:12px; line-height:1.45; }
      h1 { font-size:20px; margin:0; }
      h2 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#555; border-bottom:1px solid #999; margin:14px 0 6px; padding-bottom:2px; }
      .sub { color:#555; margin:2px 0 4px; }
      .row { display:grid; gap:6px; } .abil,.vit { grid-template-columns:repeat(6,1fr); } .sk { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .cell { border:1px solid #ccc; border-radius:6px; padding:4px; text-align:center; }
      .k { color:#777; font-size:10px; } .big { font-size:17px; font-weight:600; }
      table { border-collapse:collapse; width:100%; } td { padding:2px 6px; border-bottom:1px solid #eee; }
      ul { margin:4px 0; padding-left:18px; } ul.feat { columns:2; -webkit-columns:2; }
    </style></head><body>
      <h1>${name}</h1>
      <div class="sub">${ident ? ident + ' &middot; ' : ''}Level ${esc(String(total))}</div>
      <h2>Ability Scores</h2><div class="row abil">${abilCells}</div>
      <h2>Combat</h2><div class="row vit">${vit}</div>
      ${attacks ? '<h2>Attacks</h2>' + attacks : ''}
      <h2>Skills</h2><div class="row sk">${skills}</div>
      ${featList ? '<h2>Features</h2>' + featList : ''}
      ${spells ? '<h2>Spells</h2>' + spells : ''}
      ${extraSpells ? '<h2>Other spells</h2><div>' + extraSpells + '</div>' : ''}
      ${(inv || coins) ? '<h2>Equipment</h2>' + (coins ? '<div><span class="k">Coins:</span> ' + esc(coins) + '</div>' : '') + (inv ? '<ul>' + inv + '</ul>' : '') : ''}
    </body></html>`;
  }

  return { buildPrintHtml };
}

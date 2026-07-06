// ═══════════════════════════════════════════════════════════════
//  panel.header.js — the slim D&D vitals bar (shown on the mechanical tabs).
//
//  The host's native side-card owns name / portrait / species / facts, so this
//  bar adds ONLY the D&D bits: a class / level line and the vital stat strip
//  (HP / AC / Initiative / Speed / Proficiency / Passive Perception).
//
//  HP is the live-play centrepiece: a vertical control with ＋ (heal) on top and
//  − (damage) on bottom flanking the current/max, plus a manual amount you can
//  type to heal or take a chunk of damage at once (no clicking ± 27×). Damage
//  eats Temp HP first. AC / Init / Speed / Proficiency come from the build:
//  engine-mode read-only (fill them in the Builder), standalone hand-editable.
//
//  Every vital carries a hover/focus legend (statTip) that explains what it is,
//  its formula, and the exact terms that sum to the number (UX-7).
// ═══════════════════════════════════════════════════════════════

export function makeHeaderPanel(ctx) {
  const { host, t, num, signed, firstPara, ui, viewModel, legends } = ctx;
  const { esc, dataAction } = host.h;
  const { heroTile, numField, statTip, entityRef } = ui;

  const hpColor = (cur, max) => {
    if (max <= 0) return 'var(--text-parchment)';
    if (cur <= 0 || cur / max <= 0.35) return 'var(--color-danger)';
    if (cur / max <= 0.65) return 'var(--priority-medium)';
    return 'var(--text-parchment)';
  };

  // One computed vital tile (AC / Init / Speed / Proficiency / Passive). The
  // value carries a legend; editing is standalone-only (`!vm.auto`) since the
  // engine builds these. `align` biases the popover off a container edge.
  function vital(cid, label, field, display, vm, editable, legend, opts) {
    opts = opts || {};
    const editHtml = (editable && !vm.auto && field)
      ? `<div style="margin-top:var(--space-1);display:flex;justify-content:center">${numField(host.h.dataOn('change', host.action('setField'), cid, field, '$value'), num(display), { min: field === 'speed' ? 0 : null, ariaLabel: label })}</div>`
      : '';
    const valueHtml = statTip(`<span>${esc(String(display))}</span>`, legend, { align: opts.align, underline: true });
    return heroTile(label, valueHtml, { accent: opts.accent, editHtml });
  }

  function vitalsBar(c, s, comp, editable, engine) {
    const vm = viewModel(s, comp);
    const L = legends(s, comp, vm);
    const cid = c.id;
    const cur = num(s.hp, 0), max = vm.maxHp, temp = num(s.tempHp, 0);

    // D&D identity line — class / level / subclass (NOT host fields). Class +
    // subclass names link to their compendium pages when the book resolves them
    // (engine mode); we format via the i18n template with a placeholder token, then
    // splice the linked HTML in AFTER escaping the surrounding translated text.
    const clsPlain = [s.className, s.subclass ? '(' + s.subclass + ')' : ''].filter(Boolean).join(' ');
    let idHtml = '';
    if (clsPlain) {
      const byName = (kind, name) => (engine && name && engine.getItemByName) ? engine.getItemByName(kind, name) : null;
      const mkLegend = (rec) => (rec && rec.text) ? { title: rec.name, desc: firstPara(rec.text), aria: rec.name } : null;
      const clsRec = byName('class', s.className);
      const subRec = byName('subclass', s.subclass);
      const clsHtml = s.className ? entityRef('class', clsRec && clsRec.id, s.className, mkLegend(clsRec)) : '';
      const subHtml = s.subclass ? ' (' + entityRef('subclass', subRec && subRec.id, s.subclass, mkLegend(subRec)) + ')' : '';
      const TOKEN = '@@CLS@@';
      const line = t('sheet.summary', { level: num(s.level, 1), cls: TOKEN }).trim();
      idHtml = `<div style="color:var(--text-light);font-size:var(--text-sm);font-weight:600;letter-spacing:.02em">${esc(line).replace(TOKEN, (clsHtml + subHtml).trim())}</div>`;
    }

    const strip = [
      hpTile(cid, cur, max, temp, editable, vm, L),
      vital(cid, t('stat.ac'), 'ac', vm.ac, vm, editable, L.ac(), { accent: true, align: 'l' }),
      vital(cid, t('stat.init'), 'initiative', signed(vm.init), vm, editable, L.init()),
      vital(cid, t('stat.speed'), 'speed', vm.speed, vm, editable, L.speed()),
      vital(cid, t('stat.pb'), 'profBonus', signed(vm.pb), vm, editable, L.pb(), { align: 'r' }),
      vital(cid, t('stat.passivePercAbbr'), null, vm.passivePerc, vm, editable, L.passive(), { align: 'r' }),
    ].join('');

    return `<div style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-4)">
      ${idHtml}
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:flex-start">${strip}</div>
    </div>`;
  }

  // ── HP tile — the live-play centrepiece. ＋ (heal) top / − (damage) bottom
  //    flank the current/max; a manual amount lets you heal or take a hit of any
  //    size at once. Temp HP shows beneath; Max/Temp are editable (Max standalone
  //    only). The whole current/max carries the HP legend. ──
  function hpTile(cid, cur, max, temp, editable, vm, L) {
    const hpVal = statTip(
      `<span style="color:${hpColor(cur, max)}">${esc(String(cur))}</span><span style="color:var(--text-muted);font-size:var(--text-lg)"> / ${esc(String(max))}</span>`,
      L.hp(), { align: 'l' });
    const tempSub = temp > 0 ? `<div style="font-size:var(--text-xs);color:var(--color-success);margin-top:1px">+${esc(String(temp))} ${esc(t('stat.temp'))}</div>` : '';

    // Read view (anonymous): just the number + temp, no controls.
    if (!editable) {
      return `<div class="codex-tile codex-tile-accent codex-tile-wide">
        <div class="codex-tile-label">${esc(t('stat.hp'))}</div>
        <div class="codex-tile-value">${hpVal}</div>${tempSub}</div>`;
    }

    const stepBtn = (delta, sym, title, col) =>
      `<button class="inline-create-btn" title="${esc(title)}" style="min-width:2.2rem;font-size:var(--text-lg);line-height:1;color:${col}"${dataAction(host.action('hp'), cid, delta)}>${sym}</button>`;
    // Vertical ± with the current/max between them.
    const vertical = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      ${stepBtn(1, '＋', t('action.hpPlus'), 'var(--color-success)')}
      <div class="codex-tile-value">${hpVal}</div>
      ${stepBtn(-1, '−', t('action.hpMinus'), 'var(--color-danger)')}</div>`;

    // Manual amount → Heal / Damage by any number at once.
    const amount = `<div style="display:flex;gap:var(--space-1);justify-content:center;align-items:center;margin-top:var(--space-2);flex-wrap:wrap">
      <input id="dse-hp-amt-${esc(cid)}" class="edit-input" type="number" min="1" inputmode="numeric" style="width:3.4rem;text-align:center" placeholder="${esc(t('hp.amount'))}" aria-label="${esc(t('hp.amountAria'))}">
      <button class="inline-create-btn" title="${esc(t('hp.healBy'))}" style="color:var(--color-success)"${dataAction(host.action('hpApply'), cid, 1)}>${esc(t('hp.heal'))}</button>
      <button class="inline-create-btn" title="${esc(t('hp.damageBy'))}" style="color:var(--color-danger)"${dataAction(host.action('hpApply'), cid, -1)}>${esc(t('hp.damage'))}</button>
    </div>`;

    // Max (standalone only — engine computes it) + Temp HP, small labelled fields.
    const lbl = (txt, field, value, min) => `<label style="display:inline-flex;flex-direction:column;align-items:center;gap:1px;font-size:var(--text-xs);color:var(--text-muted)"><span>${esc(txt)}</span>${numField(host.h.dataOn('change', host.action('setField'), cid, field, '$value'), value, { min, ariaLabel: txt })}</label>`;
    const maxEd = !vm.auto ? lbl(t('field.maxHp'), 'maxHp', max, 0) : '';
    const tempEd = lbl(t('stat.temp'), 'tempHp', temp, 0);
    const fields = `<div style="display:flex;gap:var(--space-2);justify-content:center;flex-wrap:wrap;margin-top:var(--space-2)">${maxEd}${tempEd}</div>`;

    return `<div class="codex-tile codex-tile-accent codex-tile-wide" style="min-width:9.5rem">
      <div class="codex-tile-label">${esc(t('stat.hp'))}</div>
      ${vertical}${tempSub}${amount}${fields}</div>`;
  }

  return { vitalsBar };
}

// ═══════════════════════════════════════════════════════════════
//  panel.header.js — the slim D&D vitals bar (shown on the mechanical tabs).
//
//  The host's native side-card owns name / portrait / species / facts, so this
//  bar adds ONLY the D&D bits: a class / level line and the vital stat strip
//  (HP / AC / Initiative / Speed / Proficiency / Passive Perception).
//
//  HP is the live-play centrepiece: the current HP is a directly-editable host
//  stepper (type a value, or ± by 1; clamped to [0,max]) with Max + Temp HP as
//  small steppers beneath. AC / Init / Speed / Proficiency come from the build:
//  engine-mode read-only (fill them in the Builder), standalone hand-editable.
//
//  Every vital carries a hover/focus legend (statTip) that explains what it is,
//  its formula, and the exact terms that sum to the number (UX-7).
// ═══════════════════════════════════════════════════════════════

export function makeHeaderPanel(ctx) {
  const { host, t, num, signed, firstPara, ui, viewModel, legends } = ctx;
  const { esc } = host.h;
  const { heroTile, numField, statTip, entityRef } = ui;

  // Vitals glyphs come from the host's shared stat-icon set (`h.icon` → a
  // `.codex-icon` SVG, stroke:currentColor — inside the tile label slot it
  // inherits the muted label colour). A compact icon reads faster and sits
  // narrower than a spelled-out stat name (the tile keeps the full label as
  // its title + the slot's aria-label). Feature-detected: on an older host
  // icon() returns '' and every call site falls back to its text label.
  const GLYPH = { hp: 'heart', ac: 'shield', init: 'bolt', speed: 'chevrons', pb: 'medal', passive: 'eye' };
  const icon = (name) => (typeof host.h.icon === 'function') ? host.h.icon(GLYPH[name] || name) : '';

  // Shield-equipped indicator for the AC tile: a filled circle when a shield contributes
  // to AC, an outline circle when it doesn't (mirrors the proficiency dots). Engine-only
  // (the bonus comes from comp.ac.shield); standalone AC is hand-entered, so it's omitted.
  const shieldDot = (equipped) => {
    const c = equipped
      ? `<circle cx="8" cy="8" r="4.2" fill="var(--accent-gold)"/>`
      : `<circle cx="8" cy="8" r="3.6" fill="none" stroke="var(--text-muted)" stroke-width="1.6"/>`;
    const svg = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" style="display:block">${c}</svg>`;
    return `<span title="${esc(equipped ? t('stat.shieldOn') : t('stat.shieldOff'))}" style="display:inline-flex;align-items:center;gap:3px">${svg}${esc(t('stat.shield'))}</span>`;
  };

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
    return heroTile(label, valueHtml, { accent: opts.accent, editHtml, icon: opts.icon, sub: opts.sub });
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
      vital(cid, t('stat.ac'), 'ac', vm.ac, vm, editable, L.ac(), { accent: true, align: 'l', icon: icon('ac'), sub: (comp && comp.ac) ? shieldDot(num(comp.ac.shield, 0) > 0) : '' }),
      vital(cid, t('stat.init'), 'initiative', signed(vm.init), vm, editable, L.init(), { icon: icon('init') }),
      vital(cid, t('stat.speed'), 'speed', vm.speed, vm, editable, L.speed(), { icon: icon('speed') }),
      vital(cid, t('stat.pb'), 'profBonus', signed(vm.pb), vm, editable, L.pb(), { align: 'r', icon: icon('pb') }),
      vital(cid, t('stat.passivePercAbbr'), null, vm.passivePerc, vm, editable, L.passive(), { align: 'r', icon: icon('passive') }),
    ].join('');

    return `<div style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-4)">
      ${idHtml}
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:flex-start">${strip}</div>
    </div>`;
  }

  // ── HP tile — the live-play centrepiece. The current HP is a directly-editable
  //    host `.codex-stepper` (type a value, or ± by 1; clamped to [0,max] by
  //    setField), with Max (standalone only) + Temp HP as small steppers beneath —
  //    no more separate heal/damage-by-amount field. The "/ max" carries the HP
  //    legend; the stepper border flags "bloodied" (≤35%). ──
  function hpTile(cid, cur, max, temp, editable, vm, L) {
    const hpVal = statTip(
      `<span style="color:${hpColor(cur, max)}">${esc(String(cur))}</span><span style="color:var(--text-muted);font-size:var(--text-lg)"> / ${esc(String(max))}</span>`,
      L.hp(), { align: 'l' });
    const hpGlyph = icon('hp');
    const hpLabel = hpGlyph
      ? `<div class="codex-tile-label" role="img" aria-label="${esc(t('stat.hp'))}" style="line-height:0">${hpGlyph}</div>`
      : `<div class="codex-tile-label">${esc(t('stat.hp'))}</div>`;

    // Read view (anonymous): just the number + temp, no controls.
    if (!editable) {
      const tempSub = temp > 0 ? `<div style="font-size:var(--text-xs);color:var(--color-success);margin-top:1px">+${esc(String(temp))} ${esc(t('stat.temp'))}</div>` : '';
      return `<div class="codex-tile codex-tile-accent codex-tile-wide">
        ${hpLabel}
        <div class="codex-tile-value">${hpVal}</div>${tempSub}</div>`;
    }

    // Editable current HP — one host stepper: type or ± by 1, clamped [0,max] by
    // setField. A red stepper border flags bloodied. Max shown beside (carries the legend).
    const bloodied = max > 0 && (cur <= 0 || cur / max <= 0.35);
    const curField = numField(host.h.dataOn('change', host.action('setField'), cid, 'hp', '$value'), cur,
      { min: 0, max: max > 0 ? max : null, ariaLabel: t('stat.hp'), width: '3.6rem', wrapStyle: 'font-size:1.5rem' + (bloodied ? ';border-color:var(--color-danger)' : '') });
    const maxOut = statTip(`<span style="color:var(--text-muted);font-size:var(--text-lg);font-variant-numeric:tabular-nums"> / ${esc(String(max))}</span>`, L.hp(), { align: 'l', underline: true });
    const hpRow = `<div style="display:flex;align-items:center;justify-content:center;gap:var(--space-2)">${curField}${maxOut}</div>`;

    // Max (standalone only — engine computes it) + Temp HP, small labelled steppers.
    const lbl = (txt, field, value, min) => `<label style="display:inline-flex;flex-direction:column;align-items:center;gap:1px;font-size:var(--text-xs);color:var(--text-muted)"><span>${esc(txt)}</span>${numField(host.h.dataOn('change', host.action('setField'), cid, field, '$value'), value, { min, ariaLabel: txt })}</label>`;
    const maxEd = !vm.auto ? lbl(t('field.maxHp'), 'maxHp', max, 0) : '';
    const tempEd = lbl(t('stat.temp'), 'tempHp', temp, 0);
    const fields = `<div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap;margin-top:var(--space-2)">${maxEd}${tempEd}</div>`;

    return `<div class="codex-tile codex-tile-accent codex-tile-wide" style="min-width:9.5rem">
      ${hpLabel}
      ${hpRow}${fields}</div>`;
  }

  return { vitalsBar };
}

// ═══════════════════════════════════════════════════════════════
//  panel.header.js — the slim D&D vitals bar (shown on the mechanical tabs).
//
//  The host's native side-card owns name / portrait / species / facts, so this
//  bar adds ONLY the D&D bits: a class / level line and the vital stat strip
//  (HP / AC / Initiative / Speed / Proficiency / Passive Perception, plus —
//  engine mode, per casting class — Spell Save DC / Spell Attack).
//
//  HP is the live-play centrepiece: one host stepper holds "cur / max" as a
//  single counter (type a value, or ± the current by 1; clamped to [0,max])
//  with Max + Temp HP as small steppers beneath. AC / Init / Speed / Proficiency
//  come from the build:
//  engine-mode read-only (fill them in the Builder), standalone hand-editable.
//
//  Every vital carries a hover/focus legend (statTip) that explains what it is,
//  its formula, and the exact terms that sum to the number (UX-7).
// ═══════════════════════════════════════════════════════════════

export function makeHeaderPanel(ctx) {
  const { host, t, num, signed, titleize, firstPara, ui, viewModel, legends } = ctx;
  const { esc } = host.h;
  const { heroTile, numField, statTip, entityRef } = ui;

  // Shield-equipped indicator for the AC tile: the shield SHAPE itself — filled
  // gold when a shield contributes to AC, an empty outline struck through when
  // none is equipped. Inline SVG (a domain indicator like the proficiency dots,
  // not a stat glyph) reusing the host icon set's shield path so the silhouette
  // matches the rest of the app. Engine-only (the bonus comes from
  // comp.ac.shield); standalone AC is hand-entered, so it's omitted.
  const SHIELD_PATH = 'M12 2.6 19 5.3V11C19 15.6 16 19.4 12 21.4 8 19.4 5 15.6 5 11V5.3Z';
  const shieldMark = (equipped) => {
    const body = equipped
      ? `<path d="${SHIELD_PATH}" fill="var(--accent-gold)" stroke="var(--accent-gold)" stroke-width="1.6" stroke-linejoin="round"/>`
      : `<path d="${SHIELD_PATH}" fill="none" stroke="var(--text-muted)" stroke-width="1.6" stroke-linejoin="round"/>`
        + `<line x1="4.2" y1="3.4" x2="19.8" y2="20.6" stroke="var(--text-muted)" stroke-width="1.6" stroke-linecap="round"/>`;
    const label = equipped ? t('stat.shieldOn') : t('stat.shieldOff');
    return `<span title="${esc(label)}" role="img" aria-label="${esc(label)}" style="display:inline-flex;justify-content:center;line-height:0">`
      + `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">${body}</svg></span>`;
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
    return heroTile(label, valueHtml, { accent: opts.accent, editHtml, sub: opts.sub });
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
      // The flat fields hold resolved NAMES (materializeInto), but shipped
      // blobs may still carry a subclass ID — resolve by id first, then by
      // name, and display the record's name when it resolves (never a slug).
      const resolve = (kind, v) => {
        if (!engine || !v) return null;
        return (engine.getItem && engine.getItem(kind, v)) || (engine.getItemByName && engine.getItemByName(kind, v)) || null;
      };
      const mkLegend = (rec) => (rec && rec.text) ? { title: rec.name, desc: firstPara(rec.text), aria: rec.name } : null;
      const clsRec = resolve('class', s.className);
      const subRec = resolve('subclass', s.subclass);
      const clsHtml = s.className ? entityRef('class', clsRec && clsRec.id, (clsRec && clsRec.name) || s.className, mkLegend(clsRec)) : '';
      const subHtml = s.subclass ? ' (' + entityRef('subclass', subRec && subRec.id, (subRec && subRec.name) || s.subclass, mkLegend(subRec)) + ')' : '';
      const TOKEN = '@@CLS@@';
      const line = t('sheet.summary', { level: num(s.level, 1), cls: TOKEN }).trim();
      idHtml = `<div style="color:var(--text-light);font-size:var(--text-sm);font-weight:600;letter-spacing:.02em">${esc(line).replace(TOKEN, (clsHtml + subHtml).trim())}</div>`;
    }

    // Spell save DC + spell attack per casting class (engine mode; SP-4 — each
    // class keeps its own numbers). With one caster class the labels speak for
    // themselves; multiclass tiles carry the class name as a sub-line.
    const perClass = (comp && comp.spellcasting && comp.spellcasting.perClass) || [];
    const multi = perClass.length > 1;
    const spellTiles = perClass.map((p) => {
      const sub = multi ? esc(titleize(p.classId)) : '';
      return vital(cid, t('spell.saveDC'), null, num(p.saveDC), vm, editable, L.spellDC(p), { align: 'r', sub })
           + vital(cid, t('spell.attack'), null, signed(num(p.spellAttack)), vm, editable, L.spellAtk(p), { align: 'r', sub });
    }).join('');

    const strip = [
      hpTile(cid, cur, max, temp, editable, vm, L),
      vital(cid, t('stat.ac'), 'ac', vm.ac, vm, editable, L.ac(), { accent: true, align: 'l', sub: (comp && comp.ac) ? shieldMark(num(comp.ac.shield, 0) > 0) : '' }),
      vital(cid, t('stat.init'), 'initiative', signed(vm.init), vm, editable, L.init()),
      vital(cid, t('stat.speed'), 'speed', vm.speed, vm, editable, L.speed()),
      vital(cid, t('stat.pb'), 'profBonus', signed(vm.pb), vm, editable, L.pb(), { align: 'r' }),
      vital(cid, t('stat.passivePercAbbr'), null, vm.passivePerc, vm, editable, L.passive(), { align: 'r' }),
      spellTiles,
    ].join('');

    return `<div style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-4)">
      ${idHtml}
      <div class="dse-vitals" style="display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:flex-start">${strip}</div>
    </div>`;
  }

  // ── HP tile — the live-play centrepiece. ONE counter, "− cur / max ＋": the
  //    current HP and the max live INSIDE the same host `.codex-stepper` so the
  //    pair reads as a single number (± steps / type the current, clamped to
  //    [0,max] by setField; the " / max" half is display-only). The TILE LABEL
  //    carries the max-HP hover legend — the stepper is overflow:hidden, so a
  //    popover anchored inside it would be clipped. Max (standalone only) +
  //    Temp HP are small steppers beneath. Bloodied (≤35%) flags the counter
  //    with a red border + number. ──
  function hpTile(cid, cur, max, temp, editable, vm, L) {
    const hpLabel = `<div class="codex-tile-label">${statTip(esc(t('stat.hp')), L.hp(), { align: 'l', underline: true })}</div>`;

    // Read view (anonymous): the plain cur / max pair + temp note, no controls.
    if (!editable) {
      const hpVal = `<span style="color:${hpColor(cur, max)}">${esc(String(cur))}</span><span style="color:var(--text-muted);font-size:var(--text-lg)"> / ${esc(String(max))}</span>`;
      const tempSub = temp > 0 ? `<div style="font-size:var(--text-xs);color:var(--color-success);margin-top:1px">+${esc(String(temp))} ${esc(t('stat.temp'))}</div>` : '';
      return `<div class="codex-tile codex-tile-accent codex-tile-wide">
        ${hpLabel}
        <div class="codex-tile-value">${hpVal}</div>${tempSub}</div>`;
    }

    const bloodied = max > 0 && (cur <= 0 || cur / max <= 0.35);
    const maxIn = `<span style="align-self:center;padding-right:var(--space-1);color:var(--text-muted);font-size:var(--text-lg);font-variant-numeric:tabular-nums;white-space:nowrap"> / ${esc(String(max))}</span>`;
    const curField = numField(host.h.dataOn('change', host.action('setField'), cid, 'hp', '$value'), cur,
      { min: 0, max: max > 0 ? max : null, ariaLabel: t('stat.hp'), width: '2.9rem',
        inputStyle: `font-size:var(--text-xl);font-weight:700;color:${hpColor(cur, max)};padding-top:0.15rem;padding-bottom:0.15rem`,
        suffixHtml: maxIn,
        wrapStyle: bloodied ? 'border-color:var(--color-danger)' : '' });
    const hpRow = `<div style="display:flex;justify-content:center">${curField}</div>`;

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

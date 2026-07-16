// ═══════════════════════════════════════════════════════════════
//  panel.header.js — the slim D&D vitals bar (shown on the mechanical tabs).
//
//  The host's native side-card owns name / portrait / species / facts, so this
//  bar adds ONLY the D&D bits: a class / level line and the vital stat strip.
//  The strip is one uniform-height band:
//    • HP counter (tall)  — "− cur / max ＋" in one stepper.
//    • AC / Shield (tall) — AC value, a dotted rule, then the shield line
//                           (filled + bonus when a shield is counted, struck
//                           through when not).
//    • small stats grid   — Speed · Passive on top, Save DC · Spell Attack
//                           beneath (per casting class). Initiative joins only
//                           on the Combat tab (opts.combat) — it is a start-of-
//                           fight number, so it doesn't clutter the resting sheet.
//    • equipment (engine) — Worn slots (equipped, non-attunement gear) + a
//                           dynamic Attunement group (attunable-only, sized to
//                           the character's attunement limit).
//  Proficiency has no tile: it is folded into every formula already, so it rides
//  the "Level N" hover instead (L.pb()).
//
//  Every vital carries a hover/focus legend (statTip) explaining what it is, its
//  formula, and the terms that sum to the number (UX-7). HP's legend hangs off
//  the MAX number (the value you're asking "where did that come from" about).
// ═══════════════════════════════════════════════════════════════

export function makeHeaderPanel(ctx) {
  const { host, t, num, signed, titleize, firstPara, ui, viewModel, legends, uiLayout } = ctx;
  const { esc } = host.h;
  const { heroTile, numField, statTip, entityRef, equipmentModel } = ui;

  const SHIELD_PATH = 'M12 2.6 19 5.3V11C19 15.6 16 19.4 12 21.4 8 19.4 5 15.6 5 11V5.3Z';

  // Shield line for the AC tile: the shield SHAPE itself — filled gold with its
  // +N bonus when a shield is counted in AC, an outline struck through (reading
  // "none") when not. A dotted divider separates it from the AC number above.
  // Engine-only: the bonus comes from comp.ac.shield.
  const acShield = (bonus) => {
    const on = num(bonus, 0) > 0;
    const body = on
      ? `<path d="${SHIELD_PATH}" fill="var(--accent-gold)" stroke="var(--accent-gold)" stroke-width="1.6" stroke-linejoin="round"/>`
      : `<path d="${SHIELD_PATH}" fill="none" stroke="var(--text-muted)" stroke-width="1.6" stroke-linejoin="round"/>`
        + `<line x1="4.2" y1="3.4" x2="19.8" y2="20.6" stroke="var(--text-muted)" stroke-width="1.6" stroke-linecap="round"/>`;
    const label = on ? t('stat.shieldOn') : t('stat.shieldOff');
    const valTxt = on ? signed(num(bonus)) : t('stat.shieldNone');
    const valCol = on ? 'var(--accent-gold)' : 'var(--text-muted)';
    return `<div class="dse-ac-div"></div>
      <div class="codex-tile-label">${esc(t('stat.shield'))}</div>
      <div title="${esc(label)}" role="img" aria-label="${esc(label)}" style="display:flex;align-items:center;justify-content:center;gap:4px">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" style="display:block">${body}</svg>
        <span style="font-size:var(--text-xs);color:${valCol};font-variant-numeric:tabular-nums">${esc(valTxt)}</span>
      </div>`;
  };

  // ── AC tile — tall like the HP counter (the two anchor the strip's height):
  //    AC value centred, a dotted divider, then the shield line (engine only).
  //    Standalone keeps the hand-edit stepper; the shield line needs the engine. ──
  function acTile(cid, editable, vm, comp, L) {
    const valueHtml = statTip(`<span>${esc(String(vm.ac))}</span>`, L.ac(), { align: 'l', underline: true });
    const editHtml = (editable && !vm.auto)
      ? `<div style="margin-top:var(--space-1);display:flex;justify-content:center">${numField(host.h.dataOn('change', host.action('setField'), cid, 'ac', '$value'), num(vm.ac), { ariaLabel: t('stat.ac') })}</div>`
      : '';
    const shield = comp ? acShield(comp.ac ? comp.ac.shield : 0) : '';
    return `<div class="codex-tile codex-tile-accent dse-tile-tall dse-ac-tile" title="${esc(t('stat.ac'))}">
      <div class="codex-tile-label">${esc(t('stat.ac'))}</div>
      <div class="codex-tile-value">${valueHtml}</div>${editHtml}${shield}</div>`;
  }

  const hpColor = (cur, max) => {
    if (max <= 0) return 'var(--text-parchment)';
    if (cur <= 0 || cur / max <= 0.35) return 'var(--color-danger)';
    if (cur / max <= 0.65) return 'var(--priority-medium)';
    return 'var(--text-parchment)';
  };

  // One computed vital tile (Init / Speed / Passive / Save DC / Spell Attack).
  // The value carries a legend; editing is standalone-only (`!vm.auto`).
  function vital(cid, label, field, display, vm, editable, legend, opts) {
    opts = opts || {};
    const editHtml = (editable && !vm.auto && field)
      ? `<div style="margin-top:var(--space-1);display:flex;justify-content:center">${numField(host.h.dataOn('change', host.action('setField'), cid, field, '$value'), num(display), { min: field === 'speed' ? 0 : null, ariaLabel: label })}</div>`
      : '';
    const valueHtml = statTip(`<span>${esc(String(display))}</span>`, legend, { align: opts.align, underline: true });
    return heroTile(label, valueHtml, { accent: opts.accent, editHtml, sub: opts.sub });
  }

  // ── Equipment (engine mode) — Worn slots + a dynamic Attunement group. ──
  //    Worn   = inventory items carried "equipped" that are NOT attuned (armor,
  //             shield, goggles, a cloak — any worn gear). The AC-relevant ones
  //             also drive the AC tile's shield line; this is the "what's on me".
  //    Attune = items flagged attuned, plus empty slots up to the character's
  //             attunement limit (comp.attunement.limit — usually 3, more with
  //             the right features). Attunable items only.
  //    Each filled slot shows the item NAME (bigger than the old chip) and, when
  //    the book resolves the record, a hover legend with its first paragraph.
  function itemLegend(engine, it) {
    if (!engine || !engine.getItem || !it) return null;
    let rec = null;
    if (it.ref && it.kind) rec = engine.getItem(it.kind, it.ref);
    if (!rec && it.ref) { for (const k of ['weapon', 'armor', 'magic-item']) { rec = engine.getItem(k, it.ref); if (rec) break; } }
    if (!rec && it.name && engine.getItemByName) { for (const k of ['weapon', 'armor', 'magic-item']) { rec = engine.getItemByName(k, it.name); if (rec) break; } }
    return (rec && rec.text) ? { title: rec.name || it.name, desc: firstPara(rec.text), aria: rec.name || it.name } : null;
  }

  // ── Equipment (engine mode). WORN is free-form: any equipped item gets a slot
  //    here, with Armor + Shield as the two labelled RECOMMENDED anchors (they
  //    feed the AC math) and a generic "Equip…" picker that takes anything. The
  //    ATTUNEMENT group is strict — its slots are only ever empty or holding an
  //    attuned item, sized to the character's limit. An empty slot is a
  //    click-to-fill picker (a select of eligible owned items); a filled slot
  //    shows the name (+ hover) and, for editors, a ✕ to clear it (unequip /
  //    unattune). Items shown here are NOT repeated in the backpack — the
  //    classifier (ui.equipmentModel) marks them so the pack de-dups. All
  //    editor-gated; the read view shows names + "empty" placeholders only. ──
  function equipmentPanel(cid, s, comp, editable, engine) {
    if (!comp) return '';
    const M = equipmentModel(s, engine);
    const limit = num(comp.attunement && comp.attunement.limit, 3);
    const over = comp.attunement && comp.attunement.over;

    const emptyBox = (tag, txt) => `<div class="dse-slot dse-slot-empty">${tag ? `<span class="dse-slot-tag">${esc(tag)}</span>` : ''}<span class="dse-slot-name-empty">${esc(txt)}</span></div>`;
    const filled = (it, tag, clearAction) => {
      const tagHtml = tag ? `<span class="dse-slot-tag">${esc(tag)}</span>` : '';
      const nameHtml = statTip(`<span class="dse-slot-name">${esc(it.name || t('misc.unnamed'))}</span>`, itemLegend(engine, it), { align: 'r' });
      const x = editable ? `<button class="inline-create-btn dse-slot-x" title="${esc(t('equip.clear'))}"${host.h.dataAction(host.action(clearAction), cid, it.id)}>✕</button>` : '';
      return `<div class="dse-slot">${tagHtml}${nameHtml}${x}</div>`;
    };
    // An empty slot: a picker (editor + eligible items) else a placeholder.
    const picker = (tag, pool, action, typeArg) => {
      if (!editable || !pool.length) return emptyBox(tag, editable ? t('equip.none') : t('equip.none'));
      const opts = `<option value="">＋ ${esc(t('equip.pick'))}</option>`
        + pool.map((it) => `<option value="${esc(it.id)}">${esc(it.name || t('misc.unnamed'))}</option>`).join('');
      const attr = typeArg != null
        ? host.h.dataOn('change', host.action(action), cid, typeArg, '$value')
        : host.h.dataOn('change', host.action(action), cid, '$value');
      return `<div class="dse-slot dse-slot-empty">${tag ? `<span class="dse-slot-tag">${esc(tag)}</span>` : ''}<select class="edit-input dse-slot-pick" aria-label="${esc(tag || t('equip.attuneTitle'))}"${attr}>${opts}</select></div>`;
    };

    // Worn — the two recommended anchors (Armor / Shield), then every other
    // equipped item in its own untagged slot, then a generic take-anything
    // picker (editors, when something is left to equip).
    const armorSlot = M.armor ? filled(M.armor, t('equip.armor'), 'slotUnequip') : picker(t('equip.armor'), M.eligibleArmor, 'slotEquip', 'armor');
    const shieldSlot = M.shield ? filled(M.shield, t('equip.shield'), 'slotUnequip') : picker(t('equip.shield'), M.eligibleShield, 'slotEquip', 'shield');
    const otherSlots = M.wornOther.map((it) => filled(it, '', 'slotUnequip')).join('');
    const anySlot = (editable && M.eligibleWorn.length) ? picker('', M.eligibleWorn, 'slotEquip', 'any') : '';
    const wornGrp = `<div class="dse-eqgrp">
      <div class="dse-eqh"><span>${esc(t('equip.wornTitle'))}</span></div>
      <div class="dse-eqrow">${armorSlot}${shieldSlot}${otherSlots}${anySlot}</div></div>`;

    // Attunement — filled slots, then one picker slot (if under limit), then plain
    // empties out to the limit. Over-limit just shows every attuned item, no empties.
    const attFilled = M.attuned.map((it) => filled(it, '', 'slotUnattune')).join('');
    const room = Math.max(0, limit - M.attuned.length);
    let attEmpties = '';
    if (room > 0) {
      const start = editable ? 1 : 0;
      if (editable) attEmpties += picker('', M.eligibleAttune, 'slotAttune');
      for (let i = start; i < room; i++) attEmpties += emptyBox('', t('equip.empty'));
    }
    const attGrp = `<div class="dse-eqgrp">
      <div class="dse-eqh"><span>${esc(t('equip.attuneTitle'))}</span><span class="dse-eqh-cnt${over ? ' dse-eqh-over' : ''}">${esc(t('equip.attuneCount', { n: M.attuned.length, limit }))}</span></div>
      <div class="dse-eqrow">${attFilled}${attEmpties}</div></div>`;

    return `<div class="dse-eqwrap">${wornGrp}${attGrp}</div>`;
  }

  function vitalsBar(c, s, comp, editable, engine, opts) {
    opts = opts || {};
    const vm = viewModel(s, comp);
    const L = legends(s, comp, vm);
    const cid = c.id;
    const cur = num(s.hp, 0), max = vm.maxHp, temp = num(s.tempHp, 0);

    // D&D identity line — always shown (so the PB hover on the level has a home).
    // Class + subclass link to their compendium pages when the book resolves them.
    // The LEVEL number carries the proficiency-bonus legend (PB has no tile — it
    // is baked into every formula already, so it rides here). Both the level and
    // class are spliced in as HTML AFTER escaping the surrounding translated text.
    const resolve = (kind, v) => {
      if (!engine || !v) return null;
      return (engine.getItem && engine.getItem(kind, v)) || (engine.getItemByName && engine.getItemByName(kind, v)) || null;
    };
    const mkLegend = (rec) => (rec && rec.text) ? { title: rec.name, desc: firstPara(rec.text), aria: rec.name } : null;
    const clsRec = resolve('class', s.className);
    const subRec = resolve('subclass', s.subclass);
    const clsHtml = s.className ? entityRef('class', clsRec && clsRec.id, (clsRec && clsRec.name) || s.className, mkLegend(clsRec)) : '';
    const subHtml = s.subclass ? ' (' + entityRef('subclass', subRec && subRec.id, (subRec && subRec.name) || s.subclass, mkLegend(subRec)) + ')' : '';
    const TOKEN_L = '@@LVL@@', TOKEN_C = '@@CLS@@';
    const lvlHtml = statTip(`<span>${esc(String(num(s.level, 1)))}</span>`, L.pb(), { align: 'l', underline: true });
    const line = t('sheet.summary', { level: TOKEN_L, cls: TOKEN_C }).trim();
    const idHtml = `<div style="color:var(--text-light);font-size:var(--text-sm);font-weight:600;letter-spacing:.02em">${esc(line).replace(TOKEN_L, lvlHtml).replace(TOKEN_C, (clsHtml + subHtml).trim())}</div>`;

    // COMPACT layout (the sheet's ⚙ Settings tab, per sheet): Passive, Save DC,
    // Spell Attack and Initiative are docked onto the ability cards
    // (panel.rail.js), so the band keeps only Speed beside HP/AC. CLASSIC
    // keeps every tile here.
    const compact = uiLayout(cid) === 'compact';

    // Spell save DC + spell attack per casting class (engine mode; SP-4 — each
    // class keeps its own numbers). Multiclass tiles carry the class name.
    const perClass = compact ? [] : ((comp && comp.spellcasting && comp.spellcasting.perClass) || []);
    const multi = perClass.length > 1;
    const spellTiles = perClass.map((p) => {
      const sub = multi ? esc(titleize(p.classId)) : '';
      return vital(cid, t('spell.saveDC'), null, num(p.saveDC), vm, editable, L.spellDC(p), { align: 'r', sub })
           + vital(cid, t('spell.attack'), null, signed(num(p.spellAttack)), vm, editable, L.spellAtk(p), { align: 'r', sub });
    }).join('');

    // Small stats: Speed · Passive, then per-class Save DC · Spell Attack. Initiative
    // rides only on the Combat tab (a start-of-fight number) — and in compact it's
    // docked on the DEX card, so no tile at all. Proficiency has no tile
    // (it lives in the level hover above).
    const initTile = (opts.combat && !compact) ? vital(cid, t('stat.init'), 'initiative', signed(vm.init), vm, editable, L.init()) : '';
    const passiveTile = compact ? '' : vital(cid, t('stat.passivePercAbbr'), null, vm.passivePerc, vm, editable, L.passive(), { align: 'r' });
    const smallTiles = initTile
      + vital(cid, t('stat.speed'), 'speed', vm.speed, vm, editable, L.speed())
      + passiveTile
      + spellTiles;

    return `<div style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-4)">
      ${idHtml}
      <div class="dse-vitals">${hpTile(cid, cur, max, temp, editable, vm, L)}${acTile(cid, editable, vm, comp, L)}<div class="dse-vitals-grid">${smallTiles}</div>${equipmentPanel(cid, s, comp, editable, engine)}</div>
    </div>`;
  }

  // ── HP tile — the live-play centrepiece. ONE counter, "− cur / max ＋": current
  //    HP and max live inside the same host stepper. The MAX number carries the
  //    hover legend (the "where did that come from" value) — the stepper is set
  //    overflow:visible for this instance so the popover isn't clipped. Max
  //    (standalone) + Temp HP are small steppers beneath. Bloodied (≤35%) flags
  //    the counter red. ──
  function hpTile(cid, cur, max, temp, editable, vm, L) {
    const hpLabel = `<div class="codex-tile-label">${esc(t('stat.hp'))}</div>`;

    // Read view (anonymous): plain cur / max pair (max carries the legend) + temp.
    if (!editable) {
      const maxOut = statTip(`<span style="color:var(--text-muted);font-size:var(--text-lg)"> / ${esc(String(max))}</span>`, L.hp(), { align: 'l', underline: true });
      const hpVal = `<span style="color:${hpColor(cur, max)}">${esc(String(cur))}</span>${maxOut}`;
      const tempSub = temp > 0 ? `<div style="font-size:var(--text-xs);color:var(--color-success);margin-top:1px">+${esc(String(temp))} ${esc(t('stat.temp'))}</div>` : '';
      return `<div class="codex-tile codex-tile-accent codex-tile-wide">
        ${hpLabel}
        <div class="codex-tile-value">${hpVal}</div>${tempSub}</div>`;
    }

    const bloodied = max > 0 && (cur <= 0 || cur / max <= 0.35);
    // The max sits inside the stepper (display-only) and carries the HP legend.
    const maxIn = statTip(
      `<span style="align-self:center;padding-right:var(--space-1);color:var(--text-muted);font-size:var(--text-lg);font-variant-numeric:tabular-nums;white-space:nowrap"> / ${esc(String(max))}</span>`,
      L.hp(), { align: 'l', underline: true });
    const curField = numField(host.h.dataOn('change', host.action('setField'), cid, 'hp', '$value'), cur,
      { min: 0, max: max > 0 ? max : null, ariaLabel: t('stat.hp'), width: '2.9rem',
        inputStyle: `font-size:var(--text-xl);font-weight:700;color:${hpColor(cur, max)};padding-top:0.15rem;padding-bottom:0.15rem`,
        suffixHtml: maxIn,
        // overflow:visible so the max's legend popover isn't clipped by the stepper.
        wrapStyle: 'overflow:visible' + (bloodied ? ';border-color:var(--color-danger)' : '') });
    const hpRow = `<div style="display:flex;justify-content:center">${curField}</div>`;

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

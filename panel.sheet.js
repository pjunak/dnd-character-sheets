// ═══════════════════════════════════════════════════════════════
//  panel.sheet.js — the Combat tab.
//
//  "What can I do in a fight" — attacks, the spells I can cast (UX-6), and my
//  resource trackers. The vital strip (HP/AC/…) is placed per-tab by entry.js;
//  this panel renders its own copy in the right column (see below).
//    • Attacks     → engine-computed to-hit/damage/mastery, else a readied list.
//    • Spells      → a castable quick-reference (per-class DC/attack + the
//                    prepared/known loadout grouped by level) so you don't have
//                    to leave Combat to cast. Read-only; prepare in Spellbook.
//    • Trackers    → build-derived pools/slots/charges/hit-dice with ± spend,
//                    and a Rest button that opens the floating Rest wizard (UX-5).
// ═══════════════════════════════════════════════════════════════

export function makeSheetPanel(ctx) {
  const { host, t, num, signed, titleize, ui, viewModel, legends, abilityRail, vitalsBar } = ctx;
  const { esc, dataAction, dataOn } = host.h;
  const { section, card, subLabel, attacksBlock, numField, statTip } = ui;

  const DIE_AVG = { d6: 4, d8: 5, d10: 6, d12: 7 };
  const RES_ORDER = { pool: 0, charge: 1, slot: 2, hitdice: 3 };
  function restState(cid) { try { return localStorage.getItem('dse-rest:' + cid); } catch (_) { return null; } }

  // "+1 on short rest, full on long rest" — what triggers a reset and by how much.
  function rechargeLabel(recharge) {
    return (recharge || []).map((rc) => {
      const amt = rc.amount === 'full' ? t('rest.amtFull')
        : rc.amount === 'halfLevel' ? t('rest.amtHalf')
        : (rc.amount && typeof rc.amount === 'object') ? ('+' + (rc.amount.abilityMod || 'mod'))
        : ('+' + num(rc.amount, 0));
      return t('rest.rechRule', { amt, on: rc.on === 'short' ? t('tracker.rechShort') : t('tracker.rechLong') });
    }).join(', ');
  }

  // Equipped/ready weapons from inventory (standalone, or engine with nothing
  // equipped). We can't compute to-hit without the engine, so show name + qty.
  function readiedList(c, s) {
    const readied = (s.inventory || []).filter((it) => {
      const loc = it.location || 'pack';
      return loc === 'equipped' || loc === 'ready';
    });
    if (!readied.length) {
      return `<div style="color:var(--text-muted);font-size:var(--text-sm)">${esc(t('combat.noWeapons'))}</div>`;
    }
    return readied.map((it) => {
      const loc = it.location || 'pack';
      const qty = num(it.qty, 1);
      return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-bottom:1px solid var(--border-subtle)">
        <span style="color:${loc === 'equipped' ? 'var(--accent-gold)' : 'var(--text-muted)'};font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.03em;min-width:3.5rem">${esc(t('loc.' + loc + 'Abbr'))}</span>
        <span style="flex:1;color:var(--text-light);font-size:var(--text-sm)">${esc(it.name || t('misc.unnamed'))}</span>
        ${qty !== 1 ? `<span style="color:var(--text-muted);font-size:var(--text-xs)">×${esc(String(qty))}</span>` : ''}
      </div>`;
    }).join('');
  }

  // ── Spells I can cast (UX-6) — per-class Save DC / Attack (with legends) and
  //    the castable loadout (cantrips + prepared + always-prepared) grouped by
  //    level. Read-only; a compact combat reference, not the prep UI. ──
  function spellInfo(engine, ref) {
    const r = engine && engine.getItem ? engine.getItem('spell', ref) : null;
    return r ? { ref, name: r.name, level: num(r.level, 0), school: r.school || '' }
             : { ref, name: t('misc.unknown'), level: 0, school: '' };
  }
  function combatSpells(c, s, comp, engine) {
    const sc = comp && comp.spellcasting;
    if (!sc || !Array.isArray(sc.perClass) || !sc.perClass.length) return '';
    const L = legends(s, comp, viewModel(s, comp));

    const stat = (label, valueHtml) => `<span style="display:inline-flex;gap:var(--space-1);align-items:baseline"><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.03em">${esc(label)}</span>${valueHtml}</span>`;
    const summary = sc.perClass.map((p) => {
      const dc = statTip(`<strong style="color:var(--text-parchment)">${esc(String(num(p.saveDC)))}</strong>`, L.spellDC(p), { align: 'l', underline: true });
      const atk = statTip(`<strong style="color:var(--text-parchment)">${esc(signed(num(p.spellAttack)))}</strong>`, L.spellAtk(p), { underline: true });
      return `<div style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:baseline">
        <strong style="color:var(--text-parchment)">${esc(titleize(p.classId))}</strong>${stat(t('spell.saveDC'), dc)}${stat(t('spell.attack'), atk)}</div>`;
    }).join('');

    // Castable set: cantrips + prepared picks + always-prepared grants (deduped).
    const seen = new Set(); const cast = [];
    const add = (ref) => { if (!ref || seen.has(ref)) return; seen.add(ref); cast.push(spellInfo(engine, ref)); };
    for (const p of sc.perClass) {
      ((s.cantrips && s.cantrips[p.classId]) || []).forEach(add);
      ((s.preparedSpells && s.preparedSpells[p.classId]) || []).forEach(add);
    }
    (sc.granted || []).filter((g) => g.alwaysPrepared).forEach((g) => add(g.ref));

    let body = `<div style="display:flex;flex-direction:column;gap:var(--space-1);margin-bottom:var(--space-2)">${summary}</div>`;
    if (!cast.length) {
      body += `<div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('combat.noPrepared'))}</div>`;
    } else {
      cast.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
      const byLevel = {};
      cast.forEach((sp) => { (byLevel[sp.level] = byLevel[sp.level] || []).push(sp); });
      const groups = Object.keys(byLevel).map(Number).sort((a, b) => a - b).map((lvl) => {
        const label = lvl === 0 ? t('spellbook.cantrip') : t('spellbook.lvlN', { n: lvl });
        const chips = byLevel[lvl].map((sp) => `<span title="${esc(sp.school || '')}" style="background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:var(--space-1) var(--space-2);font-size:var(--text-sm);color:var(--text-light)">${esc(sp.name)}</span>`).join('');
        return `<div>${subLabel(label)}<div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">${chips}</div></div>`;
      }).join('');
      body += `<div style="display:flex;flex-direction:column;gap:var(--space-2)">${groups}</div>`;
    }
    return section(t('combat.spellsTitle'), body, { icon: '✨' });
  }

  // ── Resource trackers. ─────────────────────────────────────────
  function pips(cur, max) {
    if (max <= 0 || max > 12) return '';
    let html = '';
    for (let i = 0; i < max; i++) html += `<span style="display:inline-block;width:.7rem;height:.7rem;border-radius:50%;border:1px solid var(--accent-gold);background:${i < cur ? 'var(--accent-gold)' : 'transparent'};margin-right:3px"></span>`;
    return `<span style="display:inline-flex;align-items:center">${html}</span>`;
  }
  // Standalone hand-managed tracker row (no engine to derive it).
  function trackerRow(c, r, edit) {
    const cur = num(r.current, 0), max = num(r.max, 0);
    const minus = `<button class="inline-create-btn" title="${esc(t('tracker.minus'))}"${dataAction(host.action('resourceAdjust'), c.id, r.id, -1)}>−</button>`;
    const plus = `<button class="inline-create-btn" title="${esc(t('tracker.plus'))}"${dataAction(host.action('resourceAdjust'), c.id, r.id, 1)}>＋</button>`;
    const count = max > 0
      ? `<strong style="color:var(--text-parchment);font-variant-numeric:tabular-nums">${esc(String(cur))}<span style="color:var(--text-muted)"> / ${esc(String(max))}</span></strong>`
      : `<strong style="color:var(--text-parchment);font-variant-numeric:tabular-nums">${esc(String(cur))}</strong>`;
    if (!edit) {
      const reset = max > 0 ? `<button class="inline-create-btn" title="${esc(t('tracker.reset'))}"${dataAction(host.action('resourceSet'), c.id, r.id, 'current', max)}>↺</button>` : '';
      return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-bottom:1px solid var(--border-subtle)">
        <span style="flex:1;color:var(--text-light);font-size:var(--text-sm)">${esc(r.name || t('misc.unnamed'))}</span>
        ${pips(cur, max)}${minus}${count}${plus}${reset}</div>`;
    }
    return `<div style="display:flex;align-items:center;gap:var(--space-1);padding:var(--space-1) var(--space-2);border-bottom:1px solid var(--border-subtle);flex-wrap:wrap">
      <input class="edit-input" style="flex:1;min-width:6rem" value="${esc(r.name || '')}" placeholder="${esc(t('tracker.name'))}"${dataOn('change', host.action('resourceSet'), c.id, r.id, 'name', '$value')}>
      ${minus}${count}${plus}
      <span style="color:var(--text-muted)">/</span>
      ${numField(dataOn('change', host.action('resourceSet'), c.id, r.id, 'max', '$value'), max, { min: 0, title: t('tracker.max') })}
      <button class="inline-create-btn" title="${esc(t('action.remove'))}"${dataAction(host.action('resourceDel'), c.id, r.id)}>✕</button>
    </div>`;
  }
  // Engine-built tracker (Rage / Ki / slots…): engine owns name/max/recharge; we
  // store only the current value per key (defaults to full). ± is live play.
  function engineTrackerRow(c, s, r, editable) {
    const key = String(r.key);
    const max = num(r.max, 0);
    const uses = s.resourceUses || {};
    const cur = Object.prototype.hasOwnProperty.call(uses, key) ? num(uses[key], max) : max;
    const count = `<strong style="color:var(--text-parchment);font-variant-numeric:tabular-nums">${esc(String(cur))}<span style="color:var(--text-muted)"> / ${esc(String(max))}</span></strong>`;
    const rech = rechargeLabel(r.recharge);
    const rechTag = rech ? `<span style="color:var(--text-muted);font-size:var(--text-xs);white-space:nowrap">${esc(rech)}</span>` : '';
    const controls = editable
      ? `<button class="inline-create-btn" title="${esc(t('tracker.minus'))}"${dataAction(host.action('resourceUseAdjust'), c.id, key, -1, max)}>−</button>${count}<button class="inline-create-btn" title="${esc(t('tracker.plus'))}"${dataAction(host.action('resourceUseAdjust'), c.id, key, 1, max)}>＋</button><button class="inline-create-btn" title="${esc(t('tracker.reset'))}"${dataAction(host.action('resourceUseReset'), c.id, key)}>↺</button>`
      : count;
    return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-bottom:1px solid var(--border-subtle);flex-wrap:wrap">
      <span style="flex:1;min-width:8rem;color:var(--text-light);font-size:var(--text-sm)">${esc(r.name || key)}</span>
      ${rechTag}${pips(cur, max)}${controls}</div>`;
  }

  function trackers(c, s, edit, comp, engine) {
    if (engine) {
      const list = ((comp && comp.resources) || []).slice().sort((a, b) => (RES_ORDER[a.kind] ?? 9) - (RES_ORDER[b.kind] ?? 9));
      if (!list.length && !edit) return '';
      const restBtn = edit ? `<button class="inline-create-btn"${dataAction(host.action('restOpen'), c.id)}>🌙 ${esc(t('rest.button'))}</button>` : '';
      const rows = list.length
        ? list.map((r) => engineTrackerRow(c, s, r, edit)).join('')
        : `<div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('tracker.engineEmpty'))}</div>`;
      return section(t('tracker.title'), rows, { icon: '🎲', right: restBtn });
    }
    const list = s.resources || [];
    if (!list.length && !edit) return '';
    const add = edit ? `<button class="inline-create-btn"${dataAction(host.action('resourceAdd'), c.id)}>＋ ${esc(t('tracker.add'))}</button>` : '';
    const body = list.length
      ? list.map((r) => trackerRow(c, r, edit)).join('')
      : `<div style="color:var(--text-muted);font-size:var(--text-sm)">${esc(t('tracker.empty'))}</div>`;
    const hint = edit ? `<div style="color:var(--text-muted);font-size:var(--text-xs);margin-top:var(--space-1)">${esc(t('tracker.hint'))}</div>` : '';
    return section(t('tracker.title'), body + hint, { icon: '🎲', right: add });
  }

  // ── The Rest wizard — a floating overlay (host `.addon-wizard-overlay`). Spend
  //    Hit Dice for short-rest healing (average + CON), then take a short or long
  //    rest; the engine's recharge rules decide what resets. Rendered at the
  //    fragment root by entry.js when `dse-rest:<cid>` is open. ──
  function restModal(c, s, comp) {
    const cid = c.id;
    const resources = (comp && comp.resources) || [];
    const uses = s.resourceUses || {};
    const curOf = (r) => Object.prototype.hasOwnProperty.call(uses, r.key) ? num(uses[r.key], r.max) : r.max;
    const conMod = comp && comp.abilities && comp.abilities.CON ? num(comp.abilities.CON.mod, 0) : 0;
    const hdRows = resources.filter((r) => r.kind === 'hitdice').map((r) => {
      const cur = curOf(r);
      const heal = Math.max(1, (DIE_AVG[r.die] || 5) + conMod);
      const btn = cur > 0
        ? `<button class="inline-create-btn"${dataAction(host.action('restSpendHitDie'), cid, r.key)}>${esc(t('rest.spendDie', { die: r.die, heal }))}</button>`
        : `<span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('rest.noneLeft'))}</span>`;
      return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) 0">
        <span style="flex:1;color:var(--text-light);font-size:var(--text-sm)">${esc(r.name)} <span style="color:var(--text-muted)">${esc(String(cur))}/${esc(String(r.max))}</span></span>${btn}</div>`;
    }).join('');
    const half = Math.max(1, Math.floor(num(comp && comp.totalLevel, num(s.level, 1)) / 2));

    const body = `
      <div style="color:var(--text-muted);font-size:var(--text-xs);margin-bottom:var(--space-2)">${esc(t('rest.hitDiceHint'))}</div>
      ${hdRows || `<div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('rest.noHitDice'))}</div>`}
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-4);align-items:center">
        <button class="inline-create-btn"${dataAction(host.action('restApply'), cid, 'short')}>☾ ${esc(t('rest.takeShort'))}</button>
        <button class="edit-save-btn"${dataAction(host.action('restApply'), cid, 'long')}>🌙 ${esc(t('rest.takeLong'))}</button>
      </div>
      <div style="color:var(--text-muted);font-size:var(--text-xs);margin-top:var(--space-3)">${esc(t('rest.longSummary', { half }))}</div>`;

    // Sibling backdrop (behind the panel) carries the dismiss action so a click
    // OUTSIDE the wizard closes it, while clicks inside don't bubble to it.
    return `<div class="addon-wizard-overlay">
      <div style="position:absolute;inset:0" title="${esc(t('action.cancel'))}"${dataAction(host.action('restClose'), cid)}></div>
      <div class="addon-wizard" role="dialog" aria-modal="true" aria-label="${esc(t('rest.title'))}" style="position:relative;z-index:1">
        <div class="addon-wizard-head">
          <h3>🌙 ${esc(t('rest.title'))}</h3>
          <button class="inline-create-btn" title="${esc(t('action.cancel'))}"${dataAction(host.action('restClose'), cid)}>✕</button>
        </div>
        <div class="addon-wizard-body">${body}</div>
      </div>
    </div>`;
  }

  function panelSheet(c, s, edit, comp, engine) {
    const engineAttacks = attacksBlock(comp);   // '' when no comp.weapons
    const attacks = engineAttacks
      || section(t('combat.title'), readiedList(c, s), { icon: '⚔️' });

    // Ability cards stack down the left; the vital strip (shifted here from the
    // full-width top) leads the right column, above attacks · spells · trackers.
    const main = `<div style="display:flex;flex-direction:column;gap:var(--space-5)">
      ${vitalsBar(c, s, comp, edit, engine)}
      <div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('combat.weaponsHint'))}</div>
      ${attacks}
      ${combatSpells(c, s, comp, engine)}
      ${trackers(c, s, edit, comp, engine)}
    </div>`;

    return `<div class="dse-cols">
      <div class="dse-cards">${abilityRail(c, s, comp, edit)}</div>
      <div class="dse-cols-main">${main}</div>
    </div>`;
  }

  return { panelSheet, restModal };
}

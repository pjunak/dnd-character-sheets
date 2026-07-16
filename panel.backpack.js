// ═══════════════════════════════════════════════════════════════
//  panel.backpack.js — the Backpack (inventory + currency) section, folded into
//  the Character Sheet tab's main column right under the vitals, beside the
//  ability cards (it no longer has its own tab).
//
//  Two columns: LEFT holds the ACTIVE items (Equipped + Ready — the gear that
//  carries attacks/uses in the Combat tab; here it's names + a hover legend);
//  RIGHT holds STORED items (Pack). Currency is ONE inline line pinned under
//  the whole split — always the bottom of the backpack, whichever column runs
//  longer. A "＋ Add item" button in the header opens the add-item wizard
//  (panel.additem.js). Per-row qty / attune / move / remove controls show in
//  modification mode; read view is control-free. The attunement tally lives
//  in the band's Attunement group now, not here.
// ═══════════════════════════════════════════════════════════════

export function makeBackpackPanel(ctx) {
  const { host, t, COINS, num, titleize, ui } = ctx;
  const { esc, dataAction, dataOn } = host.h;
  const { numField, entityRef, equipmentModel, bagIcon } = ui;

  function panelBackpack(c, s, edit, comp, engine) {
    // Header: title + the "＋ Add item" button (editor only) that opens the
    // add-item wizard (search + drill-down tree + batch tray). The old inline
    // pickers + free-text row are gone — the wizard owns adding now. The
    // attunement TALLY moved to the band's Attunement group (panel.header.js).
    const addBtn = edit
      ? `<button class="inline-create-btn"${dataAction(host.action('addItemOpen'), c.id)}>＋ ${esc(t('backpack.add'))}</button>`
      : '';
    const head = `<div class="dse-bp-head"><span class="dse-bp-title"><span style="color:var(--accent-gold);line-height:0">${bagIcon(19)}</span> ${esc(t('tab.backpack'))}</span>${addBtn}</div>`;

    // De-dup: whatever the band shows in a Worn / Attunement slot (equipped
    // armor+shield, and every attuned item) is NOT repeated here — it lives in
    // the band's paper-doll. The backpack holds everything else.
    const inBand = (engine && comp) ? equipmentModel(s, engine).slotIds : new Set();

    // One carry-location group: a small label + count, then the item rows.
    const group = (loc) => {
      const items = s.inventory.filter((it) => (it.location || 'pack') === loc && !inBand.has(it.id));
      if (!items.length && !edit) return '';
      const rows = items.length
        ? items.map((it) => invRow(c, it, edit, engine)).join('')
        : `<div style="color:var(--text-muted);font-size:var(--text-xs);padding:var(--space-1) 0">${esc(t('backpack.empty'))}</div>`;
      return `<div class="dse-bp-grp"><div class="dse-bp-lbl">${esc(t('loc.' + loc))} <span class="dse-bp-cnt">${esc(String(items.length))}</span></div>${rows}</div>`;
    };

    // Left = the ACTIVE items (Equipped + Ready — they carry attacks/uses in
    // Combat; here just names + hover). Right = STORED (Pack). The coin line
    // rides BELOW the split so it's always the backpack's bottom edge.
    const left = ['equipped', 'ready'].map(group).join('');
    const right = group('pack');

    return `<div style="display:flex;flex-direction:column;gap:var(--space-3)">
      ${head}
      <div class="dse-bp-split">
        <div class="dse-bp-col">${left}</div>
        <div class="dse-bp-col dse-bp-right">${right}</div>
      </div>
      ${currencyLine(c, s, edit)}</div>`;
  }

  // Resolve an inventory item → its compendium {kind, id, rec}. The stored
  // `it.kind` (written by invAddRef) is authoritative; the weapon→armor id
  // probe survives only for LEGACY rows that predate the kind field, and the
  // by-name fallback (free-text items) now tries both kinds. null for
  // unresolvable items or when the book is absent (→ plain text, no link).
  function itemRef(engine, it) {
    if (!engine || !engine.getItem) return null;
    if (it.ref && it.kind) {
      const rec = engine.getItem(it.kind, it.ref);
      if (rec) return { kind: it.kind, id: it.ref, rec };
    }
    if (it.ref) {
      for (const kind of ['weapon', 'armor']) {
        const rec = engine.getItem(kind, it.ref);
        if (rec) return { kind, id: it.ref, rec };
      }
    }
    if (it.name && engine.getItemByName) {
      for (const kind of ['weapon', 'armor']) {
        const rec = engine.getItemByName(kind, it.name);
        if (rec) return { kind, id: rec.id, rec };
      }
    }
    return null;
  }

  // Light hover legend for a resolved weapon/armor item (properties + mastery, or AC).
  function itemLegend(resolved) {
    if (!resolved || !resolved.rec) return null;
    const r = resolved.rec;
    if (resolved.kind === 'weapon') {
      const props = (r.properties || []).map(titleize);
      const terms = r.mastery ? [{ label: t('combat.mastery'), value: r.mastery }] : [];
      return (props.length || terms.length) ? { title: r.name, desc: props.join(' · '), terms, aria: r.name } : null;
    }
    if (resolved.kind === 'armor' && r.baseAC != null) {
      return { title: r.name, desc: r.armorType ? titleize(r.armorType) : '', terms: [{ label: t('stat.ac'), value: r.baseAC }], aria: r.name };
    }
    return null;
  }

  function invRow(c, it, edit, engine) {
    const loc = it.location || 'pack';
    const resolved = itemRef(engine, it);
    const wrec = resolved && resolved.kind === 'weapon' ? resolved.rec : null;
    const masteryTag = wrec && wrec.mastery ? `<span title="${esc(t('combat.mastery'))}" style="color:var(--text-muted);font-size:var(--text-xs)">${esc(wrec.mastery)}</span>` : '';
    if (!edit) {
      const nameHtml = resolved
        ? entityRef(resolved.kind, resolved.id, it.name || t('misc.unnamed'), itemLegend(resolved))
        : esc(it.name || t('misc.unnamed'));
      return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-bottom:1px solid var(--border-subtle)">
        <span style="flex:1;color:var(--text-light);font-size:var(--text-sm)">${it.attuned ? '<span style="color:var(--accent-gold)">✦</span> ' : ''}${nameHtml}</span>
        ${masteryTag}
        ${num(it.qty, 1) !== 1 ? `<span style="color:var(--text-muted);font-size:var(--text-xs)">×${esc(String(num(it.qty, 1)))}</span>` : ''}
      </div>`;
    }
    return `<div style="display:flex;align-items:center;gap:var(--space-1);padding:var(--space-1) var(--space-2);border-bottom:1px solid var(--border-subtle)">
      <input class="edit-input" style="flex:1;min-width:6rem" value="${esc(it.name || '')}" placeholder="${esc(t('backpack.name'))}"${dataOn('change', host.action('invSet'), c.id, it.id, 'name', '$value')}>
      ${masteryTag}
      ${numField(dataOn('change', host.action('invSet'), c.id, it.id, 'qty', '$value'), num(it.qty, 1), { min: 1, title: t('backpack.qty') })}
      <button class="inline-create-btn" title="${esc(t('backpack.attune'))}" style="color:${it.attuned ? 'var(--accent-gold)' : 'var(--text-muted)'}"${dataAction(host.action('invAttune'), c.id, it.id)}>${it.attuned ? '✦' : '☆'}</button>
      <button class="inline-create-btn" title="${esc(t('backpack.cycleLoc'))}"${dataAction(host.action('invCycle'), c.id, it.id)}>${esc(t('loc.' + loc + 'Abbr'))}</button>
      <button class="inline-create-btn" title="${esc(t('action.remove'))}"${dataAction(host.action('invDel'), c.id, it.id)}>✕</button>
    </div>`;
  }

  function currencyLine(c, s, edit) {
    const cells = COINS.map((coin) => {
      const v = num(s.currency[coin], 0);
      const inner = edit
        ? numField(dataOn('change', host.action('currencySet'), c.id, coin, '$value'), v, { min: 0, ariaLabel: t('coin.' + coin), width: '3.6rem' })
        : `<span style="color:var(--text-parchment);font-weight:600;font-variant-numeric:tabular-nums">${esc(String(v))}</span>`;
      return `<span class="dse-coin"><span class="dse-coin-lbl">${esc(t('coin.' + coin))}</span>${inner}</span>`;
    }).join('');
    return `<div class="dse-bp-coins"><span class="dse-bp-lbl" style="margin:0">🪙 ${esc(t('backpack.currency'))}</span>${cells}</div>`;
  }

  return { panelBackpack };
}

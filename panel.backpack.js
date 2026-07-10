// ═══════════════════════════════════════════════════════════════
//  panel.backpack.js — the Backpack (inventory + currency) section, folded into
//  the bottom of the Character Sheet tab (it no longer has its own tab).
//
//  Inventory grouped by carry location (Equipped / Ready / Pack), each a titled
//  section with an item count. In modification mode: compendium add-pickers
//  (weapon/armor → resolve for AC/attacks) + a free-text item, per-row qty /
//  attune / move / remove controls, and editable currency. The engine attunement
//  counter shows in both modes. Read view is a clean, control-free list.
// ═══════════════════════════════════════════════════════════════

export function makeBackpackPanel(ctx) {
  const { host, t, COINS, LOCATIONS, num, titleize, ui } = ctx;
  const { esc, dataAction, dataOn } = host.h;
  const { section, card, numField, entityRef } = ui;

  function panelBackpack(c, s, edit, comp, engine) {
    // Add bar (modification mode): compendium pickers + free-text item.
    const addBar = edit ? card(`<div style="display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center">
      ${engine && engine.listWeapons ? addRefSelect(c, 'weapon', engine.listWeapons() || [], t('backpack.addWeapon')) : ''}
      ${engine && engine.listArmor ? addRefSelect(c, 'armor', engine.listArmor() || [], t('backpack.addArmor')) : ''}
      <button class="inline-create-btn"${dataAction(host.action('invAdd'), c.id)}>＋ ${esc(t('backpack.add'))}</button>
    </div>`, { style: 'padding:var(--space-2) var(--space-3)' }) : '';

    const att = comp && comp.attunement;
    const attHtml = att
      ? `<div style="color:${att.over ? 'var(--color-danger)' : 'var(--text-muted)'};font-size:var(--text-sm)">
           ${esc(t('combat.attunement'))}: <strong style="color:${att.over ? 'var(--color-danger)' : 'var(--text-light)'}">${esc(t('backpack.attunement', { n: att.count, limit: att.limit }))}</strong>${att.over ? ' ⚠' : ''}</div>`
      : '';

    const groups = LOCATIONS.map((loc) => {
      const items = s.inventory.filter((it) => (it.location || 'pack') === loc);
      if (!items.length && !edit) return '';
      const rows = items.length
        ? items.map((it) => invRow(c, it, edit, engine)).join('')
        : `<div style="color:var(--text-muted);font-size:var(--text-xs);padding:var(--space-1) 0">${esc(t('backpack.empty'))}</div>`;
      const count = items.length ? `<span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(String(items.length))}</span>` : '';
      return section(t('loc.' + loc), rows, { right: count });
    }).join('');

    return `<div style="display:flex;flex-direction:column;gap:var(--space-5)">
      ${addBar}
      ${attHtml}
      ${groups}
      ${currencySection(c, s, edit)}
    </div>`;
  }

  function addRefSelect(c, kind, list, placeholder) {
    if (!list.length) return '';
    const opts = `<option value="">${esc(placeholder)}</option>` + list.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
    return `<select class="edit-input" style="max-width:11rem"${dataOn('change', host.action('invAddRef'), c.id, kind, '$value')}>${opts}</select>`;
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

  function currencySection(c, s, edit) {
    const cells = COINS.map((coin) => {
      const v = num(s.currency[coin], 0);
      const inner = edit
        ? numField(dataOn('change', host.action('currencySet'), c.id, coin, '$value'), v, { min: 0, ariaLabel: t('coin.' + coin) })
        : `<div style="color:var(--text-parchment);font-weight:600;font-variant-numeric:tabular-nums">${esc(String(v))}</div>`;
      return `<div style="text-align:center;min-width:3rem">
        <div style="font-size:var(--text-xs);color:var(--accent-gold);font-weight:600">${esc(t('coin.' + coin))}</div>${inner}</div>`;
    }).join('');
    return section(t('backpack.currency'), `<div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center">${cells}</div>`, { icon: '🪙' });
  }

  return { panelBackpack };
}

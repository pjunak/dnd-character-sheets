export const INVENTORY_ACTIONS = Object.freeze(['invDel','invSet','invCycle','currencySet','invAttune','slotEquip','slotUnequip','slotAttune','slotUnattune','addItemOpen','addItemClose','addItemNav','addItemSearch','addItemStage','addItemStageCustom','addItemQty','addItemUnstage','addItemClear','addItemCommit']);

export function addInventoryItems(sheet, items, deps) {
  const inventory = Array.isArray(sheet.inventory) ? sheet.inventory.slice() : [];
  for (const item of items) {
    const row = { id: deps.uid('item'), name: item.name, qty: Math.max(1, deps.num(item.qty, 1)), location: deps.location(item.kind), attuned: false };
    if (item.ref) row.ref = item.ref;
    if (item.kind) row.kind = item.kind;
    inventory.push(row);
  }
  sheet.inventory = inventory;
  return sheet;
}

export function registerInventoryActions(deps) {
  const { host, num, uid, mutate, getRules, LOCATIONS } = deps;
  const register = (name, fn) => host.registerAction(name, fn);
  // Backpack.
  register('invDel', (cid, iid) => {
    mutate(cid, (s) => { s.inventory = s.inventory.filter((it) => it.id !== iid); return s; });
  });
  register('invSet', (cid, iid, field, value) => {
    mutate(cid, (s) => {
      s.inventory = s.inventory.map((it) => {
        if (it.id !== iid) return it;
        if (field === 'qty') return { ...it, qty: Math.max(1, num(value, 1)) };
        return { ...it, [field]: String(value) };
      });
      return s;
    });
  });
  register('invCycle', (cid, iid) => {
    mutate(cid, (s) => {
      s.inventory = s.inventory.map((it) => {
        if (it.id !== iid) return it;
        const i = LOCATIONS.indexOf(it.location || 'pack');
        return { ...it, location: LOCATIONS[(i + 1) % LOCATIONS.length] };
      });
      return s;
    });
  });
  register('currencySet', (cid, coin, value) => {
    mutate(cid, (s) => { s.currency = { ...s.currency, [coin]: Math.max(0, num(value, 0)) }; return s; });
  });
  register('invAttune', (cid, iid) => {
    mutate(cid, (s) => { s.inventory = s.inventory.map((it) => (it.id === iid ? { ...it, attuned: !it.attuned } : it)); return s; });
  });

  // ── Band equipment slots (click-to-fill). Worn is free-form: the Armor/Shield
  //    anchor slots equip an item of their recommended type (bumping the previous
  //    occupant back to the pack — one item per anchor); the generic slot
  //    (type 'any') equips anything with no bumping. The Attunement slots attune
  //    an item (strict: attunement-requiring items only, enforced by the picker
  //    pool). ✕ on a filled slot clears it (unequip → back to the pack; unattune
  //    → stays put but leaves the Attunement group). These drive the band's
  //    paper-doll and, via the de-dup, what the backpack hides. ──
  register('slotEquip', (cid, type, iid) => {
    if (!iid) return;
    mutate(cid, (s) => {
      const engine = getRules();
      const single = String(type) === 'armor' || String(type) === 'shield';
      const armorRec = (it) => (engine && engine.getItem ? (engine.getItem('armor', it.ref) || (it.name && engine.getItemByName ? engine.getItemByName('armor', it.name) : null)) : null);
      const isType = (it) => { const r = armorRec(it); if (!r) return false; return String(type) === 'shield' ? r.armorType === 'shield' : ['light', 'medium', 'heavy'].includes(r.armorType); };
      s.inventory = (s.inventory || []).map((it) => {
        if (it.id === iid) return { ...it, location: 'equipped' };
        // Anchor slots hold one item — bump the previous same-type occupant.
        if (single && (it.location || 'pack') === 'equipped' && !it.attuned && isType(it)) return { ...it, location: 'pack' };
        return it;
      });
      return s;
    });
  });
  register('slotUnequip', (cid, iid) => {
    mutate(cid, (s) => { s.inventory = (s.inventory || []).map((it) => (it.id === iid ? { ...it, location: 'pack' } : it)); return s; });
  });
  register('slotAttune', (cid, iid) => {
    if (!iid) return;
    mutate(cid, (s) => { s.inventory = (s.inventory || []).map((it) => (it.id === iid ? { ...it, attuned: true } : it)); return s; });
  });
  register('slotUnattune', (cid, iid) => {
    mutate(cid, (s) => { s.inventory = (s.inventory || []).map((it) => (it.id === iid ? { ...it, attuned: false } : it)); return s; });
  });

  // ── Add-item wizard (floating overlay) — search + drill-down tree + batch tray.
  //    All state is in localStorage (the fragment re-renders on every action):
  //    open flag / current tree path / search query / the staged-items cart.
  //    Commit adds every staged item at once (quantity + a sensible location per
  //    kind), then closes. See panel.additem.js for the render. ──
  const aiwCartKey = (cid) => 'dse-additem-cart:' + cid;
  const aiwKeys = (cid) => ['dse-additem:' + cid, 'dse-additem-path:' + cid, 'dse-additem-q:' + cid, aiwCartKey(cid)];
  const aiwReadCart = (cid) => { try { return JSON.parse(localStorage.getItem(aiwCartKey(cid)) || '[]') || []; } catch (_) { return []; } };
  const aiwWriteCart = (cid, cart) => { try { localStorage.setItem(aiwCartKey(cid), JSON.stringify(cart)); } catch (_) {} };
  const aiwClear = (cid) => { try { aiwKeys(cid).forEach((k) => localStorage.removeItem(k)); } catch (_) {} };
  // Weapons ready to draw, armor worn, everything else stored in the pack.
  const aiwLocation = (kind) => (kind === 'armor' ? 'equipped' : kind === 'weapon' ? 'ready' : 'pack');
  const aiwStage = (cid, item) => {
    const cart = aiwReadCart(cid);
    const ex = cart.find((it) => it.key === item.key);
    if (ex) ex.qty = num(ex.qty, 1) + 1; else cart.push(item);
    aiwWriteCart(cid, cart);
    host.ui.rerender();
  };
  register('addItemOpen', (cid) => { aiwClear(cid); try { localStorage.setItem('dse-additem:' + cid, 'open'); } catch (_) {} host.ui.rerender(); });
  register('addItemClose', (cid) => { aiwClear(cid); host.ui.rerender(); });
  register('addItemNav', (cid, path) => {
    try { localStorage.setItem('dse-additem-path:' + cid, String(path == null ? '' : path)); localStorage.removeItem('dse-additem-q:' + cid); } catch (_) {}
    host.ui.rerender();
  });
  register('addItemSearch', (cid) => {
    let q = '';
    try { q = (document.getElementById('dse-additem-q-' + cid) || {}).value || ''; } catch (_) {}
    try { if (String(q).trim()) localStorage.setItem('dse-additem-q:' + cid, String(q)); else localStorage.removeItem('dse-additem-q:' + cid); } catch (_) {}
    host.ui.rerender();
  });
  register('addItemStage', (cid, kind, ref) => {
    const engine = getRules();
    const rec = engine && engine.getItem ? engine.getItem(String(kind), String(ref)) : null;
    aiwStage(cid, { key: String(kind) + ':' + String(ref), kind: String(kind), ref: String(ref), name: rec ? rec.name : String(ref), qty: 1 });
  });
  register('addItemStageCustom', (cid) => {
    let name = '';
    try { name = (document.getElementById('dse-additem-custom-' + cid) || {}).value || ''; } catch (_) {}
    name = String(name).trim();
    if (!name) { host.ui.rerender(); return; }
    aiwStage(cid, { key: 'custom:' + name.toLowerCase(), kind: '', ref: '', name, qty: 1, custom: true });
  });
  register('addItemQty', (cid, key, value) => {
    const cart = aiwReadCart(cid);
    const it = cart.find((x) => x.key === key);
    if (it) it.qty = Math.max(1, num(value, 1));
    aiwWriteCart(cid, cart);
    host.ui.rerender();
  });
  register('addItemUnstage', (cid, key) => { aiwWriteCart(cid, aiwReadCart(cid).filter((x) => x.key !== key)); host.ui.rerender(); });
  register('addItemClear', (cid) => { aiwWriteCart(cid, []); host.ui.rerender(); });
  register('addItemCommit', (cid) => {
    const cart = aiwReadCart(cid);
    if (cart.length) {
      mutate(cid, (s) => addInventoryItems(s, cart, { uid, num, location: aiwLocation }));
    }
    aiwClear(cid);
    host.ui.rerender();
  });

}

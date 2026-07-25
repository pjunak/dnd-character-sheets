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
  const { host, num, uid, mutate, getRules, LOCATIONS, uiState } = deps;
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

  const aiwState = cid => uiState.get(cid, 'addItem', { path: '', query: '', cart: [] });
  const aiwWrite = (cid, state) => uiState.set(cid, 'addItem', state);
  const aiwReadCart = cid => aiwState(cid).cart || [];
  const aiwLocation = (kind) => (kind === 'armor' ? 'equipped' : kind === 'weapon' ? 'ready' : 'pack');
  const aiwStage = (cid, item) => {
    const state = aiwState(cid);
    const cart = state.cart.map(entry => ({ ...entry }));
    const ex = cart.find((it) => it.key === item.key);
    if (ex) ex.qty = num(ex.qty, 1) + 1; else cart.push(item);
    aiwWrite(cid, { ...state, cart });
    host.ui.rerender();
  };
  register('addItemOpen', (cid) => {
    aiwWrite(cid, { path: '', query: '', cart: [] });
    host.ui.rerender();
  });
  register('addItemClose', (cid) => {
    uiState.remove(cid, 'addItem');
    host.ui.rerender();
  });
  register('addItemNav', (cid, path) => {
    aiwWrite(cid, {
      ...aiwState(cid),
      path: String(path == null ? '' : path),
      query: '',
    });
    host.ui.rerender();
  });
  register('addItemSearch', (cid) => {
    let q = '';
    try { q = (document.getElementById('dse-additem-q-' + cid) || {}).value || ''; } catch (_) {}
    aiwWrite(cid, { ...aiwState(cid), query: String(q).trim() });
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
    const state = aiwState(cid);
    const cart = state.cart.map(item => ({ ...item }));
    const it = cart.find((x) => x.key === key);
    if (it) it.qty = Math.max(1, num(value, 1));
    aiwWrite(cid, { ...state, cart });
    host.ui.rerender();
  });
  register('addItemUnstage', (cid, key) => {
    const state = aiwState(cid);
    aiwWrite(cid, { ...state, cart: state.cart.filter(item => item.key !== key) });
    host.ui.rerender();
  });
  register('addItemClear', (cid) => {
    aiwWrite(cid, { ...aiwState(cid), cart: [] });
    host.ui.rerender();
  });
  register('addItemCommit', (cid) => {
    const cart = aiwReadCart(cid);
    if (cart.length) {
      mutate(cid, (s) => addInventoryItems(s, cart, { uid, num, location: aiwLocation }));
    }
    uiState.remove(cid, 'addItem');
    host.ui.rerender();
  });

}

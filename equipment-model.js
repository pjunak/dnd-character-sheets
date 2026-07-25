const BODY_ARMOR_TYPES = new Set(['light', 'medium', 'heavy']);

export function resolveInventoryItem(engine, item, fallbackKinds = ['weapon', 'armor']) {
  if (!engine || !item) return null;

  if (item.ref && item.kind && engine.getItem) {
    const record = engine.getItem(item.kind, item.ref);
    if (record) return { kind: item.kind, id: record.id || item.ref, rec: record };
  }
  if (item.ref && engine.getItem) {
    for (const kind of fallbackKinds) {
      const record = engine.getItem(kind, item.ref);
      if (record) return { kind, id: record.id || item.ref, rec: record };
    }
  }
  if (item.name && engine.getItemByName) {
    for (const kind of fallbackKinds) {
      const record = engine.getItemByName(kind, item.name);
      if (record) return { kind, id: record.id, rec: record };
    }
  }
  return null;
}

function armorRecord(engine, item) {
  const resolved = resolveInventoryItem(engine, { ...item, kind: 'armor' }, ['armor']);
  return resolved && resolved.rec;
}

export function equipmentModel(sheet, engine) {
  const inventory = Array.isArray(sheet?.inventory) ? sheet.inventory : [];
  let armor = null;
  let shield = null;
  const wornOther = [];

  for (const item of inventory) {
    if ((item.location || 'pack') !== 'equipped' || item.attuned) continue;
    const record = armorRecord(engine, item);
    if (record?.armorType === 'shield' && !shield) shield = item;
    else if (BODY_ARMOR_TYPES.has(record?.armorType) && !armor) armor = item;
    else wornOther.push(item);
  }

  const attuned = inventory.filter(item => !!item.attuned);
  const slotIds = new Set(
    [armor, shield, ...wornOther, ...attuned]
      .filter(Boolean)
      .map(item => item.id),
  );
  const notPlaced = item => (item.location || 'pack') !== 'equipped' && !item.attuned;
  const eligibleArmor = inventory.filter(
    item => notPlaced(item) && BODY_ARMOR_TYPES.has(armorRecord(engine, item)?.armorType),
  );
  const eligibleShield = inventory.filter(
    item => notPlaced(item) && armorRecord(engine, item)?.armorType === 'shield',
  );
  const eligibleWorn = inventory.filter(notPlaced);
  const eligibleAttune = inventory.filter(item => {
    if (item.attuned || item.kind !== 'magic-item') return false;
    const record = item.ref && engine?.getItem
      ? engine.getItem('magic-item', item.ref)
      : null;
    return record ? !!record.attunement : true;
  });

  return {
    armor,
    shield,
    wornOther,
    attuned,
    slotIds,
    eligibleArmor,
    eligibleShield,
    eligibleWorn,
    eligibleAttune,
  };
}

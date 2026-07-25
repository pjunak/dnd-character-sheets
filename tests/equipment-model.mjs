import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equipmentModel, resolveInventoryItem } from '../equipment-model.js';

const records = {
  armor: {
    chain: { id: 'chain', name: 'Chain Mail', armorType: 'heavy' },
    shield: { id: 'shield', name: 'Shield', armorType: 'shield' },
  },
  weapon: {
    sword: { id: 'sword', name: 'Longsword' },
  },
  'magic-item': {
    ring: { id: 'ring', name: 'Ring of Protection', attunement: true },
    potion: { id: 'potion', name: 'Potion', attunement: false },
  },
};

const engine = {
  getItem(kind, id) {
    return records[kind]?.[id] || null;
  },
  getItemByName(kind, name) {
    return Object.values(records[kind] || {}).find(record => record.name === name) || null;
  },
};

test('inventory resolution preserves explicit kinds and legacy weapon/armor fallbacks', () => {
  assert.equal(resolveInventoryItem(engine, { ref: 'ring', kind: 'magic-item' })?.kind, 'magic-item');
  assert.equal(resolveInventoryItem(engine, { ref: 'sword' })?.kind, 'weapon');
  assert.equal(resolveInventoryItem(engine, { name: 'Chain Mail' })?.id, 'chain');
  assert.equal(resolveInventoryItem(engine, { ref: 'missing', kind: 'armor' }), null);
});

test('equipment model assigns worn anchors and exposes unplaced picker pools', () => {
  const sheet = {
    inventory: [
      { id: 'body', ref: 'chain', kind: 'armor', location: 'equipped' },
      { id: 'hand', ref: 'shield', kind: 'armor', location: 'equipped' },
      { id: 'ready', ref: 'sword', kind: 'weapon', location: 'equipped' },
      { id: 'attuned', ref: 'ring', kind: 'magic-item', location: 'pack', attuned: true },
      { id: 'spare-armor', name: 'Chain Mail', location: 'pack' },
      { id: 'spare-shield', ref: 'shield', kind: 'armor', location: 'pack' },
      { id: 'attunable', ref: 'ring', kind: 'magic-item', location: 'pack' },
      { id: 'not-attunable', ref: 'potion', kind: 'magic-item', location: 'pack' },
      { id: 'homebrew', kind: 'magic-item', location: 'pack' },
    ],
  };

  const model = equipmentModel(sheet, engine);
  assert.equal(model.armor.id, 'body');
  assert.equal(model.shield.id, 'hand');
  assert.deepEqual(model.wornOther.map(item => item.id), ['ready']);
  assert.deepEqual(model.attuned.map(item => item.id), ['attuned']);
  assert.deepEqual([...model.slotIds], ['body', 'hand', 'ready', 'attuned']);
  assert.deepEqual(model.eligibleArmor.map(item => item.id), ['spare-armor']);
  assert.deepEqual(model.eligibleShield.map(item => item.id), ['spare-shield']);
  assert.deepEqual(
    model.eligibleAttune.map(item => item.id),
    ['attunable', 'homebrew'],
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blank } from '../helpers.js';
import {
  parseSheet,
  serializeSheet,
  SHEET_TRANSFER_FORMAT,
  SHEET_TRANSFER_VERSION,
} from '../sheet-transfer.js';

const normalize = sheet => ({ ...blank(), ...sheet });
const parse = raw => parseSheet(raw, { template: blank(), normalize });

test('versioned exports round-trip through the validated transfer boundary', () => {
  const source = {
    ...blank(),
    className: 'Wizard',
    level: 5,
    inventory: [{ id: 'book', name: 'Spellbook', qty: 1 }],
    spells: [{ id: 'light', name: 'Light', level: 0 }],
  };
  const document = JSON.parse(serializeSheet(source));
  assert.equal(document.format, SHEET_TRANSFER_FORMAT);
  assert.equal(document.version, SHEET_TRANSFER_VERSION);

  const result = parse(JSON.stringify(document));
  assert.equal(result.ok, true);
  assert.equal(result.legacy, false);
  assert.equal(result.sheet.className, 'Wizard');
  assert.deepEqual(result.preview, {
    className: 'Wizard',
    level: 5,
    inventory: 1,
    spells: 1,
  });
});

test('legacy raw-sheet exports remain importable and receive current defaults', () => {
  const result = parse(JSON.stringify({ v: 1, className: 'Fighter', level: 2 }));
  assert.equal(result.ok, true);
  assert.equal(result.legacy, true);
  assert.equal(result.sheet.className, 'Fighter');
  assert.deepEqual(result.sheet.inventory, []);
});

test('imports reject malformed, foreign, future, unsafe, and oversized data', () => {
  const vectors = [
    ['', 'empty'],
    ['{bad json', 'json'],
    [JSON.stringify([]), 'shape'],
    [JSON.stringify({ format: 'other', version: 1, sheet: {} }), 'format'],
    [JSON.stringify({
      format: SHEET_TRANSFER_FORMAT,
      version: 2,
      sheet: {},
    }), 'version'],
    [JSON.stringify({ v: 2, unknown: true }), 'shape'],
    [JSON.stringify({ v: 2, inventory: {} }), 'shape'],
    ['{"v":2,"overrides":{"__proto__":{"polluted":true}}}', 'unsafe'],
    [JSON.stringify({ v: 2, notes: 'x'.repeat(1024 * 1024) }), 'size'],
  ];
  for (const [raw, code] of vectors) {
    assert.deepEqual(parse(raw), { ok: false, code });
  }
  assert.equal({}.polluted, undefined);
});

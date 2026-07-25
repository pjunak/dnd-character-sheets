import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blank } from '../helpers.js';
import {
  captureProviderState,
  materializedValues,
  resolveProviderState,
} from '../provider-state.js';

test('captured materialized fields remain active while only play state changes', () => {
  const sheet = blank();
  sheet.className = 'Wizard';
  sheet.abilities.INT = 16;
  captureProviderState(sheet, '2024');

  sheet.hp = 4;
  sheet.inventory.push({ id: 'potion', name: 'Potion' });
  assert.deepEqual(resolveProviderState(sheet, '2024'), { status: 'active' });
});

test('computed-field edits and edition changes require explicit reconciliation', () => {
  const sheet = blank();
  sheet.className = 'Fighter';
  captureProviderState(sheet, '2024');

  sheet.abilities.STR = 18;
  sheet.ac = 19;
  assert.deepEqual(resolveProviderState(sheet, '2024'), {
    status: 'reconcile',
    reason: 'manual',
    changed: ['abilities', 'ac'],
  });
  assert.deepEqual(resolveProviderState(sheet, '2014'), {
    status: 'reconcile',
    reason: 'edition',
  });
});

test('manual and unavailable modes never activate provider computation', () => {
  const sheet = blank();
  sheet.rulesMode = 'manual';
  assert.deepEqual(resolveProviderState(sheet, '2024'), { status: 'manual' });
  assert.deepEqual(
    resolveProviderState(sheet, '2024', false),
    { status: 'unavailable' },
  );
});

test('materialized snapshots are detached from later sheet mutations', () => {
  const sheet = blank();
  const snapshot = materializedValues(sheet);
  sheet.abilities.STR = 20;
  assert.equal(snapshot.abilities.STR, 10);
});

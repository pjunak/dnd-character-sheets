import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blank } from '../helpers.js';
import {
  captureProviderState,
  materializedValues,
  resolveProviderState,
} from '../provider-state.js';

const identity = (overrides = {}) => ({
  engineAddonId: 'engine', engineAddonVersion: '1.0.0', engineContractVersion: '1.0.0',
  providerAddonId: 'rules-data', providerAddonVersion: '1.0.0', providerContractVersion: '1.0.0',
  contentRevision: 'a', rulesetId: 'dnd-2024', rulesetVersion: 1, edition: '2024',
  ...overrides,
});

test('captured materialized fields remain active while only play state changes', () => {
  const sheet = blank();
  sheet.className = 'Wizard';
  sheet.abilities.INT = 16;
  captureProviderState(sheet, identity());

  sheet.hp = 4;
  sheet.inventory.push({ id: 'potion', name: 'Potion' });
  assert.deepEqual(resolveProviderState(sheet, identity()), { status: 'active' });
});

test('computed-field edits and edition changes require explicit reconciliation', () => {
  const sheet = blank();
  sheet.className = 'Fighter';
  captureProviderState(sheet, identity());

  sheet.abilities.STR = 18;
  sheet.ac = 19;
  assert.deepEqual(resolveProviderState(sheet, identity()), {
    status: 'reconcile',
    reason: 'manual',
    changed: ['abilities', 'ac'],
  });
  assert.deepEqual(resolveProviderState(sheet, identity({ edition: '2014' })), {
    status: 'reconcile',
    reason: 'edition',
  });
});

test('engine, data provider, ruleset, or content changes require reconciliation', () => {
  const sheet = blank();
  captureProviderState(sheet, identity());
  assert.deepEqual(resolveProviderState(sheet, identity({ contentRevision: 'b' })), {
    status: 'reconcile', reason: 'identity',
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

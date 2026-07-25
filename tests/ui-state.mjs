import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUiState } from '../ui-state.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

test('UI state persists only tab and layout preferences', () => {
  const storage = memoryStorage({
    'dse-tab:c1': 'combat',
    'dse-ui:layout': 'compact',
  });
  const state = createUiState(storage);
  const tabs = [{ id: 'overview' }, { id: 'combat' }];

  assert.equal(state.getTab('c1', tabs), 'combat');
  assert.equal(state.getLayout('c1'), 'compact');
  state.setTab('c1', 'overview');
  state.setLayout('c1', 'classic');
  state.set('c1', 'restOpen', true);

  assert.equal(storage.values.get('dse-tab:c1'), 'overview');
  assert.equal(storage.values.get('dse-ui:layout:c1'), 'classic');
  assert.equal(storage.values.has('restOpen'), false);
});

test('UI state isolates and clears transient values by character', () => {
  const state = createUiState(null);
  state.set('a', 'modal', 'copy');
  state.set('b', 'modal', 'other');
  state.update('a', 'cart', cart => [...cart, 'item'], []);

  assert.equal(state.get('a', 'modal'), 'copy');
  assert.deepEqual(state.get('a', 'cart'), ['item']);
  assert.equal(state.get('b', 'modal'), 'other');

  state.remove('a', 'modal');
  assert.equal(state.get('a', 'modal'), null);
  state.clear('b');
  assert.equal(state.get('b', 'modal'), null);
  state.clear();
  assert.deepEqual(state.get('a', 'cart', []), []);
});

test('UI state rejects unavailable tabs and invalid layouts safely', () => {
  const storage = memoryStorage({
    'dse-tab:c1': 'removed-tab',
    'dse-ui:layout:c1': 'unknown',
  });
  const state = createUiState(storage);
  assert.equal(state.getTab('c1', [{ id: 'overview' }]), 'overview');
  assert.equal(state.getLayout('c1'), 'classic');
  state.setLayout('c1', 'unknown');
  assert.equal(storage.values.get('dse-ui:layout:c1'), 'classic');
});

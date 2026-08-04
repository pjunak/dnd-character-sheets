import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererRegistry, COMPACT_RENDERER } from '../renderer-registry.js';
import { createUiState } from '../ui-state.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    value: key => values.get(key),
  };
}

function handle(addonId = 'community-sheets', overrides = {}) {
  return Object.freeze({
    api: Object.freeze({
      apiVersion: 1,
      descriptor: () => ({
        id: 'ink', label: 'Ink', description: 'A printable ink-first style.',
        sheetSchemaVersion: 1,
      }),
      render: payload => `<div data-surface="${payload.surface}">${payload.defaultHtml}</div>`,
      ...overrides.api,
    }),
    provider: Object.freeze({
      addonId, addonName: 'Community Sheets', addonVersion: '2.0.0',
      contract: 'dnd-sheets.renderer', contractVersion: '1.0.0',
      permissions: Object.freeze(['ui:override', 'data:read:characters']),
      ...overrides.provider,
    }),
  });
}

test('renderer registry discovers unknown addon ids without a whitelist', () => {
  const handles = [handle('third-party-style')];
  const state = createUiState(storage());
  const registry = createRendererRegistry({ listServices: () => handles }, state);

  assert.ok(registry.list().some(renderer => renderer.identity === 'third-party-style:ink'));
  assert.equal(registry.select('alice', 'third-party-style:ink'), true);
  assert.match(registry.render('alice', 'stats', { sheet: { hp: 7 } }, '<p>default</p>'), /data-surface="stats"/);
});

test('renderer preference is per character and per browser', () => {
  const firstStorage = storage();
  const secondStorage = storage();
  const host = { listServices: () => [handle()] };
  const first = createRendererRegistry(host, createUiState(firstStorage));
  const second = createRendererRegistry(host, createUiState(secondStorage));

  first.select('hero-a', 'community-sheets:ink');
  assert.equal(first.resolve('hero-a').preferred, 'community-sheets:ink');
  assert.equal(first.resolve('hero-b').preferred, COMPACT_RENDERER);
  assert.equal(second.resolve('hero-a').preferred, COMPACT_RENDERER);
});

test('missing or failing renderer falls back to Compact without erasing preference', () => {
  const local = storage({ 'dse-ui:renderer:hero': 'community-sheets:ink' });
  let handles = [];
  const registry = createRendererRegistry({ listServices: () => handles }, createUiState(local));

  assert.equal(registry.resolve('hero').renderer.identity, COMPACT_RENDERER);
  assert.equal(registry.resolve('hero').unavailable, true);
  assert.equal(local.value('dse-ui:renderer:hero'), 'community-sheets:ink');

  handles = [handle('community-sheets', { api: { render: () => { throw new Error('broken'); } } })];
  assert.equal(registry.render('hero', 'combat', {}, '<p>safe</p>'), '<p>safe</p>');
  assert.equal(local.value('dse-ui:renderer:hero'), 'community-sheets:ink');
});

test('throwing renderer descriptor properties are isolated per provider', () => {
  const malformed = handle('malformed-style', {
    api: {
      descriptor: () => ({
        id: 'ink',
        sheetSchemaVersion: 1,
        get label() { throw new Error('bad label'); },
      }),
    },
  });
  const healthy = handle('healthy-style');
  const registry = createRendererRegistry(
    { listServices: () => [malformed, healthy] },
    createUiState(storage()),
  );
  assert.doesNotThrow(() => registry.list());
  assert.ok(registry.list().some(renderer => renderer.identity === 'healthy-style:ink'));
  assert.ok(!registry.list().some(renderer => renderer.identity === 'malformed-style:ink'));
});

test('renderer providers must hold the privileges delegated through the sheet', () => {
  const denied = handle('unprivileged-style', { provider: { permissions: Object.freeze([]) } });
  const registry = createRendererRegistry({ listServices: () => [denied] }, createUiState(storage()));
  assert.ok(!registry.list().some(renderer => renderer.identity.startsWith('unprivileged-style:')));
});

test('legacy layout preferences migrate on read and Compact is the fresh default', () => {
  assert.equal(createUiState(storage()).getRenderer('hero'), COMPACT_RENDERER);
  assert.equal(
    createUiState(storage({ 'dse-ui:layout:hero': 'classic' })).getRenderer('hero'),
    'builtin:classic',
  );
});

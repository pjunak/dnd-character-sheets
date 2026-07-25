// Client self-test for dnd-sheets, run against the host's published test
// harness (the same one the host uses for its pre-activation smoke). Declared
// in addon.json as `tests.client`. Run standalone:
//   node --test tests/smoke.mjs
//
// NOTE: the harness import path assumes the host repo (ttrpg-codex) is checked
// out as a SIBLING of this addon repo — i.e. both under .../GitHub/. This is a
// dev-only test; the install green-gate is `tests.server` (none needed here).
//
// The sheet integrates by REPLACING the host's `characters:body` fragment with a
// tab strip (registerFragmentOp · replace) — the folded wiki profile becomes the
// Overview tab and the D&D tabs follow. So these tests drive
// `rec.fragmentOps[].spec.render(html, ctx)` (ctx.entity = the character; html =
// the host profile), forcing the active tab via localStorage 'dse-tab:<cid>'.
// Editing is role-gated (editor by default; pass { isAnonymous: true } for the
// read-only path).
//
// ENGINE MODE: the rules engine is BUILT IN (rules/) — what the tests inject is
// fake BOOK DATA as deps['dnd55e-compendium'] (tests/fake-phb.mjs, shared
// with tests/rules.mjs), so the real engine computes over it. Expected numbers
// below therefore mirror the engine-pinned values in tests/rules.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dryRunRegister, smokeRegistrations, createMockHost } from '../../ttrpg-codex/web/js/addon-test-harness.mjs';
import register from '../entry.js';
import { makeFake } from './fake-phb.mjs';
import { makeEngine } from '../model.js';
import { makeRulesApi } from '../rules/api.js';
import { makeHelpers, ABILITIES, SKILLS, num, abilityMod, clampHp } from '../helpers.js';
import { BASE_ACTIONS } from '../actions.base.js';
import { RESOURCE_ACTIONS, applyHpChange } from '../actions.resources.js';
import { SPELL_ACTIONS } from '../actions.spells.js';
import { INVENTORY_ACTIONS, addInventoryItems } from '../actions.inventory.js';
import { BUILDER_ACTIONS } from '../actions.builder.js';
import { TRANSFER_ACTIONS } from '../actions.transfer.js';
import { captureProviderState } from '../provider-state.js';

const EN_CATALOG = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));

function mockLocalStorage(tab) {
  const storage = {
    getItem: (k) => (String(k).startsWith('dse-tab:') ? (tab || null) : null),
    setItem() {}, removeItem() {},
  };
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage };
}
function clearLocalStorage() {
  delete globalThis.localStorage;
  delete globalThis.window;
}

// Invoke the body-fragment render (the whole sheet). `lore` stands in for the
// host's rendered description; defaults to a marked block so the Overview tab can
// be asserted to pass it through.
function renderBody(rec, char, lore) {
  const frag = rec.fragmentOps.find((f) => f.target === 'characters:body');
  const html = lore != null ? lore : '<div class="md-view"><p>LORE_BODY</p></div>';
  return frag.spec.render(html, { entity: char, kind: 'characters', target: 'characters:body' });
}

const META = {
  id: 'dnd-sheets',
  version: '0.7.0',
  apiVersion: 2,
  hostVersion: '>=1.0.0',
  capabilities: { required: ['lifecycle.dispose', 'i18n.catalogs'] },
  locales: { en: 'locales/en.json' },
  permissions: ['ui:override', 'ui:action', 'data:read:characters', 'data:write:characters.addonData'],
  optionalDependencies: { 'dnd55e-compendium': { range: '>=0.1.0' } },
};
const localizedOpts = (opts = {}) => ({ ...opts, catalogs: { en: EN_CATALOG } });
const dryRun = (opts = {}) => dryRunRegister(register, META, localizedOpts(opts));
const mockHost = (opts = {}) => createMockHost(META, localizedOpts(opts));

// Book data present → the built-in engine computes (fresh fake per test).
const PHB = () => ({ deps: { 'dnd55e-compendium': makeFake() } });
const RETAINED_ACTIONS = [
  ...BASE_ACTIONS, ...SPELL_ACTIONS, ...INVENTORY_ACTIONS,
  ...RESOURCE_ACTIONS, ...BUILDER_ACTIONS, ...TRANSFER_ACTIONS,
].sort();
const REMOVED_ACTIONS = ['hp', 'copySpell', 'invAdd', 'invAddRef', 'builderBgAsi'];

const FIGHTER = {
  id: 'c1', name: 'Thorin',
  addonData: { 'dnd-sheets': {
    className: 'Fighter', level: 5, profBonus: 3,
    abilities: { STR: 16, DEX: 12, CON: 15, INT: 10, WIS: 13, CHA: 8 },
    maxHp: 44, hp: 40, ac: 18, saveProf: { STR: true, CON: true },
    skillProf: { athletics: true, perception: true },
  } },
};

test('sheets: register is clean + wires the expected surface', () => {
  const { ok, rec, error } = dryRun();
  assert.ok(ok, error);
  assert.ok(rec.fragmentOps.some(f => f.target === 'characters:body' && f.spec.op === 'replace'), 'replaces the character body fragment');
  const names = rec.actions.map((action) => action.name);
  assert.deepEqual(names.slice().sort(), RETAINED_ACTIONS, 'the six domain controllers own the exact retained action surface');
  assert.equal(new Set(names).size, names.length, 'every retained action is registered exactly once');
  for (const name of REMOVED_ACTIONS) assert.ok(!names.includes(name), `${name} stays removed`);
  assert.equal(rec.settingsTabs.length, 0, 'no host settings tab — sheet options live on the sheet\'s own ⚙ tab');
  assert.ok(rec.provided && rec.provided.apiVersion === 1, 'provides the rules api for other addons');
  assert.ok(!rec.articleSections.length, 'no standalone article section (we own the body instead)');
  assert.ok(!rec.editorFields.length, 'no editor fields (the host edit form stays host-only)');
});

test('sheets: renderers survive the smoke pass (sparse entity)', () => {
  const { rec } = dryRun();
  const smoke = smokeRegistrations(rec);
  assert.ok(smoke.ok, JSON.stringify(smoke.failures));
  assert.deepEqual(rec.i18nMissing, [], 'render smoke references only declared English source keys');
});

test('sheets: scoped host locale changes and partial catalogs update rendered UI', () => {
  mockLocalStorage('stats');
  try {
    const catalogs = {
      en: EN_CATALOG,
      cs: {
        'tab.stats': 'Deník postavy',
        'sheet.title': 'Deník D&D',
        'sheet.abilities': 'Vlastnosti',
        'print.level': 'Úroveň {level}',
      },
    };
    const localizedMeta = {
      ...META,
      locales: { ...META.locales, cs: 'locales/cs.json' },
    };
    const { ok, rec, error } = dryRunRegister(register, localizedMeta, {
      locale: 'cs-CZ',
      catalogs,
      fixtures: { characters: [FIGHTER] },
    });
    assert.ok(ok, error);
    assert.match(renderBody(rec, FIGHTER), /Deník postavy/);
    let captured = '';
    globalThis.window = { open: () => ({ document: { open() {}, write(html) { captured = html; }, close() {} }, focus() {}, print() {} }) };
    try { rec.actions.find((action) => action.name === 'printSheet').fn(FIGHTER.id); } finally { delete globalThis.window; }
    assert.match(captured, /<html lang="cs-cz">/);
    assert.match(captured, /<h2>Vlastnosti<\/h2>/);
    assert.match(captured, /Úroveň 5/);
    assert.deepEqual(rec.i18nMissing, []);
  } finally {
    clearLocalStorage();
  }
});

test('sheets: removed action seams are absent from every representative render path', () => {
  const character = {
    id: 'render-actions',
    name: 'Mage',
    addonData: { 'dnd-sheets': { className: 'Wizard', level: 5, spells: [{ id: 's1', name: 'Shield', level: 1 }] } },
  };
  try {
    for (const tab of ['overview', 'stats', 'combat', 'spellbook', 'builder', 'settings']) {
      mockLocalStorage(tab);
      const { rec } = dryRun(PHB());
      const out = renderBody(rec, character);
      const registered = new Set(rec.actions.map((action) => action.name));
      const referenced = [...out.matchAll(/data-(?:action|on-[a-z]+)="dnd-sheets:([^"]+)"/g)].map((match) => match[1]);
      for (const name of referenced) assert.ok(registered.has(name), `${tab} renders only registered actions (${name})`);
      for (const name of REMOVED_ACTIONS) {
        assert.doesNotMatch(out, new RegExp(`="dnd-sheets:${name}"`), `${tab} does not generate ${name}`);
      }
    }
  } finally { clearLocalStorage(); }
});

test('sheets: scoped styles use host tokens and canonical breakpoints', () => {
  const source = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  const breakpoints = [...source.matchAll(/@media\s*\(max-width:(\d+)px\)/g)].map((match) => Number(match[1]));
  assert.ok(breakpoints.length > 0, 'the scoped styles include responsive rules');
  assert.ok(breakpoints.every((width) => [768, 1100, 1200].includes(width)), 'all responsive rules use host breakpoints');
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i, 'scoped styles contain no hardcoded hex colours');
  assert.doesNotMatch(source, /rgba?\((?!var\()/, 'alpha colours use host channel tokens');
  assert.doesNotMatch(source, /\b(?:gap|padding|margin(?:-(?:top|right|bottom|left))?):[^;\n]*(?:^|[\s:])(2|4)px\b/m, 'layout spacing uses host tokens');
});

test('sheets: Overview tab is the host lore (reused, not duplicated)', () => {
  mockLocalStorage('overview');
  try {
    const { rec } = dryRun();
    const out = renderBody(rec, FIGHTER, '<div class="md-view"><p>UNIQUE_LORE_MARKER</p></div>');
    assert.match(out, /UNIQUE_LORE_MARKER/, 'the host lore IS the Overview tab');
    assert.match(out, /Character Sheet/, 'the addon adds D&D tabs');
    assert.doesNotMatch(out, /Saving Throws/, 'D&D stat panels live on other tabs, not Overview');
  } finally { clearLocalStorage(); }
});

test('sheets: Character Sheet tab shows class + ability mods (standalone)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun();
    const out = renderBody(rec, FIGHTER);
    assert.match(out, /Fighter/, 'class line in the vitals bar');
    assert.match(out, /\+3/, 'STR modifier (+3)');
    assert.doesNotMatch(out, /Builder/, 'no Builder tab in standalone (no book data)');
  } finally { clearLocalStorage(); }
});

test('sheets: engine-computed vitals + Builder tab (editor, book data present)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun(PHB());
    // Real engine over fake book data: L1 Wizard (d6) with CON 14 → max HP 6+2=8.
    const out = renderBody(rec, { id: 'c9', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard', hp: 4, abilities: { CON: 14 } } } });
    assert.match(out, /Builder/, 'Builder tab appears (book data + editor)');
    assert.match(out, / \/ 8</, 'vitals bar shows the engine-computed max HP (8)');
  } finally { clearLocalStorage(); }
});

test('sheets: HP is a directly editable stepper with no damage-by-amount field', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'chp', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard', hp: 4, abilities: { CON: 14 } } } });
    assert.match(out, /codex-stepper/, 'current HP uses the host .codex-stepper');
    assert.match(out, /"hp","\$value"/, 'the HP stepper writes the hp field (setField)');
    assert.doesNotMatch(out, /dse-hp-amt/, 'the manual heal/damage amount field is gone');
    assert.doesNotMatch(out, /hpApply/, 'the heal/damage-by-amount buttons are gone');
  } finally { clearLocalStorage(); }
});

test('sheets: vital tiles carry text labels + the compact strip adds spell DC/attack', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cvi', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard', abilities: { DEX: 14 } } } });
    // Stat names are spelled-out text labels again (the icon-glyph vitals were
    // reverted — icons read too cryptic for the width they saved).
    assert.match(out, /class="codex-tile-label">Hit Points</, 'the HP tile is plainly text-labelled');
    // The HP hover legend rides the MAX number (the "where did that come from"
    // value), not the label — the max is wrapped in the has-info tip.
    assert.match(out, /codex-tip-u"><span[^>]*> \/ \d/, 'the max-HP number carries the hover legend');
    assert.match(out, /class="codex-tile-label">Speed</, 'a computed vital is text-labelled');
    // Initiative is a start-of-fight number → it lives on the Combat tab only.
    assert.doesNotMatch(out, /class="codex-tile-label">Initiative</, 'no Initiative tile on the Character Sheet');
    assert.doesNotMatch(out, /codex-icon/, 'no stat glyphs in the vitals');
    // The width the compact tiles free up carries the caster stats (engine mode).
    assert.match(out, /class="codex-tile-label">Save DC</, 'spell save DC joins the vitals strip');
    assert.match(out, /class="codex-tile-label">Spell Attack</, 'spell attack bonus joins the vitals strip');
    // The strip is wrapped so the addon stylesheet can stop the tiles growing.
    assert.match(out, /class="dse-vitals"/, 'the compact-width wrapper class is present');
  } finally { clearLocalStorage(); }
});

test('sheets: 3-state SVG proficiency dots + AC shield-equipped indicator (UI polish)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun(PHB());
    // Sage background grants Arcana + History proficiency → a proficient dot to assert.
    const out = renderBody(rec, { id: 'cui', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard', background: 'Sage', abilities: { DEX: 14 } } } });
    // Dots are inline SVG: none = small outline circle, proficient = small filled circle
    // (mastery = a larger ring + filled centre, same helper).
    assert.match(out, /<circle cx="8" cy="8" r="3\.6" fill="none"/, 'unproficient skills → small outline dot');
    assert.match(out, /<circle cx="8" cy="8" r="4\.2" fill="var\(--accent-gold\)"/, 'a proficient skill → small filled dot');
    // AC tile carries a shield-equipped indicator (this Wizard has none → the
    // off-state: an EMPTY shield outline struck through by a diagonal line).
    assert.match(out, /No shield equipped/, 'AC shows the shield indicator');
    assert.match(out, /M12 2\.6 19 5\.3V11[^"]*" fill="none"/, 'off-state = the shield shape, unfilled');
    assert.match(out, /<line x1="4\.2" y1="3\.4"/, 'off-state shield is struck through');
    assert.doesNotMatch(out, /d="M12 2\.6[^"]*" fill="var\(--accent-gold\)"/, 'no filled shield without one equipped');
  } finally { clearLocalStorage(); }
});

test('sheets: anonymous viewer gets a read-only sheet (no Builder, no inputs)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun({ ...PHB(), isAnonymous: true });
    const out = renderBody(rec, { id: 'ca', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard' } } });
    assert.doesNotMatch(out, /Builder/, 'no Builder tab for an anonymous viewer');
    assert.doesNotMatch(out, /<input/, 'no edit inputs for an anonymous viewer');
    assert.doesNotMatch(out, /toggleSkill/, 'no prof toggles for an anonymous viewer');
  } finally { clearLocalStorage(); }
});

test('sheets: Builder tab renders the guided form when book data is present', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cb', name: 'Hero', addonData: { 'dnd-sheets': { className: 'Wizard', abilities: { INT: 15 } } } });
    assert.match(out, /Ability Scores|Class & Levels|Progression/, 'shows Builder sections');
    assert.match(out, /Wizard/, 'class dropdown / resolved class');
    assert.match(out, /<select/, 'renders dropdowns');
  } finally { clearLocalStorage(); }
});

test('sheets: the Builder has a Character tab and one tab per class', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cbt', name: 'Multi', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 2, subclass: '' }, { classId: 'wizard', level: 3, subclass: '' }], abilities: { STR: 14, INT: 14 } } } });
    assert.match(out, /builderTab/, 'the sub-tab strip is present');
    assert.match(out, /Fighter 2/, 'a tab per class, with its level');
    assert.match(out, /Wizard 3/, 'the second class tab');
    assert.match(out, /Ability Scores/, 'defaults to the Character tab (abilities visible)');
  } finally { clearLocalStorage(); }
});

test('sheets: a class tab spine shows subclass features', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    rec.actions.find((a) => a.name === 'builderTab').fn('cbs', 'fighter');   // open the Fighter class tab
    // Eldritch Knight grants "War Bond" at level 3; the spine filters subclass features
    // by cl.subclass — not cl.classId — so it appears in the Fighter tab's spine.
    const out = renderBody(rec, { id: 'cbs', name: 'EK', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 3, subclass: 'eldritch-knight' }], abilities: { STR: 15 } } } });
    assert.match(out, /War Bond/, 'subclass feature appears in the class spine');
  } finally { clearLocalStorage(); }
});

test('sheets: the class spine links resolved feature names to the compendium', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    rec.actions.find((a) => a.name === 'builderTab').fn('cbl', 'sorcerer');   // open the Sorcerer class tab
    // Sorcerer L2's "Metamagic" resolves to the sorcerer-metamagic feature record → its
    // name links to the compendium detail page (in the class spine now, not a flat log).
    const out = renderBody(rec, { id: 'cbl', name: 'Sorc', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'sorcerer', level: 2, subclass: '' }], abilities: { CHA: 15 } } } });
    assert.match(out, /href="#\/compendium\/feature:sorcerer-metamagic"/, 'resolved feature name links to its compendium page');
  } finally { clearLocalStorage(); }
});

test('sheets: featureChoices resolve into engine inputs (skill prof + expertise)', () => {
  // Adapter-level: decisionsOf maps stored featureChoices → the canonical
  // engine input fields. Uses a minimal local fake (a class with a skill
  // choice + an expertise choice) through the real rules api.
  const WIZ = {
    id: 'wizard', name: 'Wizard', hitDie: 'd6', subclassLevel: 3,
    startingProficiencies: { skills: { choose: 2, from: ['arcana', 'history', 'stealth'] } },
    grants: { choices: [{ id: 'wiz-exp', type: 'expertise', count: 1, source: 'wizard:1' }] },
  };
  const api = makeRulesApi(() => ({
    apiVersion: 1,
    getItem: (kind, id) => ((kind === 'class' && id === 'wizard') ? WIZ : null),
    getItemByName: (kind, name) => ((kind === 'class' && /wizard/i.test(String(name))) ? WIZ : null),
  }));
  const { host } = mockHost({});
  const { sheetOf } = makeHelpers(host);
  const E = makeEngine({ host, NS: 'dnd-sheets', ABILITIES, SKILLS, num, abilityMod, sheetOf });
  const s = sheetOf({ addonData: { 'dnd-sheets': {
    className: 'Wizard',
    featureChoices: { 'skills:wizard#0': 'arcana', 'skills:wizard#1': 'stealth', 'wiz-exp': 'stealth' },
  } } });
  const cd = E.decisionsOf(s, api);
  assert.deepEqual([...cd.skillProficiencies].sort(), ['arcana', 'stealth'], 'class skill picks resolved');
  assert.equal(cd.skillExpertise.stealth, true, 'expertise pick resolved');
});

test('sheets: duplicate multi-pick values dedupe in resolved inputs (FE-7)', () => {
  const WIZ = { id: 'wizard', name: 'Wizard', hitDie: 'd6', subclassLevel: 3,
    startingProficiencies: { skills: { choose: 2, from: ['arcana', 'history', 'stealth'] } } };
  const api = makeRulesApi(() => ({ apiVersion: 1,
    getItem: (kind, id) => ((kind === 'class' && id === 'wizard') ? WIZ : null),
    getItemByName: (kind, name) => ((kind === 'class' && /wizard/i.test(String(name))) ? WIZ : null) }));
  const { host } = mockHost({});
  const { sheetOf } = makeHelpers(host);
  const E = makeEngine({ host, NS: 'dnd-sheets', ABILITIES, SKILLS, num, abilityMod, sheetOf });
  const s = sheetOf({ addonData: { 'dnd-sheets': { className: 'Wizard',
    featureChoices: { 'skills:wizard#0': 'arcana', 'skills:wizard#1': 'arcana' } } } });   // same skill in both boxes (legacy dup)
  const cd = E.decisionsOf(s, api);
  assert.deepEqual(cd.skillProficiencies, ['arcana'], 'a value picked in two boxes collapses to one proficiency');
});

test('sheets: duplicate L1 skills descriptor dedupes to one picker — no "content pending"', () => {
  // Real class records declared the L1 skills choice TWICE — canonically in
  // startingProficiencies.skills (WITH a `from` pool) AND redundantly in grants.choices
  // as a bare {type:'skills'} with the SAME id and no `from`. The bare dup rendered as
  // an empty enumerated picker ("content pending"). collectChoices must keep only the
  // well-formed first descriptor. The shared fake doesn't replicate the duplication, so
  // it's reproduced inline — this proves the ENGINE dedupe alone fixes the bug, even
  // against handbook data that still carries the redundant entry.
  const CLERIC = {
    id: 'cleric', name: 'Cleric', hitDie: 'd8', subclassLevel: 3,
    startingProficiencies: { skills: { choose: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] } },
    grants: { choices: [{ id: 'skills:cleric', source: 'cleric:1', type: 'skills', count: 2 }] },
  };
  const api = makeRulesApi(() => ({ apiVersion: 1,
    getItem: (kind, id) => ((kind === 'class' && id === 'cleric') ? CLERIC : null),
    getItemByName: (kind, name) => ((kind === 'class' && /cleric/i.test(String(name))) ? CLERIC : null) }));
  const { host } = mockHost({});
  const { sheetOf } = makeHelpers(host);
  const E = makeEngine({ host, NS: 'dnd-sheets', ABILITIES, SKILLS, num, abilityMod, sheetOf });
  const choices = E.collectChoices([{ classId: 'cleric', level: 1, subclass: '' }], api);
  const skills = choices.filter((c) => c.id === 'skills:cleric');
  assert.equal(skills.length, 1, 'exactly one descriptor for skills:cleric (the bare dup is dropped)');
  assert.equal(skills[0].kind, 'skills', 'the survivor is the well-formed skills picker');
  assert.deepEqual(skills[0].from, ['history', 'insight', 'medicine', 'persuasion', 'religion'], 'it carries the from pool');
  assert.ok(!choices.some((c) => c.kind === 'enumerated'), 'no empty enumerated dup survives (would render "content pending")');
});

test('sheets: Builder actions mutate the model + materialize without throwing', () => {
  const { rec } = dryRun(PHB());
  const act = (name, ...args) => rec.actions.find(a => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('builderAbility', 'c1', 'STR', '15'));
  assert.doesNotThrow(() => act('builderClassSet', 'c1', 0, 'wizard'));
  assert.doesNotThrow(() => act('builderLevelSet', 'c1', 0, '5'));
  assert.doesNotThrow(() => act('builderAddClass', 'c1'));
  assert.doesNotThrow(() => act('builderAsiSet', 'c1', 'bgasi', 'STR', 2, 3, 2));
  assert.doesNotThrow(() => act('builderChoose', 'c1', 'asi:wizard:4:ability', 'CON'));
});

test('sheets: a half-feat chosen at an ASI level applies its ability bump (AB-2)', () => {
  // great-weapon-master (single-option +1 STR) and fey-touched (choose one of
  // INT/WIS/CHA) both live in the shared fake book data.
  const { host, rec } = mockHost(PHB());
  let stored = {};
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  const grantFor = (base) => (stored.abilityGrants || []).find((g) => g.id === base + ':featability');

  act('builderChoose', 'c1', 'asi:wizard:4:feat', 'great-weapon-master');
  assert.equal(grantFor('asi:wizard:4')?.assign.STR, 1, 'GWM auto-applies +1 STR');

  act('builderChoose', 'c1', 'asi:wizard:4:feat', 'fey-touched');
  assert.equal(grantFor('asi:wizard:4'), undefined, 'multi-option half-feat waits for the ability sub-pick');
  act('builderChoose', 'c1', 'asi:wizard:4:featability', 'CHA');
  assert.equal(grantFor('asi:wizard:4')?.assign.CHA, 1, 'sub-pick applies +1 CHA');

  act('builderChoose', 'c1', 'asi:wizard:4', 'asi');
  assert.equal(grantFor('asi:wizard:4'), undefined, 'mode switch clears the feat grant');
});

test('sheets: ASI number picker distributes a capped 2-point budget', () => {
  const { host, rec } = mockHost(PHB());
  let stored = {};
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  const asi = () => (stored.abilityGrants || []).find((g) => g.id === 'asi:wizard:4:ability');
  const set = (ab, v) => act('builderAsiSet', 'c1', 'asi:wizard:4:ability', ab, v, 2, 2);
  // +1/+1 across two abilities — something the old single-ability select couldn't express.
  set('STR', 1);
  assert.ok(rec.announces.includes('1 pt left'), 'each budget change announces the remainder (host live region)');
  set('DEX', 1);
  assert.ok(rec.announces.includes('0 pts left'), 'spending the last point announces zero');
  assert.deepEqual(asi().assign, { STR: 1, DEX: 1 }, 'two abilities each +1');
  set('CON', 1);
  assert.equal(asi().assign.CON, undefined, 'a 3rd point exceeds the 2-budget → clamped away');
  // Free up DEX, then +2 to a single ability; a typed 3 is clamped to the per-ability cap.
  set('DEX', 0);
  set('STR', 2);
  assert.deepEqual(asi().assign, { STR: 2 }, '+2 to a single ability');
  set('STR', 3);
  assert.equal(asi().assign.STR, 2, 'per-ability cap (2) enforced');
});

test('sheets: background ASI picker distributes 3 points with +2 max per ability', () => {
  const { host, rec } = mockHost(PHB());
  let stored = {};
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  const bg = () => (stored.abilityGrants || []).find((g) => g.id === 'bgasi');
  const set = (ab, v) => act('builderAsiSet', 'c1', 'bgasi', ab, v, 3, 2);
  set('STR', 2); set('DEX', 1);   // +2 STR, +1 DEX = the 3-point spend
  assert.deepEqual(bg().assign, { STR: 2, DEX: 1 }, '+2/+1 across two abilities (3 points)');
  set('CON', 1);
  assert.equal(bg().assign.CON, undefined, 'a 4th point exceeds the 3-budget → clamped away');
  set('STR', 3);
  assert.equal(bg().assign.STR, 2, 'per-ability cap (2) enforced');
});

test('sheets: ASI level renders ability number pickers, not a single select', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'casi', 'fighter');
    act('builderToggleLevel', 'casi', 'fighter:4');   // expand the L4 ASI row
    const out = renderBody(rec, { id: 'casi', name: 'Ftr', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 4, subclass: '' }],
      featureChoices: { 'asi:fighter:4': 'asi' } } } });   // ASI mode (not Feat)
    assert.match(out, /codex-stepper/, 'the ASI ability pick uses the host .codex-stepper component');
    assert.match(out, /builderAsiSet/, 'the stepper input is wired to builderAsiSet');
    assert.match(out, /asi:fighter:4:ability/, 'steppers target the ASI ability grant');
  } finally { clearLocalStorage(); }
});

test('sheets: the L19 slot offers Epic Boon feats (grouped); earlier ASI levels stay general-only', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    const charOf = (id, extra) => ({ id, name: 'Ftr', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 19, subclass: '' }], abilities: {},
      featureChoices: { 'asi:fighter:19': 'feat', 'asi:fighter:4': 'feat', ...(extra || {}) } } } });
    act('builderTab', 'ceb', 'fighter');
    act('builderToggleLevel', 'ceb', 'fighter:19');
    const out = renderBody(rec, charOf('ceb'));
    assert.match(out, /<optgroup label="Epic Boons">/, 'boons are grouped distinctly');
    assert.match(out, /value="boon-of-fate"/, 'an epic boon is offered at L19');
    assert.match(out, /value="tough"/, 'general feats remain offered at L19 ("or another feat")');
    assert.match(out, /Level 19 grants an Epic Boon/, 'the canon hint explains the slot');
    act('builderTab', 'ceb2', 'fighter');
    act('builderToggleLevel', 'ceb2', 'fighter:4');
    const out2 = renderBody(rec, charOf('ceb2'));
    assert.doesNotMatch(out2, /boon-of-fate/, 'no epic boons before level 19');
    assert.doesNotMatch(out2, /<optgroup/, 'the pre-19 picker stays a flat general list');
    // 'ANY' (Boon of Skill) expands to the full six-ability picker.
    act('builderTab', 'ceb3', 'fighter');
    act('builderToggleLevel', 'ceb3', 'fighter:19');
    const out3 = renderBody(rec, charOf('ceb3', { 'asi:fighter:19:feat': 'boon-of-skill' }));
    assert.match(out3, /asi:fighter:19:featability/, "the 'ANY' boon renders an ability sub-picker");
    assert.match(out3, /Charisma/, 'all six abilities are eligible under ANY');
  } finally { clearLocalStorage(); }
});

test('sheets: a picked Epic Boon applies its +1 through the grant machinery with the 30 cap', () => {
  const { host, rec } = mockHost(PHB());
  let stored = {
    classes: [{ classId: 'fighter', level: 19, subclass: '' }],
    manualScores: true, baseStats: { STR: 10, DEX: 10, CON: 10, INT: 20, WIS: 10, CHA: 10 },
    abilities: { INT: 20 },
    featureChoices: { 'asi:fighter:19': 'feat', 'asi:fighter:19:feat': 'boon-of-fate' },
  };
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  act('builderAsiSet', 'c1', 'asi:fighter:19:featability', 'INT', 1, 1, 1);
  const g = stored.abilityGrants.find((x) => x.id === 'asi:fighter:19:featability');
  assert.deepEqual(g.assign, { INT: 1 }, 'the boon ability pick lands as an ability grant');
  assert.equal(g.cap, 30, 'the grant carries the raised Epic Boon cap');
  assert.equal(stored.abilities.INT, 21, 'materialized INT rises past 20 (engine clamped at the boon cap)');
  // A single-option boon auto-applies its +1 (with the cap) on pick.
  act('builderChoose', 'c1', 'asi:fighter:19:feat', 'boon-of-fortitude');
  const g2 = stored.abilityGrants.find((x) => x.id === 'asi:fighter:19:featability');
  assert.deepEqual(g2.assign, { CON: 1 }, 'a single-option boon auto-applies');
  assert.equal(g2.cap, 30, 'auto-applied boon grants carry the cap too');
});

test('sheets: a multi-pick pool excludes an option already taken in another box (FE-7)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'cfe7', 'sorcerer');            // open the Sorcerer class tab
    act('builderToggleLevel', 'cfe7', 'sorcerer:2');  // expand L2 (Metamagic) to reveal the pickers
    // Sorcerer L2 → 2 Metamagic boxes. Twinned is taken in box 0, so box 1 must not
    // offer it again (no picking it twice), while an untaken option stays in both.
    const out = renderBody(rec, { id: 'cfe7', name: 'Sorc', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'sorcerer', level: 2, subclass: '' }], abilities: { CHA: 15 },
      featureChoices: { 'metamagic#0': 'metamagic-twinned-spell' } } } });
    assert.equal((out.match(/value="metamagic-twinned-spell"/g) || []).length, 1, 'the taken option appears once (only its own box)');
    assert.equal((out.match(/value="metamagic-quickened-spell"/g) || []).length, 2, 'an untaken option stays available in both boxes');
  } finally { clearLocalStorage(); }
});

test('sheets: builder spine rows are whole-row targets while inner links stay live', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'cct', 'sorcerer');   // Sorcerer L2 has Metamagic → an expandable spine row
    const out = renderBody(rec, { id: 'cct', name: 'Sorc', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'sorcerer', level: 2, subclass: '' }], abilities: { CHA: 15 } } } });
    // The toggle is a full-row overlay <button> (not just the "L2" label), keyboard-
    // focusable, aria-expanded — so a click anywhere on the row expands it.
    assert.match(out, /position:absolute;inset:0/, 'a full-row overlay button covers the row head');
    assert.match(out, /aria-expanded/, 'the disclosure exposes aria-expanded');
    assert.match(out, /builderToggleLevel/, 'the overlay button toggles the level');
    // Dead space falls through to the button (content pointer-events:none) while inner
    // compendium links are re-enabled (pointer-events:auto) so they still navigate.
    assert.match(out, /pointer-events:none/, 'content layer passes dead-space clicks through');
    assert.match(out, /pointer-events:auto/, 'inner links remain interactive');
    // The row toggle reads as interactive: a hover/focus tint + keyboard focus ring.
    assert.match(out, /class="dse-spine-toggle"/, 'the row toggle carries the hover/focus class');
    assert.match(out, /\.dse-spine-toggle:hover/, 'the injected style gives the row a hover tint');
    assert.match(out, /\.dse-spine-toggle:focus-visible/, 'and a keyboard focus ring');
  } finally { clearLocalStorage(); }
});

test('sheets: builder sub-tabs support roving-tabindex arrow-key nav (a11y)', () => {
  mockLocalStorage('builder');
  try {
    const char = { id: 'ctk', name: 'Mage', addonData: { 'dnd-sheets': { classes: [{ classId: 'wizard', level: 1, subclass: '' }], abilities: { INT: 15 } } } };
    const { rec } = dryRun({ ...PHB(), fixtures: { characters: [char] } });
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    const out = renderBody(rec, char);
    // ARIA tablist wiring: the active tab is the sole roving tab stop + keydown-wired.
    assert.match(out, /id="dse-btab-ctk-character"[^>]*tabindex="0"/, 'Character sub-tab is the roving tab stop');
    assert.match(out, /id="dse-btab-ctk-wizard"[^>]*tabindex="-1"/, 'inactive sub-tab is skipped by Tab');
    assert.match(out, /builderTabKey/, 'sub-tabs wire arrow-key navigation');
    // ArrowRight from Character moves the active tab to the Wizard class tab.
    act('builderTabKey', { key: 'ArrowRight', preventDefault() {} }, 'ctk', 'character');
    const out2 = renderBody(rec, char);
    assert.match(out2, /id="dse-btab-ctk-wizard"[^>]*aria-selected="true"/, 'ArrowRight activates the next (Wizard) sub-tab');
  } finally { clearLocalStorage(); }
});

test('sheets: Spellbook separates granted from picks + shows the available pool', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    // Life Domain (subclass grant, level 3) → Bless always-prepared via the
    // real engine (mirrors tests/rules.mjs "grants always-prepared spells").
    const out = renderBody(rec, { id: 'csp', name: 'Mage', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'wizard', level: 5, subclass: 'life-domain' }],
      cantrips: { wizard: ['fire-bolt'] },
      preparedSpells: { wizard: ['fireball'] },
      spells: [{ id: 'x1', name: 'Counterspell', level: 3, origin: 'copied' }],
    } } });
    assert.match(out, /Always prepared/, 'granted section header');
    assert.match(out, /Bless/, 'granted (always-prepared) spell shown');
    // Chips are the host .codex-chip component; its comfortable min-height is
    // pinned host-side (ttrpg-codex test/design-system.test.mjs).
    assert.match(out, /class="codex-chip"/, 'spell chips are the host chip component');
    assert.match(out, /Fireball/, 'prepared pick shown');
    assert.match(out, /href="#\/compendium\/spell:fireball"/, 'prepared spell links to its compendium page');
    assert.match(out, /href="#\/compendium\/spell:bless"/, 'granted spell links to its compendium page');
    assert.match(out, /Fire Bolt/, 'cantrip pick shown');
    assert.match(out, /Extra spells/, 'extra/copied section');
    assert.match(out, /Counterspell/, 'copied spell shown in extras');
    assert.match(out, /Mage Armor/, 'available (undrafted) spell in the pool');
    assert.match(out, /draggable="true"/, 'draggable spell cards');
    assert.match(out, /data-on-drop=/, 'drop zones for preparation');
  } finally { clearLocalStorage(); }
});

test('sheets: a prepared ritual spell is marked when the class can ritual-cast', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    // Wizard can ritual-cast; Detect Magic (prepared) has the Ritual tag → ⟳ marker.
    const out = renderBody(rec, { id: 'crit', name: 'Mage', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'wizard', level: 5, subclass: '' }],
      preparedSpells: { wizard: ['detect-magic', 'fireball'] } } } });
    assert.match(out, /Detect Magic/, 'the ritual spell is shown among prepared');
    assert.match(out, /⟳/, 'a ritual marker appears (Wizard can ritual-cast)');
  } finally { clearLocalStorage(); }
});

test('sheets: a Wizard prepares from the learned spellbook, not the full class list', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    // Wizard L5: only Mage Armor learned into the book; nothing prepared yet.
    const out = renderBody(rec, { id: 'cbk', name: 'Mage', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'wizard', level: 5, subclass: '' }], abilities: { INT: 16 },
      spellbook: { wizard: ['mage-armor'] } } } });
    assert.match(out, /Spellbook — 1 in book/, 'the spellbook group shows the learned-count');   // SP-5
    assert.match(out, /learn 14 free by level 5/, 'free-by-level allotment shown (6 + 2×4)');     // SP-5
    assert.match(out, /Learn a spell/, 'a learn-into-book pool is offered');
    // The prepared "Available" pool (the LAST such pool) draws ONLY from the book:
    // Mage Armor (learned) is offered to prepare; Fireball (a wizard spell NOT in
    // the book) is not — it appears only in the learn pool above.
    const prepPool = out.slice(out.lastIndexOf('drag into a slot (or click)'));
    assert.match(prepPool, /Mage Armor/, 'a learned spell is preparable');
    assert.doesNotMatch(prepPool, /Fireball/, 'a spell not in the book cannot be prepared');
    // A list-caster (Paladin) never gets a spellbook group.
    const pal = renderBody(rec, { id: 'cpal', name: 'Pal', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'paladin', level: 5, subclass: '' }], abilities: { CHA: 16 } } } });
    assert.doesNotMatch(pal, /in book/, 'a list-caster prepares from the class list — no spellbook');
  } finally { clearLocalStorage(); }
});

test('sheets: Spellbook management separates copy and other-source modes', () => {
  const char = { id: 'cmgr', name: 'Mage', addonData: { 'dnd-sheets': {
    classes: [{ classId: 'wizard', level: 5, subclass: '' }], abilities: { INT: 16 },
    currency: { gp: 500 },
    spellbook: { wizard: ['mage-armor'] },
    inventory: [{ id: 'sc1', name: 'Spell Scroll of Fireball', qty: 1, location: 'pack' }],
    spells: [{ id: 'x1', name: 'My Homebrew Bolt', level: 2, origin: 'other', sourceNote: 'from the DM', castWithSlots: true }],
  } } };
  const sorc = { id: 'cmgr2', name: 'Sorc', addonData: { 'dnd-sheets': {
    classes: [{ classId: 'sorcerer', level: 2, subclass: '' }], abilities: { CHA: 15 } } } };

  // Button gating (no modal open): Wizard shows BOTH add buttons; a list-caster only "another source".
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    const wiz = renderBody(rec, char);
    assert.match(wiz, /Copy from a spell scroll/, 'wizard shows the scroll-copy button');
    assert.match(wiz, /Add from another source/, 'wizard shows the other-source button');
    const so = renderBody(rec, sorc);
    assert.doesNotMatch(so, /Copy from a spell scroll/, 'a non-spellbook caster has no scroll-copy button');
    assert.match(so, /Add from another source/, 'but still has the other-source button');
  } finally { clearLocalStorage(); }

  // COPY mode — scroll + gp form (titles/costs are modal-only, so mode is unambiguous).
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    rec.actions.find(action => action.name === 'spellMgrOpen').fn('cmgr', 'copy');
    const out = renderBody(rec, char);
    assert.match(out, /Copy a spell into your Wizard spellbook/, 'copy modal title');
    assert.match(out, /Fireball — 150 gp/, 'a copyable spell shows its 50-gp-per-level cost');
    assert.match(out, /Spell Scroll of Fireball/, 'an inventory scroll is offered to consume');
    assert.match(out, /You have 500 gp/, 'current gold shown');
    assert.match(out, /Remove from spellbook/, 'copy mode manages book removal');
    assert.doesNotMatch(out, /Add a spell from another source/, 'copy mode is NOT the other-source modal');
  } finally { clearLocalStorage(); }

  // OTHER-SOURCE mode — homebrew form with the cast-with-slots option (SP-10).
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    rec.actions.find(action => action.name === 'spellMgrOpen').fn('cmgr', 'other');
    const out = renderBody(rec, char);
    assert.match(out, /Add a spell from another source/, 'other-source modal title');
    assert.match(out, /dse-custom-slots-cmgr/, 'a caster gets the "cast with spell slots" checkbox');
    assert.match(out, /Remove an added spell/, 'other mode manages the added-spell list');
    assert.match(out, /from the DM/, 'the added spell + its source note show');
    assert.doesNotMatch(out, /Copy a spell into your Wizard spellbook/, 'other mode is NOT the copy modal');
  } finally { clearLocalStorage(); }
});

test('sheets: scroll-copy offers only scrolls of the picked spell + never consumes a mismatch', () => {
  const blob = () => ({
    classes: [{ classId: 'wizard', level: 5, subclass: '' }], abilities: { INT: 16 }, currency: { gp: 500 },
    inventory: [
      { id: 'sc1', name: 'Spell Scroll of Fireball', qty: 1, location: 'pack' },
      { id: 'sc2', name: 'Scroll of Healing Word', qty: 1, location: 'pack' },
    ],
  });
  const char = { id: 'cscr', name: 'Mage', addonData: { 'dnd-sheets': blob() } };
  // Scope assertions to the copy modal's scroll-consume SELECT — the band's
  // generic equip picker legitimately lists every unplaced item (scrolls incl.),
  // so whole-page matching would false-positive on it.
  const scrollSelect = (out) => { const m = /<select[^>]*id="dse-copy-scroll-cscr"[\s\S]*?<\/select>/.exec(out); return m ? m[0] : ''; };
  // The consume selector must offer only the scroll for the chosen spell.
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    const act = (name, ...args) => rec.actions.find(action => action.name === name).fn(...args);
    act('spellMgrOpen', 'cscr', 'copy');
    act('spellCopyPick', 'cscr', 'fireball');
    const out = renderBody(rec, char);
    assert.match(scrollSelect(out), /Spell Scroll of Fireball/, 'the scroll holding the picked spell is offered');
    assert.doesNotMatch(scrollSelect(out), /Scroll of Healing Word/, 'a scroll of a DIFFERENT spell is never offered');
    assert.match(out, /spellCopyPick/, 'changing the picked spell re-filters (wired to spellCopyPick)');
  } finally { clearLocalStorage(); }
  // Picked spell = Detect Magic: no matching scroll → disabled message, wrong scrolls hidden.
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    const act = (name, ...args) => rec.actions.find(action => action.name === name).fn(...args);
    act('spellMgrOpen', 'cscr', 'copy');
    act('spellCopyPick', 'cscr', 'detect-magic');
    const out = renderBody(rec, char);
    assert.match(out, /No scroll of this spell/, 'a no-match state instead of wrong scrolls');
    assert.doesNotMatch(scrollSelect(out), /Scroll of Healing Word/, 'wrong scrolls stay hidden in the no-match state');
  } finally { clearLocalStorage(); }
  // Apply-time guard: a mismatched scroll id is NOT consumed (the copy still lands).
  const { host, rec } = mockHost(PHB());
  let stored = blob();
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  const withForm = (spell, scroll, fn) => {
    globalThis.document = { getElementById: (id) => (String(id).startsWith('dse-copy-spell') ? { value: spell } : String(id).startsWith('dse-copy-scroll') ? { value: scroll } : { value: '' }) };
    try { fn(); } finally { delete globalThis.document; }
  };
  withForm('fireball', 'sc2', () => act('spellCopy', 'cscr', 'wizard'));
  assert.ok(stored.spellbook.wizard.includes('fireball'), 'the copy itself lands');
  assert.equal(stored.currency.gp, 350, '150 gp charged (L3 × 50)');
  assert.ok(stored.inventory.some((it) => it.id === 'sc2'), 'the MISMATCHED scroll is not consumed');
  withForm('fireball', 'sc1', () => act('spellCopy', 'cscr', 'wizard'));
  assert.ok(!stored.inventory.some((it) => it.id === 'sc1'), 'the MATCHING scroll is consumed');
});

test('sheets: a Warlock shows Pact Magic in the Spellbook summary', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cwl', name: 'Lock', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'warlock', level: 5, subclass: '' }], abilities: { CHA: 16 } } } });
    assert.match(out, /Pact/, 'the Spellbook summary shows a Pact indicator');
  } finally { clearLocalStorage(); }
});

test('sheets: pact slots are a short-rest tracker resource', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cwlt', name: 'Lock', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'warlock', level: 5, subclass: '' }], abilities: { CHA: 16 } } } });
    assert.match(out, /Pact Slots/, 'pact slots listed as a tracker');
    assert.match(out, /short rest/, 'with a short-rest recharge label');
  } finally { clearLocalStorage(); }
});

test('sheets: Combat shows a read-only Features summary linked to the compendium', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cfs', name: 'Sorc', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'sorcerer', level: 2, subclass: '' }], abilities: { CHA: 15 } } } });
    assert.match(out, /Features/, 'a Features summary section is present');
    assert.match(out, /href="#\/compendium\/feature:sorcerer-metamagic"/, 'a feature links to its compendium page');
  } finally { clearLocalStorage(); }
});

test('sheets: a chosen ASI feat links to the compendium from the Builder', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'cfl', 'fighter');           // open the Fighter class tab
    act('builderToggleLevel', 'cfl', 'fighter:4');  // expand L4 (ASI) to reveal the feat picker
    const out = renderBody(rec, { id: 'cfl', name: 'Ftr', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 4, subclass: '' }], abilities: { STR: 15 },
      featureChoices: { 'asi:fighter:4': 'feat', 'asi:fighter:4:feat': 'great-weapon-master' } } } });
    assert.match(out, /href="#\/compendium\/feat:great-weapon-master"/, 'the chosen feat links to its compendium page');
  } finally { clearLocalStorage(); }
});

test('sheets: the class spine flags unresolved levels and summarizes choices', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    rec.actions.find((a) => a.name === 'builderTab').fn('cch', 'fighter');   // Fighter tab, nothing expanded
    // L4 is an ASI level. Unresolved → a soft "needs choices" flag; editor stays hidden (collapsed).
    const unset = renderBody(rec, { id: 'cch', name: 'Ftr', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 4, subclass: '' }], abilities: { STR: 15 } } } });
    assert.match(unset, /needs choices/, 'an unresolved ASI level is flagged');
    assert.doesNotMatch(unset, /asi:fighter:4:feat/, 'the editor is hidden while the row is collapsed');
    // Resolve it → the collapsed row summarizes the pick as a chip.
    const done = renderBody(rec, { id: 'cch', name: 'Ftr', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 4, subclass: 'eldritch-knight' }], abilities: { STR: 15 },
      featureChoices: { 'asi:fighter:4': 'feat', 'asi:fighter:4:feat': 'great-weapon-master' } } } });
    assert.match(done, /Great Weapon Master/, 'the made choice shows as a chip in the collapsed row');
  } finally { clearLocalStorage(); }
});

test('sheets: a class tab changes level and picks its subclass in the spine', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'clv', 'fighter');
    const char = { id: 'clv', name: 'Ftr', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 3, subclass: '' }], abilities: { STR: 15 } } } };
    const out = renderBody(rec, char);
    assert.match(out, /codex-stepper/, 'the class tab shows a level stepper (host .codex-stepper)');
    assert.match(out, /builderLevelSet/, 'the level stepper is wired to builderLevelSet');
    assert.match(out, /needs choices/, 'the subclass level flags an unset subclass');
    // Expand the subclass level → the subclass picker appears in the spine.
    act('builderToggleLevel', 'clv', 'fighter:3');
    const open = renderBody(rec, char);
    assert.match(open, /builderSubclassSet/, 'expanding the subclass level reveals the subclass picker');
    assert.match(open, /Eldritch Knight/, 'its subclass option is offered');
    assert.doesNotThrow(() => act('builderLevelSet', 'clv', 0, '4'), 'the level stepper does not throw');
  } finally { clearLocalStorage(); }
});

test('sheets: the Character tab manages compendium and free-text extra feats', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cxf', name: 'Hero', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 1, subclass: '' }], abilities: { STR: 15 },
      extraFeats: [{ id: 'x1', featId: 'tough', sourceNote: 'from a boon' }, { id: 'x2', name: 'Homebrew Luck', sourceNote: 'DM gift' }] } } });
    assert.match(out, /Extra feats/, 'the Extra feats section renders on the Character tab');
    assert.match(out, /href="#\/compendium\/feat:tough"/, 'a compendium extra feat links out');
    assert.match(out, /from a boon/, 'its source note shows');
    assert.match(out, /Homebrew Luck/, 'a free-text extra feat is tracked');
    assert.match(out, /builderExtraFeatAdd/, 'an add affordance is present');
    assert.match(out, /builderExtraFeatRemove/, 'each extra feat can be removed');
  } finally { clearLocalStorage(); }
});

test('sheets: an extra feat with a featId feeds the engine feats list', () => {
  const api = makeRulesApi(() => ({ apiVersion: 1, getItem: () => null, getItemByName: () => null }));
  const { host } = mockHost({});
  const { sheetOf } = makeHelpers(host);
  const E = makeEngine({ host, NS: 'dnd-sheets', ABILITIES, SKILLS, num, abilityMod, sheetOf });
  const s = sheetOf({ addonData: { 'dnd-sheets': {
    extraFeats: [{ id: 'x1', featId: 'tough' }, { id: 'x2', name: 'Homebrew Luck' }] } } });
  const cd = E.decisionsOf(s, api);
  assert.ok(cd.feats.some((f) => f.featId === 'tough'), 'a compendium extra feat is fed to the engine');
  assert.ok(!cd.feats.some((f) => f.featId == null), 'a free-text extra feat is not fed as a mechanical feat');
});

test('sheets: a recorded spell swap appears at its level in the class spine', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRun(PHB());
    rec.actions.find((a) => a.name === 'builderTab').fn('csw', 'wizard');   // open the Wizard class tab
    const out = renderBody(rec, { id: 'csw', name: 'Mage', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'wizard', level: 5, subclass: '' }], abilities: { INT: 15 },
      spellSwaps: [{ level: 3, classLevel: 3, classId: 'wizard', out: 'fireball', in: 'misty-step' }] } } });
    assert.match(out, /href="#\/compendium\/spell:fireball"/, 'the swapped-out spell links out (at its level)');
    assert.match(out, /href="#\/compendium\/spell:misty-step"/, 'the swapped-in spell links out');
  } finally { clearLocalStorage(); }
});

test('sheets: printSheet builds a self-contained print sheet', () => {
  const char = { id: 'cp', name: 'Gandalf', addonData: { 'dnd-sheets': {
    classes: [{ classId: 'wizard', level: 5, subclass: '' }], abilities: { INT: 16, DEX: 14, CON: 14 },
    preparedSpells: { wizard: ['fireball'] }, cantrips: { wizard: ['fire-bolt'] },
    inventory: [{ id: 'i1', name: 'Spellbook', qty: 1, location: 'pack' }], currency: { gp: 25 } } } };
  const { rec } = dryRun({ ...PHB(), fixtures: { characters: [char] } });
  let captured = '';
  globalThis.window = { open: () => ({ document: { open() {}, write(h) { captured = h; }, close() {} }, focus() {}, print() {} }) };
  try { rec.actions.find((a) => a.name === 'printSheet').fn('cp'); } finally { delete globalThis.window; }
  assert.match(captured, /<!doctype html>/i, 'a standalone HTML document (opens in a new window)');
  assert.match(captured, /<html lang="en">/, 'the document carries the scoped locale');
  assert.match(captured, /Gandalf/, 'the character name');
  assert.match(captured, /Ability Scores/, 'the abilities section');
  assert.match(captured, /Fireball/, 'a prepared spell is listed');
  assert.match(captured, /Fire Bolt/, 'a cantrip is listed');
  assert.match(captured, /Spellbook/, 'inventory is listed');
  assert.deepEqual(rec.i18nMissing, [], 'print labels all come from declared source keys');
});

test('sheets: exportSheet serializes the character to JSON', () => {
  const char = { id: 'ce', name: 'Frodo', addonData: { 'dnd-sheets': { className: 'Rogue', level: 3, abilities: { DEX: 16 } } } };
  const { rec } = dryRun({ ...PHB(), fixtures: { characters: [char] } });
  let captured = '';
  const oB = globalThis.Blob, oU = globalThis.URL, oD = globalThis.document;
  globalThis.Blob = function (parts) { captured = String((parts && parts[0]) || ''); };
  globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  globalThis.document = { createElement: () => ({ href: '', download: '', click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } };
  try { rec.actions.find((a) => a.name === 'exportSheet').fn('ce'); }
  finally { globalThis.Blob = oB; globalThis.URL = oU; globalThis.document = oD; }
  const parsed = JSON.parse(captured);
  assert.equal(parsed.format, 'dnd-sheets.character', 'export carries an explicit format');
  assert.equal(parsed.version, 1, 'export carries a transfer-schema version');
  assert.equal(parsed.sheet.className, 'Rogue', 'exported JSON carries the sheet data');
  assert.equal(parsed.sheet.abilities.DEX, 16, 'and the abilities');
});

test('sheets: the import modal renders a paste area', () => {
  mockLocalStorage('settings');
  try {
    const { rec } = dryRun(PHB());
    rec.actions.find(action => action.name === 'importOpen').fn('cim');
    const out = renderBody(rec, { id: 'cim', name: 'Sam', addonData: { 'dnd-sheets': { className: 'Fighter' } } });
    assert.match(out, /Import character/, 'the import modal title');
    assert.match(out, /type="file"/, 'the import modal offers a JSON file picker');
    assert.match(out, /dse-import-cim/, 'the paste textarea');
    assert.match(out, /importPreview/, 'the validation action');
  } finally { clearLocalStorage(); }
});

test('sheets: import validates, previews, confirms, and can undo without an early write', async () => {
  const original = {
    className: 'Fighter',
    level: 2,
    abilities: { STR: 15 },
  };
  const character = {
    id: 'c1',
    name: 'Hero',
    addonData: { 'dnd-sheets': original },
  };
  const { host, rec } = mockHost({
    ...PHB(),
    fixtures: { characters: [character] },
  });
  let stored = original;
  host.store.patchAddonData = (_collection, _id, update) => {
    stored = update(stored) || stored;
    return stored;
  };
  register(host);
  const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
  act('importOpen', 'c1');
  const raw = JSON.stringify({
    format: 'dnd-sheets.character',
    version: 1,
    sheet: { v: 2, className: 'Bard', level: 4, abilities: { CHA: 16 } },
  });
  globalThis.document = {
    getElementById: id => (
      id === 'dse-import-file-c1'
        ? { files: [] }
        : { value: raw }
    ),
  };
  try {
    await act('importPreview', 'c1');
    assert.equal(stored.className, 'Fighter', 'preview is read-only');
    const preview = renderBody(rec, character);
    assert.match(preview, /Validated import preview/);
    assert.match(preview, /Bard/);
    assert.match(preview, /importConfirm/);

    act('importConfirm', 'c1');
    assert.equal(stored.className, 'Bard');
    const complete = renderBody(rec, character);
    assert.match(complete, /Character sheet imported/);
    assert.match(complete, /importUndo/);

    act('importUndo', 'c1');
    assert.equal(stored.className, 'Fighter');
    assert.ok(rec.announces.includes('Character sheet imported.'));
    assert.ok(rec.announces.includes('Character sheet import undone.'));
  } finally {
    delete globalThis.document;
  }
});

test('sheets: invalid import remains open and cannot mutate the sheet', async () => {
  const character = {
    id: 'c1',
    name: 'Hero',
    addonData: { 'dnd-sheets': { className: 'Fighter' } },
  };
  const { host, rec } = mockHost({
    ...PHB(),
    fixtures: { characters: [character] },
  });
  let writes = 0;
  host.store.patchAddonData = () => { writes += 1; };
  register(host);
  const act = (name, ...args) => rec.actions
    .find(action => action.name === name).fn(...args);
  act('importOpen', 'c1');
  globalThis.document = {
    getElementById: id => (
      id === 'dse-import-file-c1'
        ? { files: [] }
        : { value: 'not valid json {{{' }
    ),
  };
  try {
    await act('importPreview', 'c1');
    act('importConfirm', 'c1');
    assert.equal(writes, 0);
    assert.match(renderBody(rec, character), /not valid JSON/);
  } finally {
    delete globalThis.document;
  }
});

test('sheets: recorded spell swaps show as linked history in the Spellbook', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'csw', name: 'Mage', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'wizard', level: 5, subclass: '' }],
      spellSwaps: [{ level: 3, classId: 'wizard', out: 'fireball', in: 'misty-step' }] } } });
    assert.match(out, /Swaps/, 'a swaps history section');
    assert.match(out, /href="#\/compendium\/spell:fireball"/, 'the swapped-out spell links to its page');
    assert.match(out, /href="#\/compendium\/spell:misty-step"/, 'the swapped-in spell links to its page');
    assert.match(out, /🔄/, 'a swap button is offered (edit mode)');
  } finally { clearLocalStorage(); }
});

test('sheets: spell-swap actions do not throw (open/close/apply/forget)', () => {
  const { rec } = dryRun(PHB());
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('spellSwapOpen', 'c1', 'wizard'));
  assert.doesNotThrow(() => act('spellSwapClose', 'c1'));
  assert.doesNotThrow(() => act('spellSwapApply', 'c1', 'wizard'));   // no DOM <select>s → safe no-op
  assert.doesNotThrow(() => act('spellSwapForget', 'c1', 0));
});

test('sheets: choose-grant picker renders a filtered pool + pick/unpick actions', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    // Acolyte's origin feat is Magic Initiate (choose 2 wizard cantrips + 1
    // level-1 spell) → pending choices surface pickers.
    const out = renderBody(rec, { id: 'cmi', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard', background: 'Acolyte' } } });
    assert.match(out, /Granted spell choices/, 'choices section header');
    assert.match(out, /Magic Initiate/, 'shows the grant source + count');
    assert.match(out, /<option value="fire-bolt">/, 'picker offers the matching level-0 wizard cantrip');
    assert.doesNotMatch(out, /<option value="fireball"/, 'a non-matching (level-3) spell is NOT an option in the cantrip picker');
  } finally { clearLocalStorage(); }
  const { rec } = dryRun(PHB());
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('grantPick', 'c1', 'feat:magic-initiate:mi-cantrips', 'fire-bolt'));
  assert.doesNotThrow(() => act('grantUnpick', 'c1', 'feat:magic-initiate:mi-cantrips', 'fire-bolt'));
});

test('sheets: spellbook prepare/cantrip/manager + drag-drop actions do not throw', () => {
  const { rec } = dryRun(PHB());
  const act = (name, ...args) => rec.actions.find(a => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('prepSpell', 'c1', 'wizard', 'fireball'));
  assert.doesNotThrow(() => act('learnCantrip', 'c1', 'wizard', 'fire-bolt'));
  assert.doesNotThrow(() => act('unprepSpell', 'c1', 'wizard', 'fireball'));
  // Wizard spellbook (SP-5): learn / forget into the book + drop-into-book.
  assert.doesNotThrow(() => act('spellbookLearn', 'c1', 'wizard', 'mage-armor'));
  assert.doesNotThrow(() => act('spellbookForget', 'c1', 'wizard', 'mage-armor'));
  const ev = { dataTransfer: { setData() {} } };
  assert.doesNotThrow(() => act('spellDragStart', ev, 'mage-armor'));
  assert.doesNotThrow(() => act('spellDrop', 'c1', 'wizard', 'prepared'));
  assert.doesNotThrow(() => act('spellDrop', 'c1', 'wizard', 'cantrip'));
  assert.doesNotThrow(() => act('spellDrop', 'c1', 'wizard', 'spellbook'));
  // Spellbook management popup actions. spellCopy reads form fields via the DOM →
  // stub document so the full getRules/getItem/cost path runs (not just the no-DOM
  // early-out). spellCustomAdd with no name is a safe no-op.
  assert.doesNotThrow(() => act('spellMgrOpen', 'c1', 'copy'));
  assert.doesNotThrow(() => act('spellMgrOpen', 'c1', 'other'));
  assert.doesNotThrow(() => act('spellMgrClose', 'c1'));
  globalThis.document = { getElementById: (id) => (String(id).startsWith('dse-copy-spell') ? { value: 'fireball' } : { value: '' }) };
  try {
    assert.doesNotThrow(() => act('spellCopy', 'c1', 'wizard'));
    assert.doesNotThrow(() => act('spellCustomAdd', 'c1'));
  } finally { delete globalThis.document; }
});

test('sheets: prepared picks over the limit stay visible + removable (never hidden)', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRun(PHB());
    // L1 Wizard (preparedLimit 4) holding 5 picks — e.g. after a level-down.
    // Every chip must render; the one past the cap gets the warning treatment.
    const out = renderBody(rec, { id: 'cov', name: 'Mage', addonData: { 'dnd-sheets': {
      className: 'Wizard', level: 1, abilities: {},
      spellbook: { wizard: ['mage-armor', 'detect-magic', 'fireball', 'bless', 'misty-step'] },
      preparedSpells: { wizard: ['mage-armor', 'detect-magic', 'fireball', 'bless', 'misty-step'] } } } });
    assert.match(out, /Over the prepared limit/, 'the over-cap chip carries the warning title');
    assert.equal((out.match(/"unprepSpell"/g) || []).length >= 5 || (out.match(/unprepSpell/g) || []).length >= 5, true,
      'all 5 picks keep their ✕ (removable), including those past the cap');
    assert.match(out, /Prepared 5\/4/, 'the summary counts every pick against the cap');
  } finally { clearLocalStorage(); }
});

test('sheets: spellDrop validates class list / level / capacity / book membership (no silent overfill)', () => {
  const { host, rec } = mockHost(PHB());
  let stored = { className: 'Wizard', level: 1, abilities: {} };
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  const drop = (ref, kind) => { act('spellDragStart', { dataTransfer: { setData() {} } }, ref); act('spellDrop', 'c1', 'wizard', kind); };
  drop('mage-armor', 'prepared');
  assert.equal((((stored.preparedSpells || {}).wizard) || []).length, 0, 'a spellbook caster cannot prepare a spell not in the book (SP-5)');
  drop('mage-armor', 'spellbook');
  assert.deepEqual(stored.spellbook.wizard, ['mage-armor'], 'learning into the book is a valid drop');
  drop('mage-armor', 'prepared');
  assert.deepEqual(stored.preparedSpells.wizard, ['mage-armor'], 'once learned, the prepare drop lands');
  drop('fire-bolt', 'prepared');
  assert.deepEqual(stored.preparedSpells.wizard, ['mage-armor'], 'a cantrip cannot be dropped into the prepared slots');
  drop('fireball', 'spellbook');
  assert.deepEqual(stored.spellbook.wizard, ['mage-armor'], 'an L3 spell above the L1 wizard cap is rejected');
  drop('bless', 'spellbook');
  assert.deepEqual(stored.spellbook.wizard, ['mage-armor'], 'a spell outside the class list is rejected');
  // Capacity: L1 wizard knows 3 cantrips — a 4th valid cantrip drop is rejected.
  stored.cantrips = { wizard: ['a', 'b', 'c'] };
  drop('fire-bolt', 'cantrip');
  assert.equal(stored.cantrips.wizard.length, 3, 'a cantrip drop past the known cap is rejected (no overfill)');
});

test('sheets: Combat tab shows engine-computed attacks from equipped weapons', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRun(PHB());
    // Real engine: Fighter STR 16 L1, proficient martial → +3 STR +2 PB = +5
    // (mirrors tests/rules.mjs EQ-3/4/5).
    const out = renderBody(rec, { id: 'ck', name: 'Knight', addonData: { 'dnd-sheets': {
      className: 'Fighter', abilities: { STR: 16 },
      inventory: [{ id: 'w1', ref: 'longsword', name: 'Longsword', location: 'equipped' }],
    } } });
    assert.match(out, /Attacks/, 'attacks block on the Combat tab');
    assert.match(out, /Longsword/, 'equipped weapon shown');
    assert.match(out, /\+5/, 'attack bonus (STR +3 + PB +2)');
    assert.match(out, /Sap/, 'weapon mastery property');
  } finally { clearLocalStorage(); }
});

test('sheets: Combat tab renders trackers; ± is a live-play control', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRun();
    const out = renderBody(rec, { id: 'ct', name: 'Brn', addonData: { 'dnd-sheets': { className: 'Barbarian', resources: [{ id: 'r1', name: 'Rage', current: 2, max: 3 }] } } });
    assert.match(out, /Trackers/, 'trackers section on the Combat tab');
    assert.match(out, /Rage/, 'the tracker is shown');
    assert.match(out, /resourceAdjust/, '± live-play control present');
  } finally { clearLocalStorage(); }
});

test('sheets: Combat tab auto-generates trackers + Rest button, with structured recharge', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRun(PHB());
    // Real engine: Barbarian L5 → Rage (pool, max 3), Insp (+1 on short rest /
    // full on long rest), d12 hit dice (mirrors tests/rules.mjs FE-2/FE-3).
    const out = renderBody(rec, { id: 'cr', name: 'Brn', addonData: { 'dnd-sheets': { className: 'Barbarian', level: 5 } } });
    assert.match(out, /Trackers/, 'trackers section on the Combat tab');
    assert.match(out, /Rage/, 'engine-built tracker name (from the build)');
    assert.match(out, /\+1 on short rest/, 'structured recharge label (amount + trigger)');
    assert.match(out, /full on long rest/, 'structured recharge label (full)');
    assert.match(out, /resourceUseAdjust/, '± live-play control');
    assert.match(out, /restOpen/, 'a Rest button');
    assert.doesNotMatch(out, /Add tracker/, 'no manual add button in engine mode');
  } finally { clearLocalStorage(); }
});

test('sheets: rest actions (open / spend hit die / short+long apply / close) do not throw', () => {
  const { rec } = dryRun(PHB());
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('restOpen', 'c1'));
  assert.doesNotThrow(() => act('restSpendHitDie', 'c1', 'hit-dice-d12'));
  assert.doesNotThrow(() => act('restApply', 'c1', 'short'));
  assert.doesNotThrow(() => act('restApply', 'c1', 'long'));
  assert.doesNotThrow(() => act('restClose', 'c1'));
});

test('sheets: overrides.maxHp governs every HP clamp and the rest heal', () => {
  const { host, rec } = mockHost(PHB());
  // Engine-built L5 Wizard (computed max 32, mirrors tests/rules.mjs) with a DM
  // override of 50 — the override must be the clamp everywhere the tile shows it.
  let stored = { className: 'Wizard', level: 5, abilities: { CON: 14 }, hp: 10, maxHp: 32, overrides: { maxHp: 50 } };
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  act('setField', 'c1', 'hp', '40');
  assert.equal(stored.hp, 40, 'typed HP above the computed max (32) survives — the override (50) is the clamp');
  act('setField', 'c1', 'hp', '99');
  assert.equal(stored.hp, 50, 'the direct HP stepper clamps at the overridden max, not the computed one');
  act('restApply', 'c1', 'long');
  assert.equal(stored.hp, 50, 'long rest heals to the overridden max');
  act('setField', 'c1', 'hp', '20');
  act('clearOverride', 'c1', 'maxHp');
  act('setField', 'c1', 'hp', '99');
  assert.equal(stored.hp, 32, 'override cleared → the computed/materialized max clamps again');
});

test('sheets: pure HP changes absorb temporary HP and clamp damage/healing', () => {
  const original = { hp: 10, tempHp: 5 };
  const damaged = applyHpChange(original, -8, 20, num, clampHp);
  assert.deepEqual(original, { hp: 10, tempHp: 5 }, 'the helper does not mutate its input');
  assert.deepEqual(damaged, { hp: 7, tempHp: 0 }, 'temporary HP absorbs damage before regular HP');
  assert.deepEqual(applyHpChange(damaged, -99, 20, num, clampHp), { hp: 0, tempHp: 0 }, 'damage bottoms out at zero');
  assert.deepEqual(applyHpChange({ hp: 18, tempHp: 3 }, 99, 20, num, clampHp), { hp: 20, tempHp: 3 }, 'healing clamps at max and preserves temporary HP');
});

test('sheets: equipment — free-form Worn slots + strict Attunement, de-duped from the pack', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cb2', name: 'Knight', addonData: { 'dnd-sheets': { className: 'Fighter', inventory: [
      { id: 'i1', ref: 'leather', name: 'Leather Armor', kind: 'armor', location: 'equipped' },
      { id: 'i2', name: 'Ring of Protection', kind: 'magic-item', location: 'pack', attuned: true },
      { id: 'i3', name: 'Rope', qty: 1, location: 'pack' },
      { id: 'i4', name: 'Goggles of Night', kind: 'magic-item', location: 'equipped' },
    ] } } });
    // Worn: Armor + Shield are the recommended anchors; ANY equipped item gets a slot.
    assert.match(out, /Worn/, 'a Worn group');
    assert.match(out, /dse-slot-tag">Armor</, 'the recommended Armor anchor');
    assert.match(out, /dse-slot-tag">Shield</, 'the recommended Shield anchor');
    assert.match(out, /Leather Armor/, 'the equipped armor fills its anchor');
    assert.match(out, /Goggles of Night/, 'a non-armor equipped item gets its own worn slot');
    assert.match(out, /"cb2","any","\$value"/, 'a generic take-anything picker is offered (slotEquip · any)');
    // Attunement stays strict: only the attuned item lands there; count vs limit.
    assert.match(out, /Attunement/, 'an Attunement group');
    assert.match(out, /Ring of Protection/, 'the attuned item fills an Attunement slot');
    assert.match(out, /1 \/ 3/, 'the attunement count (1 of 3)');
    // Adding is via the wizard; the old inline pickers are gone.
    assert.match(out, /addItemOpen/, 'the ＋ Add item button opens the wizard');
    assert.doesNotMatch(out, /Weapon…|Armor…/, 'no old inline pickers');
    // De-dup: band-slot items are shown once (in the band), never repeated as an
    // editable pack row. Rope (not equipped, not attuned) stays in the pack.
    assert.match(out, /value="Rope"/, 'a non-equipped, non-attuned item stays in the pack');
    assert.doesNotMatch(out, /value="Ring of Protection"/, 'the attuned item is not repeated as a pack row');
    assert.doesNotMatch(out, /value="Leather Armor"/, 'the equipped armor is not repeated as a pack row');
    assert.doesNotMatch(out, /value="Goggles of Night"/, 'a generic worn item is not repeated as a pack row');
  } finally { clearLocalStorage(); }
});

test('sheets: COMPACT layout docks Init / passive / DC / Atk onto the ability cards', () => {
  // Deliberately the LEGACY global key (no per-sheet 'dse-ui:layout:cc') — a
  // pre-per-sheet 'compact' choice must carry over via uiLayout's fallback.
  mapLocalStorage({ 'dse-tab:cc': 'stats', 'dse-ui:layout': 'compact' });
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cc', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard', abilities: { DEX: 14 } } } });
    // Docked chips: Initiative on DEX, passive on WIS, Save DC / Spell Atk on
    // the caster card (accent ring only — no "caster" text).
    assert.match(out, /dse-dock">⚡ Init <strong>\+2</, 'Initiative docks onto the DEX card');
    assert.match(out, /dse-dock">👁 Passive <strong>10</, 'passive Perception docks onto the WIS title row');
    // The title-row chips sit in the centring slot (equal gaps name↔chip↔shield).
    assert.match(out, /dse-dock-slot"><span class="codex-tip[^>]*><span class="dse-dock">⚡ Init/, 'the Init chip rides the centred dock slot');
    assert.doesNotMatch(out, /✦ caster/, 'no "caster" text — the gold ring alone marks the card');
    // DC + Atk share ONE merged chip (a dot between two hover zones) so the
    // pair never wraps to two lines at full size.
    assert.match(out, /Save DC <strong>10</, 'Save DC docks onto the casting ability (8+PB2+INT0)');
    assert.match(out, /Spell Atk <strong>\+2</, 'Spell Attack docks beside it');
    assert.match(out, /dse-dock-sep/, 'DC and Atk are merged into a single chip');
    assert.doesNotMatch(out, /passive 10</, 'the old inline passive on the Perception row is gone');
    // The band sheds the docked tiles — only Speed remains beside HP/AC.
    assert.doesNotMatch(out, /class="codex-tile-label">Pass\. Perc\.</, 'no Passive tile in the band');
    assert.doesNotMatch(out, /class="codex-tile-label">Save DC</, 'no Save DC tile in the band');
    assert.doesNotMatch(out, /class="codex-tile-label">Spell Attack</, 'no Spell Attack tile in the band');
    assert.match(out, /class="codex-tile-label">Speed</, 'Speed keeps its tile');
  } finally { clearLocalStorage(); }
});

test('sheets: ⚙ Settings tab — per-sheet layout switch + the print/export/import tools', () => {
  const ls = mapLocalStorage({ 'dse-tab:cs': 'settings' });
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cs', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard' } } });
    assert.match(out, /name="dse-layout-cs"/, 'layout radios render on the sheet\'s own tab');
    assert.match(out, /value="classic"[^>]*checked/, 'classic is the default');
    assert.match(out, /uiLayoutSet/, 'radios wire to the uiLayoutSet action');
    // The old toolbar row is gone; Print / Export / Import moved onto this tab.
    assert.match(out, /printSheet/, 'Print lives on the tab');
    assert.match(out, /exportSheet/, 'Export lives on the tab');
    assert.match(out, /importOpen/, 'Import lives on the tab (editor)');
    const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
    act('uiLayoutSet', 'cs', 'compact');
    assert.equal(ls.get('dse-ui:layout:cs'), 'compact', 'compact persists PER SHEET');
    act('uiLayoutSet', 'cs', 'classic');
    assert.equal(ls.get('dse-ui:layout:cs'), 'classic', 'classic is stored explicitly (beats the legacy global fallback)');
  } finally { clearLocalStorage(); }
});

test('sheets: provider return keeps changed materialized values manual until resolved', () => {
  mockLocalStorage('settings');
  try {
    const sheet = {
      ...FIGHTER.addonData['dnd-sheets'],
      abilities: { ...FIGHTER.addonData['dnd-sheets'].abilities },
    };
    captureProviderState(sheet, '2024');
    sheet.abilities.STR = 18;
    const character = {
      ...FIGHTER,
      addonData: { 'dnd-sheets': sheet },
    };
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, character);
    assert.match(out, /Values that were previously computed changed/);
    assert.match(out, /Keep manual values/);
    assert.match(out, /Resume rulebook values/);
    assert.doesNotMatch(out, /dse-tab-c1-builder/, 'Builder stays inactive before the decision');
  } finally {
    clearLocalStorage();
  }
});

test('sheets: provider reconciliation can preserve manual mode or explicitly resume computation', () => {
  const sheet = {
    ...FIGHTER.addonData['dnd-sheets'],
    abilities: { ...FIGHTER.addonData['dnd-sheets'].abilities },
  };
  captureProviderState(sheet, '2024');
  sheet.ac = 21;
  let stored = sheet;
  const character = {
    ...FIGHTER,
    addonData: { 'dnd-sheets': stored },
  };
  const { host, rec } = mockHost({
    ...PHB(),
    fixtures: { characters: [character] },
  });
  host.store.patchAddonData = (_collection, _id, update) => {
    stored = update(stored) || stored;
    return stored;
  };
  register(host);
  const resolve = rec.actions
    .find(action => action.name === 'providerResolve').fn;

  resolve('c1', 'manual');
  assert.equal(stored.rulesMode, 'manual');
  assert.equal(stored.ac, 21, 'manual choice preserves the changed value');

  resolve('c1', 'builder');
  assert.equal(stored.rulesMode, 'auto');
  assert.ok(stored.rulesProvider?.materialized);
  assert.notEqual(stored.ac, 21, 'builder choice explicitly rematerializes');
  assert.equal(
    stored.rulesProvider.materialized.ac,
    stored.ac,
    'the new computed baseline is recorded',
  );
});

test('sheets: the first edit during a provider outage captures the pre-edit baseline', () => {
  let provider = null;
  let stored = {
    ruleset: '2024',
    className: 'Fighter',
    level: 3,
    classes: [{ classId: 'fighter', level: 3, subclass: '' }],
    baseStats: { STR: 15, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 8 },
    abilities: { STR: 15, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 8 },
    ac: 16,
  };
  const host = {
    id: 'dnd-sheets',
    use: () => provider,
    store: {
      patchAddonData(_collection, _id, update) {
        stored = update(stored) || stored;
      },
    },
    ui: { rerender() {} },
  };
  const { sheetOf } = makeHelpers(host);
  const model = makeEngine({
    host,
    NS: 'dnd-sheets',
    ABILITIES,
    SKILLS,
    num,
    abilityMod,
    clampHp,
    sheetOf,
  });

  model.mutate('c1', sheet => {
    sheet.ac = 19;
    return sheet;
  });
  assert.equal(stored.rulesProvider.materialized.ac, 16);

  provider = makeFake();
  assert.deepEqual(model.providerState(stored), {
    status: 'reconcile',
    reason: 'manual',
    changed: ['ac'],
    providerId: 'dnd55e-compendium',
    edition: '2024',
    engine: null,
  });
});

test('sheets: toolbar gone from the sheet body — Print/Export ride the ⚙ tab only', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun();
    const out = renderBody(rec, FIGHTER);
    assert.doesNotMatch(out, /printSheet/, 'no Print button above the tab strip');
    assert.match(out, /⚙️/, 'the Settings tab is offered (standalone + anonymous too)');
  } finally { clearLocalStorage(); }
});

test('sheets: currency renders as ONE line pinned under the whole Backpack split', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun();
    const out = renderBody(rec, { ...FIGHTER, addonData: { 'dnd-sheets': { ...FIGHTER.addonData['dnd-sheets'], currency: { gp: 10 } } } });
    const body = out.slice(out.indexOf('</style>'));   // skip the CSS (class names appear there too)
    const split = body.indexOf('dse-bp-split');
    const coins = body.indexOf('dse-bp-coins');
    assert.ok(split >= 0 && coins > split, 'the coin line sits below the two-column split');
    assert.match(body, /dse-coin-lbl">GP<\/span>/, 'coins are inline label+value pairs');
  } finally { clearLocalStorage(); }
});

test('sheets: empty equipment slots render click-to-fill pickers (editor)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'ce', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard', inventory: [
      { id: 'p1', ref: 'leather', name: 'Leather Armor', kind: 'armor', location: 'pack' },   // owned, not worn
      { id: 'p2', name: 'Cloak of Protection', kind: 'magic-item', location: 'pack' },          // owned, not attuned
    ] } } });
    assert.match(out, /dse-slot-pick/, 'an empty slot renders a picker select');
    assert.match(out, /slotEquip/, 'the Armor picker equips the owned armor (slotEquip)');
    assert.match(out, /slotAttune/, 'the Attunement picker attunes an item (slotAttune)');
    assert.match(out, /Cloak of Protection/, 'an attunable magic item is offered in the attune picker');
  } finally { clearLocalStorage(); }
});

test('sheets: equipment slot actions (equip / attune / clear) mutate without throwing', () => {
  const { host, rec } = mockHost(PHB());
  let stored = { inventory: [{ id: 'x1', ref: 'leather', name: 'Leather Armor', kind: 'armor', location: 'pack' }, { id: 'x2', name: 'Amulet', kind: 'magic-item', location: 'pack' }] };
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  act('slotEquip', 'cX', 'armor', 'x1');
  assert.equal(stored.inventory.find((i) => i.id === 'x1').location, 'equipped', 'equip sets the armor equipped');
  // The generic slot equips ANYTHING and never bumps the anchors' occupants.
  act('slotEquip', 'cX', 'any', 'x2');
  assert.equal(stored.inventory.find((i) => i.id === 'x2').location, 'equipped', 'the generic slot equips a non-armor item');
  assert.equal(stored.inventory.find((i) => i.id === 'x1').location, 'equipped', 'an "any" equip does not bump the worn armor');
  act('slotUnequip', 'cX', 'x2');
  act('slotUnequip', 'cX', 'x1');
  assert.equal(stored.inventory.find((i) => i.id === 'x1').location, 'pack', 'unequip returns it to the pack');
  act('slotAttune', 'cX', 'x2');
  assert.equal(stored.inventory.find((i) => i.id === 'x2').attuned, true, 'attune flags the item');
  act('slotUnattune', 'cX', 'x2');
  assert.equal(stored.inventory.find((i) => i.id === 'x2').attuned, false, 'unattune clears the flag');
});

test('sheets: Backpack tab retired — no backpack tab button, content in Character Sheet (UI polish)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'cbp', name: 'Knight', addonData: { 'dnd-sheets': { className: 'Fighter', inventory: [{ id: 'i1', name: 'Rope', qty: 1, location: 'pack' }] } } });
    assert.doesNotMatch(out, /:tab" data-args='\["[^"]*","backpack"\]/, 'no standalone Backpack tab button');
    assert.match(out, /Rope/, 'inventory renders inside the Character Sheet tab');
  } finally { clearLocalStorage(); }
});

test('sheets: Combat attacks link the weapon to the compendium', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRun(PHB());
    const out = renderBody(rec, { id: 'catk', name: 'Knight', addonData: { 'dnd-sheets': {
      classes: [{ classId: 'fighter', level: 1, subclass: '' }], abilities: { STR: 16 },
      inventory: [{ id: 'i1', ref: 'longsword', name: 'Longsword', location: 'equipped' }] } } });
    assert.match(out, /href="#\/compendium\/weapon:longsword"/, 'equipped weapon links to its compendium page');
  } finally { clearLocalStorage(); }
});

test('sheets: header class and subclass link to the compendium', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRun(PHB());
    // The flat `subclass` deliberately carries the ID here — that's what every
    // blob materialized BEFORE the name fix contains. The header must resolve
    // it (id-first lookup) and display the record's NAME, never the slug.
    const out = renderBody(rec, { id: 'chd', name: 'Knight', addonData: { 'dnd-sheets': {
      className: 'Fighter', subclass: 'eldritch-knight', level: 3,
      classes: [{ classId: 'fighter', level: 3, subclass: 'eldritch-knight' }], abilities: { STR: 15 } } } });
    assert.match(out, /href="#\/compendium\/class:fighter"/, 'header class name links to its compendium page');
    assert.match(out, /href="#\/compendium\/subclass:eldritch-knight"/, 'header subclass name links to its compendium page');
    assert.match(out, /\(<[^>]*>Eldritch Knight<\/a>\)/, 'a legacy id-valued blob still displays the resolved subclass NAME');
  } finally { clearLocalStorage(); }
});

test('sheets: materialize stores the subclass name in the flat fallback while the id stays in classes[]', () => {
  const { host, rec } = mockHost(PHB());
  let stored = { classes: [{ classId: 'fighter', level: 3, subclass: '' }], abilities: {} };
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  act('builderSubclassSet', 'c1', 0, 'eldritch-knight');
  assert.equal(stored.subclass, 'Eldritch Knight', 'the flat fallback holds the resolved NAME (readable standalone)');
  assert.equal(stored.classes[0].subclass, 'eldritch-knight', 'the decision model keeps the id');
  assert.equal(stored.className, 'Fighter', 'class fallback stays the resolved name');
});

test('sheets: materialize writes the spell snapshot and joined multiclass class line', () => {
  const { host, rec } = mockHost(PHB());
  let stored = {
    classes: [{ classId: 'wizard', level: 5, subclass: '' }, { classId: 'fighter', level: 2, subclass: '' }],
    abilities: {}, cantrips: { wizard: ['fire-bolt'] }, preparedSpells: { wizard: ['mage-armor'] },
    spells: [{ id: 'x1', name: 'My Homebrew Bolt', level: 2, origin: 'other' }],
  };
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  act('builderAbility', 'c1', 'STR', '15');   // any Builder edit re-materializes
  assert.equal(stored.className, 'Wizard 5 / Fighter 2', 'the WHOLE multiclass build survives in the flat class line');
  assert.equal(stored.level, 7, 'flat level = total level');
  const snaps = stored.spells.filter((sp) => sp.origin === 'snapshot');
  assert.deepEqual(snaps.map((sp) => sp.name).sort(), ['Fire Bolt', 'Mage Armor'], 'the loadout snapshot is NAME-resolved (readable without the book)');
  assert.ok(snaps.every((sp) => sp.sourceNote === 'Wizard'), 'snapshot entries carry the granting class as their note');
  assert.ok(stored.spells.some((sp) => sp.name === 'My Homebrew Bolt'), 'user-added entries survive the snapshot rewrite');
  act('builderAbility', 'c1', 'STR', '14');
  assert.equal(stored.spells.filter((sp) => sp.origin === 'snapshot').length, 2, 'snapshots are replaced wholesale, never accumulate');
});

test('sheets: materialized expertise keeps doubled proficiency in standalone mode', () => {
  const { host, rec } = mockHost(PHB());
  let stored = {
    classes: [{ classId: 'rogue', level: 1, subclass: '' }],
    abilities: { DEX: 14 },
    featureChoices: { 'skills:rogue#0': 'stealth', 'rogue-expertise-1#0': 'stealth' },
  };
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  act('builderAbility', 'c1', 'STR', '10');   // any Builder edit re-materializes
  assert.equal(stored.skillProf.stealth, true, 'proficiency materialized');
  assert.equal(stored.skillExpertise.stealth, true, 'EXPERTISE materialized into the flat fallback');
  // The standalone viewModel applies it: DEX +2 + 2×PB(2) = +6 — the same total
  // the engine computed, not silently PB lower.
  const { viewModel } = makeEngine({ num, abilityMod, host: {}, NS: 'x', ABILITIES, SKILLS, sheetOf: () => ({}) });
  const vm = viewModel({ profBonus: 2, abilities: { DEX: 14 }, saveProf: {}, skillProf: { stealth: true }, skillExpertise: { stealth: true } }, null);
  assert.equal(vm.skill('stealth', 'DEX').total, 6, 'standalone stealth total keeps the doubled PB');
  assert.equal(vm.skill('stealth', 'DEX').exp, true, 'reported as expertise (the mastery ring renders)');
  assert.equal(vm.skill('perception', 'WIS').total, 0, 'non-proficient skills unaffected');
});

test('sheets: the spell snapshot renders standalone (book removed) and hides in engine mode', () => {
  const blob = { className: 'Wizard', level: 5, abilities: {},
    spells: [{ id: 'snap:mage-armor', ref: 'mage-armor', name: 'Mage Armor', level: 1, school: 'Abjuration', prepared: true, origin: 'snapshot', sourceNote: 'Wizard' }] };
  mockLocalStorage('spellbook');
  try {
    // In standalone mode, the materialized snapshot is the visible spellbook.
    const { rec } = dryRun();
    const out = renderBody(rec, { id: 'cs1', name: 'Mage', addonData: { 'dnd-sheets': blob } });
    assert.match(out, /Mage Armor/, 'the snapshot spell stays visible after engine/book removal');
    assert.match(out, /📌/, 'marked as the engine-loadout snapshot');
    // Engine mode: the live prep UI owns the loadout — the Extra group hides snapshots.
    const { rec: rec2 } = dryRun(PHB());
    const out2 = renderBody(rec2, { id: 'cs2', name: 'Mage', addonData: { 'dnd-sheets': blob } });
    assert.doesNotMatch(out2, /📌/, 'engine mode never shows snapshot entries as Extra spells');
  } finally { clearLocalStorage(); }
});

test('sheets: Backpack add-item + attune actions do not throw', () => {
  mapLocalStorage({});
  try {
  const { rec } = dryRun(PHB());
  const act = (name, ...args) => rec.actions.find(a => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('addItemStage', 'c1', 'weapon', 'longsword'));
  assert.doesNotThrow(() => act('addItemStage', 'c1', 'armor', 'leather'));
  assert.doesNotThrow(() => act('addItemCommit', 'c1'));
  assert.doesNotThrow(() => act('invAttune', 'c1', 'someid'));
  } finally { clearLocalStorage(); }
});

function mapLocalStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  const storage = {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => m.set(String(k), String(v)),
    removeItem: (k) => m.delete(String(k)),
  };
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage };
  return m;
}

test('sheets: add-item wizard — search box, category tree, batch tray with typed quantity', () => {
  mapLocalStorage({ 'dse-tab:cw': 'stats' });
  try {
    const { rec } = dryRun(PHB());
    const act = (name, ...args) => rec.actions.find(action => action.name === name).fn(...args);
    const char = { id: 'cw', name: 'Mage', addonData: { 'dnd-sheets': { className: 'Wizard' } } };
    act('addItemOpen', 'cw');
    const out = renderBody(rec, char);
    assert.match(out, /Add to Backpack/, 'the wizard overlay is open');
    assert.match(out, /Search all items/, 'a search box');
    assert.match(out, /dse-aiw-folder[^>]*>[\s\S]*?Weapons/, 'a drill-down category (Weapons)');
    assert.match(out, /Magic Items/, 'a drill-down category (Magic Items)');
    assert.match(out, /Nothing selected yet/, 'the batch tray starts empty');
    assert.match(out, /addItemStageCustom/, 'a custom-item field is offered');
    // With items staged, the tray shows each with a quantity stepper + a commit total.
    act('addItemStage', 'cw', 'weapon', 'dagger');
    act('addItemQty', 'cw', 'weapon:dagger', 2);
    const out2 = renderBody(rec, char);
    assert.match(out2, /Dagger/, 'a staged item shows in the tray');
    assert.match(out2, /codex-stepper/, 'each staged item gets a quantity stepper (type the count)');
    assert.match(out2, /addItemQty/, 'the stepper writes the quantity');
    assert.match(out2, /Add 2</, 'the commit button totals the staged quantities');
  } finally { clearLocalStorage(); }
});

test('sheets: add-item wizard stages with a quantity + commits the batch to the pack', () => {
  mapLocalStorage({});
  try {
    const { host, rec } = mockHost(PHB());
    let stored = {};
    host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd-sheets': stored } }; };
    register(host);
    const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
    // Stage a weapon, bump its quantity, then commit the whole tray at once.
    act('addItemStage', 'cX', 'weapon', 'longsword');
    act('addItemQty', 'cX', 'weapon:longsword', 3);
    assert.doesNotThrow(() => act('addItemNav', 'cX', 'weapon/martial'));
    assert.doesNotThrow(() => act('addItemSearch', 'cX'));    // no document → harmless no-op
    act('addItemCommit', 'cX');
    assert.equal(stored.inventory.length, 1, 'one line committed');
    assert.equal(stored.inventory[0].name, 'Longsword', 'the ref resolved to a name');
    assert.equal(stored.inventory[0].qty, 3, 'the typed quantity carried through');
    assert.equal(stored.inventory[0].kind, 'weapon', 'the kind rides along');
    assert.equal(stored.inventory[0].ref, 'longsword');
    assert.equal(stored.inventory[0].location, 'ready', 'a weapon lands in Ready');
    const after = renderBody(rec, { id: 'cX', name: 'Fighter', addonData: { 'dnd-sheets': stored } });
    assert.doesNotMatch(after, /Add to Backpack/, 'commit closes and clears the wizard');
  } finally { clearLocalStorage(); }
});

test('sheets: internal inventory helper stores item kind; free-text armor resolves by name', () => {
  const stored = addInventoryItems({}, [{ kind: 'armor', ref: 'leather', name: 'Leather Armor', qty: 1 }], {
    uid: () => 'item-1',
    num,
    location: () => 'equipped',
  });
  assert.equal(stored.inventory[0].kind, 'armor', 'the kind rides beside the ref — no cross-kind probing needed');
  assert.equal(stored.inventory[0].ref, 'leather');
  // A hand-typed armor NAME now links too (the by-name fallback probes both
  // kinds) — links show on the read view, so render as an anonymous viewer.
  mockLocalStorage('stats');
  try {
    const { rec: rec2 } = dryRun({ ...PHB(), isAnonymous: true });
    const out = renderBody(rec2, { id: 'cit', name: 'Knight', addonData: { 'dnd-sheets': {
      className: 'Fighter', inventory: [{ id: 'i1', name: 'Leather Armor', qty: 1, location: 'pack' }] } } });
    assert.match(out, /href="#\/compendium\/armor:leather"/, 'free-text armor resolves to its compendium page');
  } finally { clearLocalStorage(); }
});

test('sheets: resource tracker actions mutate without throwing', () => {
  const { rec } = dryRun();
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('resourceAdd', 'c1'));
  assert.doesNotThrow(() => act('resourceSet', 'c1', 'x', 'name', 'Rage'));
  assert.doesNotThrow(() => act('resourceSet', 'c1', 'x', 'max', '3'));
  assert.doesNotThrow(() => act('resourceAdjust', 'c1', 'x', -1));
  assert.doesNotThrow(() => act('resourceDel', 'c1', 'x'));
});

test('sheets: proficiency dots are direct toggles for editors (standalone)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRun();
    const out = renderBody(rec, { id: 'pv', name: 'Rgr', addonData: { 'dnd-sheets': { className: 'Ranger' } } });
    assert.match(out, /toggleSkill/, 'skill dots toggle directly (editor)');
    assert.match(out, /toggleSave/, 'save dots toggle directly (editor)');
  } finally { clearLocalStorage(); }
});

test('sheets: no Spellbook tab for a non-caster with no spells (engine mode)', () => {
  const { rec } = dryRun(PHB());
  const out = renderBody(rec, { id: 'cf', name: 'Brute', addonData: { 'dnd-sheets': { className: 'Fighter' } } });
  assert.doesNotMatch(out, /Spellbook/, 'spellbook tab hidden for a non-caster');
});

test('sheets: unload clears domain timers and a reload registers one clean action set', async () => {
  const originalTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;
  let nextTimer = 1;
  const scheduled = [];
  const cleared = [];
  globalThis.setTimeout = (_fn, delay) => {
    const id = nextTimer++;
    scheduled.push({ id, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => { cleared.push(id); };
  globalThis.document = {
    getElementById: () => ({ focus() {} }),
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild() {} },
  };
  globalThis.URL = {
    createObjectURL: () => 'blob:download-test',
    revokeObjectURL() {},
  };
  mockLocalStorage('overview');
  try {
    const run = dryRun({ ...PHB(), fixtures: { characters: [FIGHTER] } });
    const act = (name, ...args) => run.rec.actions.find((action) => action.name === name).fn(...args);
    act('tabKey', { key: 'ArrowRight', preventDefault() {} }, 'c1', 'overview');
    act('builderTabKey', { key: 'ArrowRight', preventDefault() {} }, 'c1', 'character');
    act('exportSheet', 'c1');
    assert.ok(scheduled.length >= 2, 'multiple domain-owned timers were scheduled');

    await run.dispose();
    assert.equal(run.rec.actions.length, 0, 'the host removes every action registration on unload');
    assert.deepEqual(cleared.slice().sort(), scheduled.map((timer) => timer.id).sort(), 'domain disposers clear every pending timer');

    const reload = dryRun(PHB());
    assert.deepEqual(reload.rec.actions.map((action) => action.name).sort(), RETAINED_ACTIONS, 'reload registers one fresh retained action set');
    await reload.dispose();
  } finally {
    clearLocalStorage();
    globalThis.setTimeout = originalTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
  }
});

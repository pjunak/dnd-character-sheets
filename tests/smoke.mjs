// Client self-test for dnd55e-sheets, run against the host's published test
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
// fake BOOK DATA as deps['dnd55e-players-handbook'] (tests/fake-phb.mjs, shared
// with tests/rules.mjs), so the real engine computes over it. Expected numbers
// below therefore mirror the engine-pinned values in tests/rules.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dryRunRegister, smokeRegistrations, createMockHost } from '../../ttrpg-codex/web/js/addon-test-harness.mjs';
import register from '../entry.js';
import { makeFake } from './fake-phb.mjs';
import { makeEngine } from '../model.js';
import { makeRulesApi } from '../rules/api.js';
import { makeHelpers, ABILITIES, SKILLS, num, abilityMod } from '../helpers.js';

function mockLocalStorage(tab) {
  globalThis.localStorage = {
    getItem: (k) => (String(k).startsWith('dse-tab:') ? (tab || null) : null),
    setItem() {}, removeItem() {},
  };
}
function clearLocalStorage() { delete globalThis.localStorage; }

// Invoke the body-fragment render (the whole sheet). `lore` stands in for the
// host's rendered description; defaults to a marked block so the Overview tab can
// be asserted to pass it through.
function renderBody(rec, char, lore) {
  const frag = rec.fragmentOps.find((f) => f.target === 'characters:body');
  const html = lore != null ? lore : '<div class="md-view"><p>LORE_BODY</p></div>';
  return frag.spec.render(html, { entity: char, kind: 'characters', target: 'characters:body' });
}

const META = {
  id: 'dnd55e-sheets',
  permissions: ['ui:override', 'ui:action', 'ui:settings-tab', 'data:read:characters', 'data:write:characters.addonData'],
  optionalDependencies: { 'dnd55e-players-handbook': { range: '>=0.1.0' } },
};

// Book data present → the built-in engine computes (fresh fake per test).
const PHB = () => ({ deps: { 'dnd55e-players-handbook': makeFake() } });

const FIGHTER = {
  id: 'c1', name: 'Thorin',
  addonData: { 'dnd55e-sheets': {
    className: 'Fighter', level: 5, profBonus: 3,
    abilities: { STR: 16, DEX: 12, CON: 15, INT: 10, WIS: 13, CHA: 8 },
    maxHp: 44, hp: 40, ac: 18, saveProf: { STR: true, CON: true },
    skillProf: { athletics: true, perception: true },
  } },
};

test('sheets: register is clean + wires the expected surface', () => {
  const { ok, rec, error } = dryRunRegister(register, META);
  assert.ok(ok, error);
  assert.ok(rec.fragmentOps.some(f => f.target === 'characters:body' && f.spec.op === 'replace'), 'replaces the character body fragment');
  assert.ok(rec.actions.some(a => a.name === 'hp'), 'the hp action');
  assert.ok(rec.actions.some(a => a.name === 'tab'), 'the tab action');
  assert.ok(rec.settingsTabs.length >= 1, 'a settings tab');
  assert.ok(rec.provided && rec.provided.apiVersion === 1, 'provides the rules api for other addons');
  assert.ok(!rec.articleSections.length, 'no standalone article section (we own the body instead)');
  assert.ok(!rec.editorFields.length, 'no editor fields (the host edit form stays host-only)');
});

test('sheets: renderers survive the smoke pass (sparse entity)', () => {
  const { rec } = dryRunRegister(register, META);
  const smoke = smokeRegistrations(rec);
  assert.ok(smoke.ok, JSON.stringify(smoke.failures));
});

test('sheets: Overview tab is the host lore (reused, not duplicated)', () => {
  mockLocalStorage('overview');
  try {
    const { rec } = dryRunRegister(register, META);
    const out = renderBody(rec, FIGHTER, '<div class="md-view"><p>UNIQUE_LORE_MARKER</p></div>');
    assert.match(out, /UNIQUE_LORE_MARKER/, 'the host lore IS the Overview tab');
    assert.match(out, /Character Sheet/, 'the addon adds D&D tabs');
    assert.doesNotMatch(out, /Saving Throws/, 'D&D stat panels live on other tabs, not Overview');
  } finally { clearLocalStorage(); }
});

test('sheets: Character Sheet tab shows class + ability mods (standalone)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRunRegister(register, META);
    const out = renderBody(rec, FIGHTER);
    assert.match(out, /Fighter/, 'class line in the vitals bar');
    assert.match(out, /\+3/, 'STR modifier (+3)');
    assert.doesNotMatch(out, /Builder/, 'no Builder tab in standalone (no book data)');
  } finally { clearLocalStorage(); }
});

test('sheets: engine-computed vitals + Builder tab (editor, book data present)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    // Real engine over fake book data: L1 Wizard (d6) with CON 14 → max HP 6+2=8.
    const out = renderBody(rec, { id: 'c9', name: 'Mage', addonData: { 'dnd55e-sheets': { className: 'Wizard', hp: 4, abilities: { CON: 14 } } } });
    assert.match(out, /Builder/, 'Builder tab appears (book data + editor)');
    assert.match(out, / \/ 8</, 'vitals bar shows the engine-computed max HP (8)');
  } finally { clearLocalStorage(); }
});

test('sheets: anonymous viewer gets a read-only sheet (no Builder, no inputs)', () => {
  mockLocalStorage('stats');
  try {
    const { rec } = dryRunRegister(register, META, { ...PHB(), isAnonymous: true });
    const out = renderBody(rec, { id: 'ca', name: 'Mage', addonData: { 'dnd55e-sheets': { className: 'Wizard' } } });
    assert.doesNotMatch(out, /Builder/, 'no Builder tab for an anonymous viewer');
    assert.doesNotMatch(out, /<input/, 'no edit inputs for an anonymous viewer');
    assert.doesNotMatch(out, /toggleSkill/, 'no prof toggles for an anonymous viewer');
  } finally { clearLocalStorage(); }
});

test('sheets: Builder tab renders the guided form when book data is present', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'cb', name: 'Hero', addonData: { 'dnd55e-sheets': { className: 'Wizard', abilities: { INT: 15 } } } });
    assert.match(out, /Ability Scores|Class & Levels|Progression/, 'shows Builder sections');
    assert.match(out, /Wizard/, 'class dropdown / resolved class');
    assert.match(out, /<select/, 'renders dropdowns');
  } finally { clearLocalStorage(); }
});

test('sheets: Builder progression log shows SUBCLASS features (A4)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    // Eldritch Knight (fighter subclass in the fake) grants "War Bond" at level 3;
    // its sheet.features source.id is the subclass id, so the log filter must match
    // it against cl.subclass — not cl.classId — for it to appear.
    const out = renderBody(rec, { id: 'cbs', name: 'EK', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'fighter', level: 3, subclass: 'eldritch-knight' }], abilities: { STR: 15 } } } });
    assert.match(out, /War Bond/, 'subclass feature appears in the progression log');
  } finally { clearLocalStorage(); }
});

test('sheets: Builder log links resolved feature names to the compendium (B1.2)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    // Sorcerer L2 shows the "Metamagic" feature (fake sorcerer progression); it resolves to
    // the sorcerer-metamagic feature record, so the name links to the compendium detail page.
    const out = renderBody(rec, { id: 'cbl', name: 'Sorc', addonData: { 'dnd55e-sheets': {
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
  const { host } = createMockHost(META, {});
  const { sheetOf } = makeHelpers(host);
  const E = makeEngine({ host, NS: 'dnd55e-sheets', ABILITIES, SKILLS, num, abilityMod, sheetOf });
  const s = sheetOf({ addonData: { 'dnd55e-sheets': {
    className: 'Wizard',
    featureChoices: { 'skills:wizard#0': 'arcana', 'skills:wizard#1': 'stealth', 'wiz-exp': 'stealth' },
  } } });
  const cd = E.decisionsOf(s, api);
  assert.deepEqual([...cd.skillProficiencies].sort(), ['arcana', 'stealth'], 'class skill picks resolved');
  assert.equal(cd.skillExpertise.stealth, true, 'expertise pick resolved');
});

test('sheets: Builder actions mutate the model + materialize without throwing', () => {
  const { rec } = dryRunRegister(register, META, PHB());
  const act = (name, ...args) => rec.actions.find(a => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('builderAbility', 'c1', 'STR', '15'));
  assert.doesNotThrow(() => act('builderClassSet', 'c1', 0, 'wizard'));
  assert.doesNotThrow(() => act('builderLevelSet', 'c1', 0, '5'));
  assert.doesNotThrow(() => act('builderAddClass', 'c1'));
  assert.doesNotThrow(() => act('builderBgAsi', 'c1', 'STR:2,DEX:1'));
  assert.doesNotThrow(() => act('builderChoose', 'c1', 'asi:wizard:4:ability', 'CON'));
});

test('sheets: a half-feat chosen at an ASI level applies its ability bump (AB-2)', () => {
  // great-weapon-master (single-option +1 STR) and fey-touched (choose one of
  // INT/WIS/CHA) both live in the shared fake book data.
  const { host, rec } = createMockHost(META, PHB());
  let stored = {};
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd55e-sheets': stored } }; };
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

test('sheets: Spellbook separates granted from picks + shows the available pool', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    // Life Domain (subclass grant, level 3) → Bless always-prepared via the
    // real engine (mirrors tests/rules.mjs "grants always-prepared spells").
    const out = renderBody(rec, { id: 'csp', name: 'Mage', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'wizard', level: 5, subclass: 'life-domain' }],
      cantrips: { wizard: ['fire-bolt'] },
      preparedSpells: { wizard: ['fireball'] },
      spells: [{ id: 'x1', name: 'Counterspell', level: 3, origin: 'copied' }],
    } } });
    assert.match(out, /Always prepared/, 'granted section header');
    assert.match(out, /Bless/, 'granted (always-prepared) spell shown');
    assert.match(out, /Fireball/, 'prepared pick shown');
    assert.match(out, /Fire Bolt/, 'cantrip pick shown');
    assert.match(out, /Extra spells/, 'extra/copied section');
    assert.match(out, /Counterspell/, 'copied spell shown in extras');
    assert.match(out, /Mage Armor/, 'available (undrafted) spell in the pool');
    assert.match(out, /draggable="true"/, 'draggable spell cards');
    assert.match(out, /data-on-drop=/, 'drop zones for preparation');
  } finally { clearLocalStorage(); }
});

test('sheets: choose-grant picker renders a filtered pool + pick/unpick actions', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    // Acolyte's origin feat is Magic Initiate (choose 2 wizard cantrips + 1
    // level-1 spell) → pending choices surface pickers.
    const out = renderBody(rec, { id: 'cmi', name: 'Mage', addonData: { 'dnd55e-sheets': { className: 'Wizard', background: 'Acolyte' } } });
    assert.match(out, /Granted spell choices/, 'choices section header');
    assert.match(out, /Magic Initiate/, 'shows the grant source + count');
    assert.match(out, /<option value="fire-bolt">/, 'picker offers the matching level-0 wizard cantrip');
    assert.doesNotMatch(out, /<option value="fireball"/, 'a non-matching (level-3) spell is NOT an option in the cantrip picker');
  } finally { clearLocalStorage(); }
  const { rec } = dryRunRegister(register, META, PHB());
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('grantPick', 'c1', 'feat:magic-initiate:mi-cantrips', 'fire-bolt'));
  assert.doesNotThrow(() => act('grantUnpick', 'c1', 'feat:magic-initiate:mi-cantrips', 'fire-bolt'));
});

test('sheets: spellbook prepare/cantrip/copy + drag-drop actions do not throw', () => {
  const { rec } = dryRunRegister(register, META, PHB());
  const act = (name, ...args) => rec.actions.find(a => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('prepSpell', 'c1', 'wizard', 'fireball'));
  assert.doesNotThrow(() => act('learnCantrip', 'c1', 'wizard', 'fire-bolt'));
  assert.doesNotThrow(() => act('unprepSpell', 'c1', 'wizard', 'fireball'));
  assert.doesNotThrow(() => act('copySpell', 'c1'));
  const ev = { dataTransfer: { setData() {} } };
  assert.doesNotThrow(() => act('spellDragStart', ev, 'mage-armor'));
  assert.doesNotThrow(() => act('spellDrop', 'c1', 'wizard', 'prepared'));
  assert.doesNotThrow(() => act('spellDrop', 'c1', 'wizard', 'cantrip'));
});

test('sheets: Combat tab shows engine-computed attacks from equipped weapons', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    // Real engine: Fighter STR 16 L1, proficient martial → +3 STR +2 PB = +5
    // (mirrors tests/rules.mjs EQ-3/4/5).
    const out = renderBody(rec, { id: 'ck', name: 'Knight', addonData: { 'dnd55e-sheets': {
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
    const { rec } = dryRunRegister(register, META);
    const out = renderBody(rec, { id: 'ct', name: 'Brn', addonData: { 'dnd55e-sheets': { className: 'Barbarian', resources: [{ id: 'r1', name: 'Rage', current: 2, max: 3 }] } } });
    assert.match(out, /Trackers/, 'trackers section on the Combat tab');
    assert.match(out, /Rage/, 'the tracker is shown');
    assert.match(out, /resourceAdjust/, '± live-play control present');
  } finally { clearLocalStorage(); }
});

test('sheets: Combat tab auto-generates trackers + Rest button, with structured recharge', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    // Real engine: Barbarian L5 → Rage (pool, max 3), Insp (+1 on short rest /
    // full on long rest), d12 hit dice (mirrors tests/rules.mjs FE-2/FE-3).
    const out = renderBody(rec, { id: 'cr', name: 'Brn', addonData: { 'dnd55e-sheets': { className: 'Barbarian', level: 5 } } });
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
  const { rec } = dryRunRegister(register, META, PHB());
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('restOpen', 'c1'));
  assert.doesNotThrow(() => act('restSpendHitDie', 'c1', 'hit-dice-d12'));
  assert.doesNotThrow(() => act('restApply', 'c1', 'short'));
  assert.doesNotThrow(() => act('restApply', 'c1', 'long'));
  assert.doesNotThrow(() => act('restClose', 'c1'));
});

test('sheets: Backpack offers compendium pickers + attunement counter', () => {
  mockLocalStorage('backpack');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'cb2', name: 'Knight', addonData: { 'dnd55e-sheets': { className: 'Fighter', inventory: [{ id: 'i1', ref: 'longsword', name: 'Longsword', location: 'equipped', attuned: true }] } } });
    assert.match(out, /Weapon…|Armor…/, 'compendium add pickers');
    assert.match(out, /Attuned 1\/3/, 'attunement counter from the engine');
    assert.match(out, /✦/, 'attunement toggle');
    assert.match(out, /Sap/, 'weapon mastery shown on the row');
  } finally { clearLocalStorage(); }
});

test('sheets: Backpack add-item + attune actions do not throw', () => {
  const { rec } = dryRunRegister(register, META, PHB());
  const act = (name, ...args) => rec.actions.find(a => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('invAddRef', 'c1', 'weapon', 'longsword'));
  assert.doesNotThrow(() => act('invAddRef', 'c1', 'armor', 'leather'));
  assert.doesNotThrow(() => act('invAttune', 'c1', 'someid'));
});

test('sheets: resource tracker actions mutate without throwing', () => {
  const { rec } = dryRunRegister(register, META);
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
    const { rec } = dryRunRegister(register, META);
    const out = renderBody(rec, { id: 'pv', name: 'Rgr', addonData: { 'dnd55e-sheets': { className: 'Ranger' } } });
    assert.match(out, /toggleSkill/, 'skill dots toggle directly (editor)');
    assert.match(out, /toggleSave/, 'save dots toggle directly (editor)');
  } finally { clearLocalStorage(); }
});

test('sheets: no Spellbook tab for a non-caster with no spells (engine mode)', () => {
  const { rec } = dryRunRegister(register, META, PHB());
  const out = renderBody(rec, { id: 'cf', name: 'Brute', addonData: { 'dnd55e-sheets': { className: 'Fighter' } } });
  assert.doesNotMatch(out, /Spellbook/, 'spellbook tab hidden for a non-caster');
});

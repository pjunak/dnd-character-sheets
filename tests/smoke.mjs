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

test('sheets: the Builder is tabbed — Character + one tab per class (B4.5b)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'cbt', name: 'Multi', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'fighter', level: 2, subclass: '' }, { classId: 'wizard', level: 3, subclass: '' }], abilities: { STR: 14, INT: 14 } } } });
    assert.match(out, /builderTab/, 'the sub-tab strip is present');
    assert.match(out, /Fighter 2/, 'a tab per class, with its level');
    assert.match(out, /Wizard 3/, 'the second class tab');
    assert.match(out, /Ability Scores/, 'defaults to the Character tab (abilities visible)');
  } finally { clearLocalStorage(); }
});

test('sheets: a class tab spine shows SUBCLASS features (A4/B4.5b)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    rec.actions.find((a) => a.name === 'builderTab').fn('cbs', 'fighter');   // open the Fighter class tab
    // Eldritch Knight grants "War Bond" at level 3; the spine filters subclass features
    // by cl.subclass — not cl.classId — so it appears in the Fighter tab's spine.
    const out = renderBody(rec, { id: 'cbs', name: 'EK', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'fighter', level: 3, subclass: 'eldritch-knight' }], abilities: { STR: 15 } } } });
    assert.match(out, /War Bond/, 'subclass feature appears in the class spine');
  } finally { clearLocalStorage(); }
});

test('sheets: the class spine links resolved feature names to the compendium (B1.2)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    rec.actions.find((a) => a.name === 'builderTab').fn('cbl', 'sorcerer');   // open the Sorcerer class tab
    // Sorcerer L2's "Metamagic" resolves to the sorcerer-metamagic feature record → its
    // name links to the compendium detail page (in the class spine now, not a flat log).
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

test('sheets: duplicate multi-pick values dedupe in resolved inputs (FE-7)', () => {
  const WIZ = { id: 'wizard', name: 'Wizard', hitDie: 'd6', subclassLevel: 3,
    startingProficiencies: { skills: { choose: 2, from: ['arcana', 'history', 'stealth'] } } };
  const api = makeRulesApi(() => ({ apiVersion: 1,
    getItem: (kind, id) => ((kind === 'class' && id === 'wizard') ? WIZ : null),
    getItemByName: (kind, name) => ((kind === 'class' && /wizard/i.test(String(name))) ? WIZ : null) }));
  const { host } = createMockHost(META, {});
  const { sheetOf } = makeHelpers(host);
  const E = makeEngine({ host, NS: 'dnd55e-sheets', ABILITIES, SKILLS, num, abilityMod, sheetOf });
  const s = sheetOf({ addonData: { 'dnd55e-sheets': { className: 'Wizard',
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
  const { host } = createMockHost(META, {});
  const { sheetOf } = makeHelpers(host);
  const E = makeEngine({ host, NS: 'dnd55e-sheets', ABILITIES, SKILLS, num, abilityMod, sheetOf });
  const choices = E.collectChoices([{ classId: 'cleric', level: 1, subclass: '' }], api);
  const skills = choices.filter((c) => c.id === 'skills:cleric');
  assert.equal(skills.length, 1, 'exactly one descriptor for skills:cleric (the bare dup is dropped)');
  assert.equal(skills[0].kind, 'skills', 'the survivor is the well-formed skills picker');
  assert.deepEqual(skills[0].from, ['history', 'insight', 'medicine', 'persuasion', 'religion'], 'it carries the from pool');
  assert.ok(!choices.some((c) => c.kind === 'enumerated'), 'no empty enumerated dup survives (would render "content pending")');
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

test('sheets: ASI number picker distributes a 2-point budget (+2 or +1/+1), capped (B5)', () => {
  const { host, rec } = createMockHost(META, PHB());
  let stored = {};
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd55e-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  const asi = () => (stored.abilityGrants || []).find((g) => g.id === 'asi:wizard:4:ability');
  const step = (ab, dir) => act('builderAsiStep', 'c1', 'asi:wizard:4:ability', ab, dir, 2, 2);
  // +1/+1 across two abilities — something the old single-ability select couldn't express.
  step('STR', 1); step('DEX', 1);
  assert.deepEqual(asi().assign, { STR: 1, DEX: 1 }, 'two abilities each +1');
  step('CON', 1);
  assert.equal(asi().assign.CON, undefined, 'a 3rd point exceeds the 2-budget → refused');
  // Zero out, then +2 to a single ability; a 3rd is refused by the per-ability cap.
  step('STR', -1); step('DEX', -1);
  step('STR', 1); step('STR', 1);
  assert.deepEqual(asi().assign, { STR: 2 }, '+2 to a single ability');
  step('STR', 1);
  assert.equal(asi().assign.STR, 2, 'per-ability cap (2) enforced');
});

test('sheets: background ASI number picker distributes 3 points, +2 max per ability (B5)', () => {
  const { host, rec } = createMockHost(META, PHB());
  let stored = {};
  host.store.patchAddonData = (_c, itemId, fn) => { stored = fn(stored) || stored; return { id: itemId, addonData: { 'dnd55e-sheets': stored } }; };
  register(host);
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  const bg = () => (stored.abilityGrants || []).find((g) => g.id === 'bgasi');
  const step = (ab, dir) => act('builderAsiStep', 'c1', 'bgasi', ab, dir, 3, 2);
  step('STR', 1); step('STR', 1); step('DEX', 1);   // +2 STR, +1 DEX = the 3-point spend
  assert.deepEqual(bg().assign, { STR: 2, DEX: 1 }, '+2/+1 across two abilities (3 points)');
  step('CON', 1);
  assert.equal(bg().assign.CON, undefined, 'a 4th point exceeds the 3-budget → refused');
  step('STR', 1);
  assert.equal(bg().assign.STR, 2, 'per-ability cap (2) enforced');
});

test('sheets: ASI level renders ability number-pickers, not a single-ability select (B5)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'casi', 'fighter');
    act('builderToggleLevel', 'casi', 'fighter:4');   // expand the L4 ASI row
    const out = renderBody(rec, { id: 'casi', name: 'Ftr', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'fighter', level: 4, subclass: '' }],
      featureChoices: { 'asi:fighter:4': 'asi' } } } });   // ASI mode (not Feat)
    assert.match(out, /builderAsiStep/, 'the ASI ability pick is a number-picker stepper');
    assert.match(out, /asi:fighter:4:ability/, 'steppers target the ASI ability grant');
    assert.match(out, /2,2\]/, 'wired with the 2-point budget + per-ability cap');
  } finally { clearLocalStorage(); }
});

test('sheets: a multi-pick pool excludes an option already taken in another box (FE-7)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'cfe7', 'sorcerer');            // open the Sorcerer class tab
    act('builderToggleLevel', 'cfe7', 'sorcerer:2');  // expand L2 (Metamagic) to reveal the pickers
    // Sorcerer L2 → 2 Metamagic boxes. Twinned is taken in box 0, so box 1 must not
    // offer it again (no picking it twice), while an untaken option stays in both.
    const out = renderBody(rec, { id: 'cfe7', name: 'Sorc', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'sorcerer', level: 2, subclass: '' }], abilities: { CHA: 15 },
      featureChoices: { 'metamagic#0': 'metamagic-twinned-spell' } } } });
    assert.equal((out.match(/value="metamagic-twinned-spell"/g) || []).length, 1, 'the taken option appears once (only its own box)');
    assert.equal((out.match(/value="metamagic-quickened-spell"/g) || []).length, 2, 'an untaken option stays available in both boxes');
  } finally { clearLocalStorage(); }
});

test('sheets: builder spine rows are whole-row click targets, inner links stay live (B5)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'cct', 'sorcerer');   // Sorcerer L2 has Metamagic → an expandable spine row
    const out = renderBody(rec, { id: 'cct', name: 'Sorc', addonData: { 'dnd55e-sheets': {
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
  } finally { clearLocalStorage(); }
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
    // B2.1: spell names link to their compendium detail page (prepared pick + granted).
    assert.match(out, /href="#\/compendium\/spell:fireball"/, 'prepared spell links to its compendium page (B2.1)');
    assert.match(out, /href="#\/compendium\/spell:bless"/, 'granted spell links to its compendium page (B2.1)');
    assert.match(out, /Fire Bolt/, 'cantrip pick shown');
    assert.match(out, /Extra spells/, 'extra/copied section');
    assert.match(out, /Counterspell/, 'copied spell shown in extras');
    assert.match(out, /Mage Armor/, 'available (undrafted) spell in the pool');
    assert.match(out, /draggable="true"/, 'draggable spell cards');
    assert.match(out, /data-on-drop=/, 'drop zones for preparation');
  } finally { clearLocalStorage(); }
});

test('sheets: a prepared ritual spell is marked when the class can ritual-cast (B4.2)', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    // Wizard can ritual-cast; Detect Magic (prepared) has the Ritual tag → ⟳ marker.
    const out = renderBody(rec, { id: 'crit', name: 'Mage', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'wizard', level: 5, subclass: '' }],
      preparedSpells: { wizard: ['detect-magic', 'fireball'] } } } });
    assert.match(out, /Detect Magic/, 'the ritual spell is shown among prepared');
    assert.match(out, /⟳/, 'a ritual marker appears (Wizard can ritual-cast)');
  } finally { clearLocalStorage(); }
});

test('sheets: a Wizard prepares from the learned spellbook, not the full class list (B4.2b)', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    // Wizard L5: only Mage Armor learned into the book; nothing prepared yet.
    const out = renderBody(rec, { id: 'cbk', name: 'Mage', addonData: { 'dnd55e-sheets': {
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
    const pal = renderBody(rec, { id: 'cpal', name: 'Pal', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'paladin', level: 5, subclass: '' }], abilities: { CHA: 16 } } } });
    assert.doesNotMatch(pal, /in book/, 'a list-caster prepares from the class list — no spellbook');
  } finally { clearLocalStorage(); }
});

test('sheets: Spellbook management — two buttons, copy mode + other-source mode (B4.2c)', () => {
  const modeLS = (mode) => ({ getItem: (k) => { k = String(k); if (k.startsWith('dse-tab:')) return 'spellbook'; if (k.startsWith('dse-spellmgr:')) return mode; return null; }, setItem() {}, removeItem() {} });
  const char = { id: 'cmgr', name: 'Mage', addonData: { 'dnd55e-sheets': {
    classes: [{ classId: 'wizard', level: 5, subclass: '' }], abilities: { INT: 16 },
    currency: { gp: 500 },
    spellbook: { wizard: ['mage-armor'] },
    inventory: [{ id: 'sc1', name: 'Spell Scroll of Fireball', qty: 1, location: 'pack' }],
    spells: [{ id: 'x1', name: 'My Homebrew Bolt', level: 2, origin: 'other', sourceNote: 'from the DM', castWithSlots: true }],
  } } };
  const sorc = { id: 'cmgr2', name: 'Sorc', addonData: { 'dnd55e-sheets': {
    classes: [{ classId: 'sorcerer', level: 2, subclass: '' }], abilities: { CHA: 15 } } } };

  // Button gating (no modal open): Wizard shows BOTH add buttons; a list-caster only "another source".
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const wiz = renderBody(rec, char);
    assert.match(wiz, /Copy from a spell scroll/, 'wizard shows the scroll-copy button');
    assert.match(wiz, /Add from another source/, 'wizard shows the other-source button');
    const so = renderBody(rec, sorc);
    assert.doesNotMatch(so, /Copy from a spell scroll/, 'a non-spellbook caster has no scroll-copy button');
    assert.match(so, /Add from another source/, 'but still has the other-source button');
  } finally { clearLocalStorage(); }

  // COPY mode — scroll + gp form (titles/costs are modal-only, so mode is unambiguous).
  globalThis.localStorage = modeLS('copy');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, char);
    assert.match(out, /Copy a spell into your Wizard spellbook/, 'copy modal title');
    assert.match(out, /Fireball — 150 gp/, 'a copyable spell shows its 50-gp-per-level cost');
    assert.match(out, /Spell Scroll of Fireball/, 'an inventory scroll is offered to consume');
    assert.match(out, /You have 500 gp/, 'current gold shown');
    assert.match(out, /Remove from spellbook/, 'copy mode manages book removal');
    assert.doesNotMatch(out, /Add a spell from another source/, 'copy mode is NOT the other-source modal');
  } finally { clearLocalStorage(); }

  // OTHER-SOURCE mode — homebrew form with the cast-with-slots option (SP-10).
  globalThis.localStorage = modeLS('other');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, char);
    assert.match(out, /Add a spell from another source/, 'other-source modal title');
    assert.match(out, /dse-custom-slots-cmgr/, 'a caster gets the "cast with spell slots" checkbox');
    assert.match(out, /Remove an added spell/, 'other mode manages the added-spell list');
    assert.match(out, /from the DM/, 'the added spell + its source note show');
    assert.doesNotMatch(out, /Copy a spell into your Wizard spellbook/, 'other mode is NOT the copy modal');
  } finally { clearLocalStorage(); }
});

test('sheets: a Warlock shows Pact Magic in the Spellbook summary (B4.3)', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'cwl', name: 'Lock', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'warlock', level: 5, subclass: '' }], abilities: { CHA: 16 } } } });
    assert.match(out, /Pact/, 'the Spellbook summary shows a Pact indicator');
  } finally { clearLocalStorage(); }
});

test('sheets: pact slots are a short-rest tracker resource (B4.3)', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'cwlt', name: 'Lock', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'warlock', level: 5, subclass: '' }], abilities: { CHA: 16 } } } });
    assert.match(out, /Pact Slots/, 'pact slots listed as a tracker');
    assert.match(out, /short rest/, 'with a short-rest recharge label');
  } finally { clearLocalStorage(); }
});

test('sheets: Combat tab shows a read-only Features summary linking to the compendium (B4.4)', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'cfs', name: 'Sorc', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'sorcerer', level: 2, subclass: '' }], abilities: { CHA: 15 } } } });
    assert.match(out, /Features/, 'a Features summary section is present');
    assert.match(out, /href="#\/compendium\/feature:sorcerer-metamagic"/, 'a feature links to its compendium page');
  } finally { clearLocalStorage(); }
});

test('sheets: a chosen ASI feat shows a ↗ compendium link in the Builder (B4.4 / B2.2)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'cfl', 'fighter');           // open the Fighter class tab
    act('builderToggleLevel', 'cfl', 'fighter:4');  // expand L4 (ASI) to reveal the feat picker
    const out = renderBody(rec, { id: 'cfl', name: 'Ftr', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'fighter', level: 4, subclass: '' }], abilities: { STR: 15 },
      featureChoices: { 'asi:fighter:4': 'feat', 'asi:fighter:4:feat': 'great-weapon-master' } } } });
    assert.match(out, /href="#\/compendium\/feat:great-weapon-master"/, 'the chosen feat links to its compendium page');
  } finally { clearLocalStorage(); }
});

test('sheets: the class spine flags unresolved levels + summarizes made choices as chips (B4.5b)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    rec.actions.find((a) => a.name === 'builderTab').fn('cch', 'fighter');   // Fighter tab, nothing expanded
    // L4 is an ASI level. Unresolved → a soft "needs choices" flag; editor stays hidden (collapsed).
    const unset = renderBody(rec, { id: 'cch', name: 'Ftr', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'fighter', level: 4, subclass: '' }], abilities: { STR: 15 } } } });
    assert.match(unset, /needs choices/, 'an unresolved ASI level is flagged');
    assert.doesNotMatch(unset, /asi:fighter:4:feat/, 'the editor is hidden while the row is collapsed');
    // Resolve it → the collapsed row summarizes the pick as a chip.
    const done = renderBody(rec, { id: 'cch', name: 'Ftr', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'fighter', level: 4, subclass: 'eldritch-knight' }], abilities: { STR: 15 },
      featureChoices: { 'asi:fighter:4': 'feat', 'asi:fighter:4:feat': 'great-weapon-master' } } } });
    assert.match(done, /Great Weapon Master/, 'the made choice shows as a chip in the collapsed row');
  } finally { clearLocalStorage(); }
});

test('sheets: a class tab levels via +/- and picks its subclass in the spine (B4.5b)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
    act('builderTab', 'clv', 'fighter');
    const char = { id: 'clv', name: 'Ftr', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'fighter', level: 3, subclass: '' }], abilities: { STR: 15 } } } };
    const out = renderBody(rec, char);
    assert.match(out, /builderLevelStep/, 'the class tab shows a level +/- stepper');
    assert.match(out, /needs choices/, 'the subclass level flags an unset subclass');
    // Expand the subclass level → the subclass picker appears in the spine.
    act('builderToggleLevel', 'clv', 'fighter:3');
    const open = renderBody(rec, char);
    assert.match(open, /builderSubclassSet/, 'expanding the subclass level reveals the subclass picker');
    assert.match(open, /Eldritch Knight/, 'its subclass option is offered');
    assert.doesNotThrow(() => act('builderLevelStep', 'clv', 'fighter', 1), 'the +/- stepper does not throw');
  } finally { clearLocalStorage(); }
});

test('sheets: the Character tab manages extra feats (compendium + free-text) (B4.5b)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'cxf', name: 'Hero', addonData: { 'dnd55e-sheets': {
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

test('sheets: an extra feat with a featId feeds the engine feats list (B4.5b)', () => {
  const api = makeRulesApi(() => ({ apiVersion: 1, getItem: () => null, getItemByName: () => null }));
  const { host } = createMockHost(META, {});
  const { sheetOf } = makeHelpers(host);
  const E = makeEngine({ host, NS: 'dnd55e-sheets', ABILITIES, SKILLS, num, abilityMod, sheetOf });
  const s = sheetOf({ addonData: { 'dnd55e-sheets': {
    extraFeats: [{ id: 'x1', featId: 'tough' }, { id: 'x2', name: 'Homebrew Luck' }] } } });
  const cd = E.decisionsOf(s, api);
  assert.ok(cd.feats.some((f) => f.featId === 'tough'), 'a compendium extra feat is fed to the engine');
  assert.ok(!cd.feats.some((f) => f.featId == null), 'a free-text extra feat is not fed as a mechanical feat');
});

test('sheets: a recorded spell swap shows in the class spine at its level (B4.5b)', () => {
  mockLocalStorage('builder');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    rec.actions.find((a) => a.name === 'builderTab').fn('csw', 'wizard');   // open the Wizard class tab
    const out = renderBody(rec, { id: 'csw', name: 'Mage', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'wizard', level: 5, subclass: '' }], abilities: { INT: 15 },
      spellSwaps: [{ level: 3, classLevel: 3, classId: 'wizard', out: 'fireball', in: 'misty-step' }] } } });
    assert.match(out, /href="#\/compendium\/spell:fireball"/, 'the swapped-out spell links out (at its level)');
    assert.match(out, /href="#\/compendium\/spell:misty-step"/, 'the swapped-in spell links out');
  } finally { clearLocalStorage(); }
});

test('sheets: printSheet builds a self-contained print sheet (B4.6)', () => {
  const char = { id: 'cp', name: 'Gandalf', addonData: { 'dnd55e-sheets': {
    classes: [{ classId: 'wizard', level: 5, subclass: '' }], abilities: { INT: 16, DEX: 14, CON: 14 },
    preparedSpells: { wizard: ['fireball'] }, cantrips: { wizard: ['fire-bolt'] },
    inventory: [{ id: 'i1', name: 'Spellbook', qty: 1, location: 'pack' }], currency: { gp: 25 } } } };
  const { rec } = dryRunRegister(register, META, { ...PHB(), fixtures: { characters: [char] } });
  let captured = '';
  globalThis.window = { open: () => ({ document: { open() {}, write(h) { captured = h; }, close() {} }, focus() {}, print() {} }) };
  try { rec.actions.find((a) => a.name === 'printSheet').fn('cp'); } finally { delete globalThis.window; }
  assert.match(captured, /<!doctype html>/i, 'a standalone HTML document (opens in a new window)');
  assert.match(captured, /Gandalf/, 'the character name');
  assert.match(captured, /Ability Scores/, 'the abilities section');
  assert.match(captured, /Fireball/, 'a prepared spell is listed');
  assert.match(captured, /Fire Bolt/, 'a cantrip is listed');
  assert.match(captured, /Spellbook/, 'inventory is listed');
});

test('sheets: exportSheet serializes the character to JSON (B4.6)', () => {
  const char = { id: 'ce', name: 'Frodo', addonData: { 'dnd55e-sheets': { className: 'Rogue', level: 3, abilities: { DEX: 16 } } } };
  const { rec } = dryRunRegister(register, META, { ...PHB(), fixtures: { characters: [char] } });
  let captured = '';
  const oB = globalThis.Blob, oU = globalThis.URL, oD = globalThis.document;
  globalThis.Blob = function (parts) { captured = String((parts && parts[0]) || ''); };
  globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  globalThis.document = { createElement: () => ({ href: '', download: '', click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } };
  try { rec.actions.find((a) => a.name === 'exportSheet').fn('ce'); }
  finally { globalThis.Blob = oB; globalThis.URL = oU; globalThis.document = oD; }
  const parsed = JSON.parse(captured);
  assert.equal(parsed.className, 'Rogue', 'exported JSON carries the sheet data');
  assert.equal(parsed.abilities.DEX, 16, 'and the abilities');
});

test('sheets: the import modal renders a paste area (B4.6)', () => {
  globalThis.localStorage = { getItem: (k) => (String(k).startsWith('dse-import:') ? 'open' : null), setItem() {}, removeItem() {} };
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'cim', name: 'Sam', addonData: { 'dnd55e-sheets': { className: 'Fighter' } } });
    assert.match(out, /Import character/, 'the import modal title');
    assert.match(out, /dse-import-cim/, 'the paste textarea');
    assert.match(out, /importApply/, 'the import action');
  } finally { clearLocalStorage(); }
});

test('sheets: import parses safely — valid + garbage JSON never throw (B4.6)', () => {
  const { rec } = dryRunRegister(register, META, PHB());
  const act = (n, ...a) => rec.actions.find((x) => x.name === n).fn(...a);
  assert.doesNotThrow(() => act('importOpen', 'c1'));
  assert.doesNotThrow(() => act('importClose', 'c1'));
  globalThis.document = { getElementById: () => ({ value: '{"className":"Bard","abilities":{"CHA":15}}' }) };
  try { assert.doesNotThrow(() => act('importApply', 'c1')); } finally { delete globalThis.document; }
  globalThis.document = { getElementById: () => ({ value: 'not valid json {{{' }) };
  try { assert.doesNotThrow(() => act('importApply', 'c1')); } finally { delete globalThis.document; }
});

test('sheets: recorded spell swaps show as a linked history in the Spellbook (B4.5)', () => {
  mockLocalStorage('spellbook');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'csw', name: 'Mage', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'wizard', level: 5, subclass: '' }],
      spellSwaps: [{ level: 3, classId: 'wizard', out: 'fireball', in: 'misty-step' }] } } });
    assert.match(out, /Swaps/, 'a swaps history section');
    assert.match(out, /href="#\/compendium\/spell:fireball"/, 'the swapped-out spell links to its page');
    assert.match(out, /href="#\/compendium\/spell:misty-step"/, 'the swapped-in spell links to its page');
    assert.match(out, /🔄/, 'a swap button is offered (edit mode)');
  } finally { clearLocalStorage(); }
});

test('sheets: spell-swap actions do not throw (open/close/apply/forget)', () => {
  const { rec } = dryRunRegister(register, META, PHB());
  const act = (name, ...args) => rec.actions.find((a) => a.name === name).fn(...args);
  assert.doesNotThrow(() => act('spellSwapOpen', 'c1', 'wizard'));
  assert.doesNotThrow(() => act('spellSwapClose', 'c1'));
  assert.doesNotThrow(() => act('spellSwapApply', 'c1', 'wizard'));   // no DOM <select>s → safe no-op
  assert.doesNotThrow(() => act('spellSwapForget', 'c1', 0));
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

test('sheets: Combat attacks link the weapon to the compendium (B2.3)', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'catk', name: 'Knight', addonData: { 'dnd55e-sheets': {
      classes: [{ classId: 'fighter', level: 1, subclass: '' }], abilities: { STR: 16 },
      inventory: [{ id: 'i1', ref: 'longsword', name: 'Longsword', location: 'equipped' }] } } });
    assert.match(out, /href="#\/compendium\/weapon:longsword"/, 'equipped weapon links to its compendium page');
  } finally { clearLocalStorage(); }
});

test('sheets: header class + subclass link to the compendium (B2.4)', () => {
  mockLocalStorage('combat');
  try {
    const { rec } = dryRunRegister(register, META, PHB());
    const out = renderBody(rec, { id: 'chd', name: 'Knight', addonData: { 'dnd55e-sheets': {
      className: 'Fighter', subclass: 'Eldritch Knight', level: 3,
      classes: [{ classId: 'fighter', level: 3, subclass: 'eldritch-knight' }], abilities: { STR: 15 } } } });
    assert.match(out, /href="#\/compendium\/class:fighter"/, 'header class name links to its compendium page');
    assert.match(out, /href="#\/compendium\/subclass:eldritch-knight"/, 'header subclass name links to its compendium page');
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

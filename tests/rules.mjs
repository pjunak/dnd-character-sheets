// Client self-test for dnd55e-core-rules against the host test harness.
// Run: node --test tests/smoke.mjs  (assumes ttrpg-codex is a sibling checkout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dryRunRegister, smokeRegistrations } from '../../ttrpg-codex/web/js/addon-test-harness.mjs';
import register from '../entry.js';

const META = {
  id: 'dnd55e-core-rules',
  permissions: ['ui:settings-tab'],
  dependencies: { 'dnd55e-compendium': { range: '>=0.1.0' } },
};

// A fake compendium API mirroring the real seed shapes, to exercise hydrate.
function makeFake() {
  const store = {
    class: {
      wizard: {
        id: 'wizard', name: 'Wizard', kind: 'class', hitDie: 'd6', savingThrows: ['INT', 'WIS'],
        spellcasting: { ability: 'INT', type: 'full', prepares: 'spellbook', ritual: true },
        weaponMastery: { count: 2 }, acFormulas: [],
        // Authoritative printed full-caster spell-slot progression (2024 PHB).
        progression: [
          { level: 1, cantripsKnown: 3, preparedSpells: 4, spellSlots: [2] },
          { level: 5, cantripsKnown: 4, preparedSpells: 9, spellSlots: [4, 3, 2] },
          { level: 11, cantripsKnown: 5, preparedSpells: 15, spellSlots: [4, 3, 3, 2, 1, 1] },
          { level: 17, cantripsKnown: 5, preparedSpells: 21, spellSlots: [4, 3, 3, 3, 2, 1, 1, 1, 1] },
          { level: 19, cantripsKnown: 5, preparedSpells: 23, spellSlots: [4, 3, 3, 3, 3, 1, 1, 1, 1] },
        ],
      },
      barbarian: {
        id: 'barbarian', name: 'Barbarian', kind: 'class', hitDie: 'd12', savingThrows: ['STR', 'CON'],
        spellcasting: null, weaponMastery: { count: 2 },
        acFormulas: [{ id: 'ud', base: 10, addAbilities: ['DEX', 'CON'], requires: { noArmor: true } }],
        // FE-2/FE-3 resources exercising all three max shapes: progression table,
        // per-level multiple, ability modifier.
        classResources: [
          { key: 'rage', name: 'Rage', recharge: 'long', progression: [{ level: 1, max: 2 }, { level: 3, max: 3 }, { level: 6, max: 4 }] },
          { key: 'pool', name: 'Pool', recharge: 'short', perLevel: 5 },
          { key: 'insp', name: 'Insp', recharge: [{ on: 'short', amount: 1 }, { on: 'long', amount: 'full' }], abilityMod: 'CHA', min: 1 },
        ],
      },
      fighter: {
        id: 'fighter', name: 'Fighter', kind: 'class', hitDie: 'd10', savingThrows: ['STR', 'CON'],
        spellcasting: null, weaponMastery: { count: 3 }, acFormulas: [],
        startingProficiencies: { weapons: ['simple', 'martial'] },
      },
      paladin: {
        id: 'paladin', name: 'Paladin', kind: 'class', hitDie: 'd10', savingThrows: ['WIS', 'CHA'],
        spellcasting: { ability: 'CHA', type: 'half', prepares: 'list' }, weaponMastery: { count: 2 }, acFormulas: [],
        // Authoritative printed half-caster spell-slot progression (2024 PHB).
        progression: [
          { level: 1, preparedSpells: 2, spellSlots: [2] },
          { level: 5, preparedSpells: 6, spellSlots: [4, 2] },
          { level: 10, preparedSpells: 8, spellSlots: [4, 3, 2] },
          { level: 11, preparedSpells: 9, spellSlots: [4, 3, 3] },
          { level: 17, preparedSpells: 14, spellSlots: [4, 3, 3, 1] },
          { level: 19, preparedSpells: 15, spellSlots: [4, 3, 3, 1] },
        ],
      },
      // Ranger deliberately ships NO spellSlots → exercises the heuristic fallback.
      ranger: {
        id: 'ranger', name: 'Ranger', kind: 'class', hitDie: 'd10', savingThrows: ['STR', 'DEX'],
        spellcasting: { ability: 'WIS', type: 'half', prepares: 'list' }, weaponMastery: { count: 2 }, acFormulas: [],
        progression: [{ level: 1, preparedSpells: 2 }, { level: 5, preparedSpells: 6 }, { level: 10, preparedSpells: 8 }],
      },
      // Rogue-ish class: the 2024 'martial-finesse-or-light' weapon subset (PR-5)
      // — proficient with simple weapons + martial weapons that have Finesse or Light.
      rogue: {
        id: 'rogue', name: 'Rogue', kind: 'class', hitDie: 'd8', savingThrows: ['DEX', 'INT'],
        spellcasting: null, weaponMastery: { count: 2 }, acFormulas: [],
        startingProficiencies: { weapons: ['martial-finesse-or-light'] },
      },
    },
    weapon: {
      longsword: { id: 'longsword', name: 'Longsword', kind: 'weapon', category: 'martial', range: 'melee', damage: '1d8', damageType: 'slashing', properties: ['versatile'], versatileDamage: '1d10', mastery: 'Sap' },
      dagger: { id: 'dagger', name: 'Dagger', kind: 'weapon', category: 'simple', range: 'melee', damage: '1d4', damageType: 'piercing', properties: ['finesse', 'light', 'thrown'], mastery: 'Nick' },
      rapier: { id: 'rapier', name: 'Rapier', kind: 'weapon', category: 'martial', range: 'melee', damage: '1d8', damageType: 'piercing', properties: ['finesse'], mastery: 'Vex' },
      greatsword: { id: 'greatsword', name: 'Greatsword', kind: 'weapon', category: 'martial', range: 'melee', damage: '2d6', damageType: 'slashing', properties: ['heavy', 'two-handed'], mastery: 'Graze' },
    },
    subclass: {
      'eldritch-knight': {
        id: 'eldritch-knight', name: 'Eldritch Knight', kind: 'subclass', classId: 'fighter',
        spellcasting: { ability: 'INT', type: 'third', prepares: 'list' },
        features: [{ level: 3, id: 'war-bond', name: 'War Bond' }],
        progression: [{ level: 3, cantripsKnown: 2, preparedSpells: 3, spellSlots: [2] }],
        classResources: [{ key: 'ek-pool', name: 'EK Pool', recharge: [{ on: 'short', amount: 'full' }], progression: [{ level: 3, max: 2 }, { level: 7, max: 3 }] }],
      },
      'life-domain': {
        id: 'life-domain', name: 'Life Domain', kind: 'subclass', classId: 'cleric',
        spells: [{ level: 3, ids: ['bless'], alwaysPrepared: true }],
      },
    },
    feat: {
      'fey-touched': { id: 'fey-touched', name: 'Fey Touched', grants: { abilityScoreIncrease: { choose: 1, amount: 1, from: ['INT', 'WIS', 'CHA'] }, spells: [{ ids: ['misty-step'], alwaysPrepared: true, free: '1/long' }] } },
      tough: { id: 'tough', name: 'Tough', grants: { hpPerLevel: 2 } },
      'magic-initiate': { id: 'magic-initiate', name: 'Magic Initiate', grants: { spells: [
        { id: 'mi-cantrips', choose: 2, spellLevel: 0, from: { class: ['wizard'] }, alwaysPrepared: true },
        { id: 'mi-spell', choose: 1, spellLevel: 1, from: { class: ['wizard'] }, alwaysPrepared: true, free: '1/long' },
      ] } },
    },
    spell: {
      bless: { id: 'bless', name: 'Bless', level: 1, school: 'Enchantment' },
      'misty-step': { id: 'misty-step', name: 'Misty Step', level: 2, school: 'Conjuration' },
      'dancing-lights': { id: 'dancing-lights', name: 'Dancing Lights', level: 0, school: 'Illusion' },
      'faerie-fire': { id: 'faerie-fire', name: 'Faerie Fire', level: 1, school: 'Evocation' },
      darkness: { id: 'darkness', name: 'Darkness', level: 2, school: 'Evocation' },
      druidcraft: { id: 'druidcraft', name: 'Druidcraft', level: 0, school: 'Transmutation' },
    },
    armor: {
      breastplate: { id: 'breastplate', name: 'Breastplate', kind: 'armor', armorType: 'medium', baseAC: 14, dexCap: 2, acBonus: 0 },
      // A malformed body-armor record (garbage negative baseAC) — must never drag
      // AC below the 10+DEX unarmored floor.
      brokenplate: { id: 'brokenplate', name: 'Broken Plate', kind: 'armor', armorType: 'heavy', baseAC: -5, dexCap: 0, acBonus: 0 },
    },
    species: {
      dwarf: { id: 'dwarf', name: 'Dwarf', kind: 'species', speeds: { walk: 30 }, senses: { darkvision: 120 }, resistances: ['poison'], grants: { hpPerLevel: 1 }, lineages: [{ id: 'hill-dwarf', name: 'Hill Dwarf', grants: { hpPerLevel: 1 } }] },
      elf: { id: 'elf', name: 'Elf', kind: 'species', speeds: { walk: 30 }, senses: { darkvision: 60 }, resistances: [], lineages: [
        { id: 'drow', name: 'Drow', grants: { senses: { darkvision: 120 }, spells: [{ level: 0, ids: ['dancing-lights'], alwaysPrepared: true }, { level: 3, ids: ['faerie-fire'], alwaysPrepared: true, free: '1/long' }, { level: 5, ids: ['darkness'], alwaysPrepared: true, free: '1/long' }] } },
        { id: 'wood-elf', name: 'Wood Elf', grants: { speedBonus: 5, spells: [{ level: 0, ids: ['druidcraft'], alwaysPrepared: true }] } },
      ] },
    },
    background: { sage: { id: 'sage', name: 'Sage', kind: 'background', skillProficiencies: ['arcana', 'history'] } },
  };
  const byName = (kind, name) => Object.values(store[kind] || {}).find((r) => (r.name || '').toLowerCase() === String(name).toLowerCase()) || null;
  return {
    apiVersion: 1,
    listClasses: () => Object.values(store.class).map((c) => ({ id: c.id, name: c.name })),
    listSubclasses: () => Object.values(store.subclass).map((c) => ({ id: c.id, name: c.name, classId: c.classId })),
    listSkills: () => [], listSpells: () => [], listArmor: () => [], listWeapons: () => [],
    getItem: (kind, id) => (store[kind] && store[kind][id]) || null,
    getItemByName: byName,
    getRecords: (kind) => Object.values(store[kind] || {}),
  };
}
const withFake = () => dryRunRegister(register, META, { deps: { 'dnd55e-compendium': makeFake() } });

test('core-rules: provides a versioned rules API', () => {
  const { ok, rec, error } = dryRunRegister(register, META);
  assert.ok(ok, error);
  assert.ok(rec.provided && rec.provided.apiVersion === 1, 'apiVersion 1');
  assert.equal(typeof rec.provided.hydrate, 'function', 'hydrate()');
  assert.equal(typeof rec.provided.derive.proficiencyBonus, 'function', 'derive.proficiencyBonus()');
  assert.equal(typeof rec.provided.derive.maxHp, 'function', 'derive.maxHp()');
  assert.ok(rec.settingsTabs.length >= 1, 'a settings tab');
});

test('core-rules: universal math is correct, with or without compendium', () => {
  const { rec } = dryRunRegister(register, META);
  const { sheet, warnings } = rec.provided.hydrate({ abilities: { STR: 16, DEX: 14 }, level: 5, className: 'Wizard' });
  assert.equal(sheet.abilities.STR.mod, 3, 'STR 16 → +3');
  assert.equal(sheet.derived.proficiencyBonus, 3, 'level 5 → PB +3');
  assert.equal(sheet.derived.initiative, 2, 'DEX 14 → init +2');
  assert.ok(Array.isArray(warnings)); // no compendium → no class-lookup warning (data() is null)
});

test('core-rules: passes compendium data through + resolves the class record', () => {
  const { rec } = withFake();
  assert.ok(rec.provided.listClasses().length >= 3, 'passthrough listClasses');
  const { sheet } = rec.provided.hydrate({ className: 'Wizard', level: 1 });
  assert.equal(sheet.class?.id, 'wizard', 'resolves class via compendium');
  assert.equal(sheet.derived.hitDie, 'd6', 'pulls hitDie from the class record');
});

test('core-rules: derives HP / AC / saves / slots / mastery from content', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({
    abilities: { STR: 10, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 8 }, level: 5, className: 'Wizard',
  });
  assert.equal(sheet.derived.maxHp, 32, 'd6: 6 + 4×4 + CON(+2)×5 = 32');     // HP-1/HP-2
  assert.equal(sheet.hp.breakdown.dice, 22, 'HP breakdown: d6 max 6 + 4×4 avg = 22');
  assert.equal(sheet.hp.breakdown.conTotal, 10, 'HP breakdown: CON +2 × 5 levels');
  assert.equal(sheet.derived.armorClass, 12, 'no armor, no UD → 10 + DEX(+2)'); // AC-1
  assert.equal(sheet.saves.INT.total, 6, 'INT +3 + PB 3 (proficient)');         // PR-4
  assert.equal(sheet.saves.STR.proficient, false, 'STR not a wizard save');
  assert.equal(sheet.spellcasting.perClass[0].preparedLimit, 9, 'L5 wizard prepared');  // SP-2
  assert.equal(sheet.spellcasting.perClass[0].saveDC, 14, '8 + PB 3 + INT +3');          // SP-4
  assert.deepEqual(sheet.spellcasting.slots, [4, 3, 2], 'caster level 5 slots');         // MC-2
  assert.equal(sheet.weaponMastery.slots, 2, 'wizard weapon mastery');                   // EQ-4
});

test('core-rules: AC takes the best eligible base, armor beats Unarmored Defense', () => {
  const { rec } = withFake();
  const abilities = { STR: 14, DEX: 14, CON: 16, INT: 8, WIS: 10, CHA: 8 };
  const unarmored = rec.provided.hydrate({ abilities, level: 5, className: 'Barbarian' }).sheet;
  assert.equal(unarmored.derived.armorClass, 15, 'Unarmored Defense 10 + DEX(+2) + CON(+3)'); // AC-1
  const armored = rec.provided.hydrate({
    abilities, level: 5, className: 'Barbarian', inventory: [{ name: 'Breastplate', location: 'equipped' }],
  }).sheet;
  assert.equal(armored.derived.armorClass, 16, 'Breastplate 14 + DEX capped at 2'); // AC-2
});

test('core-rules: a third-caster subclass (classes[] shape) gets spells from the subclass', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({
    abilities: { INT: 14 }, classes: [{ classId: 'fighter', level: 3, subclass: 'eldritch-knight' }],
  });
  assert.equal(sheet.totalLevel, 3);
  assert.equal(sheet.spellcasting.perClass.length, 1, 'EK grants spellcasting');     // SP-8
  assert.equal(sheet.spellcasting.perClass[0].type, 'third');
  assert.equal(sheet.spellcasting.perClass[0].preparedLimit, 3);
  assert.deepEqual(sheet.spellcasting.slots, [2], 'caster level ⌊3/3⌋ = 1');           // MC-2
  assert.equal(sheet.weaponMastery.slots, 3, 'fighter mastery');
});

test('core-rules: applies resolved skill proficiencies + expertise', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({
    abilities: { DEX: 14, INT: 10 }, className: 'Wizard', level: 5,
    skillProficiencies: ['stealth'], skillExpertise: { stealth: true },
  });
  assert.equal(sheet.skills.stealth.proficient, true);
  assert.equal(sheet.skills.stealth.expertise, true);
  assert.equal(sheet.skills.stealth.total, 8, 'DEX +2 + 2×PB(3) expertise');   // PR-2
  assert.equal(sheet.skills.arcana.proficient, false, 'unchosen skill not proficient');
});

test('core-rules: applies ability grants over base scores, clamped to 20', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({
    baseStats: { STR: 15, CON: 13 }, className: 'Barbarian', level: 1,
    abilityGrants: [{ source: { type: 'background' }, assign: { STR: 2, CON: 1 } }],
  });
  assert.equal(sheet.abilities.STR.base, 15);
  assert.equal(sheet.abilities.STR.score, 17, '15 + 2 (background ASI)');   // AB-1
  assert.equal(sheet.abilities.STR.mod, 3);
  assert.equal(sheet.abilities.CON.score, 14, '13 + 1');
  const capped = rec.provided.hydrate({ baseStats: { STR: 19 }, abilityGrants: [{ assign: { STR: 4 } }], className: 'Barbarian' }).sheet;
  assert.equal(capped.abilities.STR.score, 20, 'clamped at 20');           // AB-2
});

test('core-rules: computes weapon attacks for equipped weapons (EQ-3/4/5)', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({
    abilities: { STR: 16, DEX: 14 }, className: 'Fighter', level: 1,
    inventory: [
      { id: 'w1', ref: 'longsword', location: 'equipped' },
      { id: 'w2', ref: 'dagger', location: 'ready', attuned: true },
      { id: 'w3', ref: 'longsword', location: 'pack' },     // stored → not an attack
    ],
    weaponMasteryChoices: ['longsword'],
  });
  const ls = sheet.weapons.find((x) => x.ref === 'longsword');
  assert.equal(ls.attackBonus, 5, 'STR +3 + PB +2 (proficient martial)');     // EQ-5
  assert.match(ls.damage, /1d8 \+3/, 'damage adds STR mod');
  assert.equal(ls.masteryActive, true, 'longsword is a chosen mastery');        // EQ-4
  assert.equal(sheet.weapons.filter((x) => x.ref === 'longsword').length, 1, 'pack copy excluded');  // EQ-2
  assert.equal(sheet.attunement.count, 1, 'one attuned item');                  // EQ-3
});

test('core-rules: grants always-prepared spells from subclass + feat (provenance)', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({
    abilities: { WIS: 14 }, classes: [{ classId: 'wizard', level: 5, subclass: 'life-domain' }],
    feats: [{ featId: 'fey-touched' }],
  });
  const g = sheet.spellcasting.granted;
  const bless = g.find((x) => x.ref === 'bless');
  assert.ok(bless && bless.alwaysPrepared && bless.source.type === 'subclass', 'subclass grants Bless always-prepared');  // SP-2/SP-12
  assert.equal(bless.name, 'Bless', 'resolves the spell name from the compendium');
  const misty = g.find((x) => x.ref === 'misty-step');
  assert.ok(misty && misty.source.type === 'feat', 'feat grants Misty Step');   // SP-1/SP-10
});

test('core-rules: species grants senses, resistances, and a per-level HP bonus', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({ abilities: { CON: 14 }, level: 5, className: 'Wizard', race: 'Dwarf' });
  assert.equal(sheet.senses.darkvision, 120, 'take-highest darkvision'); // SB-4
  assert.ok(sheet.resistances.includes('poison'));
  assert.equal(sheet.speed, 30);
  assert.equal(sheet.derived.maxHp, 37, '32 base + Dwarven Toughness (+1/level × 5)'); // HP-3
});

test('core-rules: caster surfaces per-level cantrips-known + prepared', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({ abilities: { INT: 16 }, className: 'Wizard', level: 5 });
  assert.equal(sheet.spellcasting.perClass[0].cantripsKnown, 4, 'L5 wizard cantrips');  // SP-7
  assert.equal(sheet.spellcasting.perClass[0].preparedLimit, 9, 'L5 wizard prepared');  // SP-2
});

test('core-rules: selected lineage applies senses / speed / per-level HP', () => {
  const { rec } = withFake();
  const drow = rec.provided.hydrate({ abilities: { CON: 12 }, className: 'Wizard', level: 5, race: 'Elf', lineage: 'drow' }).sheet;
  assert.equal(drow.senses.darkvision, 120, 'drow take-highest 60→120');           // SB-4
  const wood = rec.provided.hydrate({ className: 'Wizard', level: 1, race: 'Elf', lineage: 'wood-elf' }).sheet;
  assert.equal(wood.speed, 35, 'wood-elf +5 speed');                               // SB-3
  const hill = rec.provided.hydrate({ abilities: { CON: 14 }, className: 'Wizard', level: 5, race: 'Dwarf', lineage: 'hill-dwarf' }).sheet;
  assert.equal(hill.derived.maxHp, 42, '32 + (species 1 + lineage 1)/level × 5');  // HP-3
});

test('core-rules: lineage spells are level-gated + provenance-tagged', () => {
  const { rec } = withFake();
  const ids = (lvl) => rec.provided.hydrate({ className: 'Wizard', level: lvl, race: 'Elf', lineage: 'drow' }).sheet.spellcasting.granted.map((g) => g.ref);
  const l1 = ids(1);
  assert.ok(l1.includes('dancing-lights'), 'L0 cantrip granted at level 1');
  assert.ok(!l1.includes('faerie-fire') && !l1.includes('darkness'), 'higher-level lineage spells gated out');
  const l5 = rec.provided.hydrate({ className: 'Wizard', level: 5, race: 'Elf', lineage: 'drow' }).sheet.spellcasting.granted;
  assert.ok(l5.some((g) => g.ref === 'faerie-fire') && l5.some((g) => g.ref === 'darkness'), 'lineage spells unlock by level');
  assert.equal(l5.find((g) => g.ref === 'faerie-fire').source.type, 'species', 'tagged species provenance');
});

test('core-rules: a single-class half-caster uses its OWN slot table (2024 L1)', () => {
  const { rec } = withFake();
  const l1 = rec.provided.hydrate({ abilities: { CHA: 16 }, className: 'Paladin', level: 1 }).sheet;
  assert.deepEqual(l1.spellcasting.slots, [2], 'L1 paladin: two 1st-level slots (own table), not [] from floor');
  assert.equal(l1.spellcasting.perClass[0].preparedLimit, 2, 'and prepares 2');
  const l5 = rec.provided.hydrate({ abilities: { CHA: 16 }, className: 'Paladin', level: 5 }).sheet;
  assert.deepEqual(l5.spellcasting.slots, [4, 2], 'L5 paladin = 4× 1st, 2× 2nd');
});

test('core-rules: single-class half-caster reads printed slots at high levels (not the heuristic)', () => {
  const { rec } = withFake();
  // The combined-caster-level heuristic diverges from the printed Paladin table
  // at high levels (it would give L19 = [4,3,3,3,2]); the class table wins.
  const slots = (lvl) => rec.provided.hydrate({ abilities: { CHA: 16 }, className: 'Paladin', level: lvl }).sheet.spellcasting.slots;
  assert.deepEqual(slots(11), [4, 3, 3], 'Paladin L11 printed slots');
  assert.deepEqual(slots(17), [4, 3, 3, 1], 'Paladin L17 printed slots');
  assert.deepEqual(slots(19), [4, 3, 3, 1], 'Paladin L19 printed slots (= L20), NOT the heuristic [4,3,3,3,2]');
});

test('core-rules: single-class full-caster reads printed slots at high levels', () => {
  const { rec } = withFake();
  const slots = (lvl) => rec.provided.hydrate({ abilities: { INT: 16 }, className: 'Wizard', level: lvl }).sheet.spellcasting.slots;
  assert.deepEqual(slots(11), [4, 3, 3, 2, 1, 1], 'Wizard L11 printed slots');
  assert.deepEqual(slots(17), [4, 3, 3, 3, 2, 1, 1, 1, 1], 'Wizard L17 printed slots');
  assert.deepEqual(slots(19), [4, 3, 3, 3, 3, 1, 1, 1, 1], 'Wizard L19 printed slots');
});

test('core-rules: single-class caster falls back to the heuristic when content lacks spellSlots', () => {
  const { rec } = withFake();
  // Ranger ships no spellSlots in its progression → the engine must fall back to
  // the ceil(level/2) caster-level heuristic rather than returning [].
  const r5 = rec.provided.hydrate({ abilities: { WIS: 16 }, className: 'Ranger', level: 5 }).sheet;
  assert.deepEqual(r5.spellcasting.slots, [4, 2], 'L5 ranger via heuristic (ceil(5/2)=3 → [4,2])');
  assert.ok(r5.spellcasting.slots.length > 0, 'heuristic never yields empty slots for an odd-level half-caster');
});

test('core-rules: multiclassing two half-casters double-rounds (stingier than single)', () => {
  const { rec } = withFake();
  const mc = rec.provided.hydrate({ classes: [{ classId: 'paladin', level: 5 }, { classId: 'ranger', level: 5 }] }).sheet;
  assert.deepEqual(mc.spellcasting.slots, [4, 3], 'Pal5/Ran5 → floor(5/2)+floor(5/2)=4 combined → [4,3]');  // MC-2
  const solo = rec.provided.hydrate({ classes: [{ classId: 'paladin', level: 10 }] }).sheet;
  assert.deepEqual(solo.spellcasting.slots, [4, 3, 2], 'but single Paladin 10 keeps its own table');
});

test('core-rules: choose-grants resolve picks + expose pending choices (SP-10)', () => {
  const { rec } = withFake();
  // Magic Initiate (2 cantrips + 1 spell). No picks → 2 pending choices, nothing granted from it.
  const empty = rec.provided.hydrate({ className: 'Wizard', level: 5, feats: [{ featId: 'magic-initiate' }] }).sheet;
  const pc = empty.spellcasting.pendingChoices;
  assert.equal(pc.length, 2, 'two choose-grants pending (cantrips + spell)');
  const cantrips = pc.find((x) => x.spellLevel === 0);
  assert.equal(cantrips.choose, 2, 'choose 2 cantrips');
  assert.ok(cantrips.key.startsWith('feat:magic-initiate:'), 'key carries source + grant id');
  assert.ok(!empty.spellcasting.granted.some((g) => g.source.id === 'magic-initiate'), 'nothing granted until picked');
  // With picks → granted; over-picking is capped to `choose`.
  const picked = rec.provided.hydrate({
    className: 'Wizard', level: 5, feats: [{ featId: 'magic-initiate' }],
    grantChoices: { [cantrips.key]: ['dancing-lights', 'druidcraft', 'faerie-fire'] },
  }).sheet;
  const got = picked.spellcasting.granted.filter((x) => x.source.id === 'magic-initiate');
  assert.equal(got.length, 2, 'capped to the choose count (3 picks → 2 granted)');
  assert.deepEqual(got.map((x) => x.ref), ['dancing-lights', 'druidcraft'], 'first picks granted, provenance feat');
  assert.equal(picked.spellcasting.pendingChoices.find((x) => x.key === cantrips.key).picked.length, 2, 'picks reflected (capped)');
});

test('core-rules: a feat with hpPerLevel (Tough) raises max HP', () => {
  const { rec } = withFake();
  const base = rec.provided.hydrate({ abilities: { CON: 14 }, className: 'Wizard', level: 5 }).sheet.derived.maxHp;
  const tough = rec.provided.hydrate({ abilities: { CON: 14 }, className: 'Wizard', level: 5, feats: [{ featId: 'tough' }] }).sheet.derived.maxHp;
  assert.equal(tough - base, 10, 'Tough = +2/level × 5');
});

test('core-rules: first character level gets the max hit die; later levels average (HP-1)', () => {
  const { rec } = withFake();
  // Single-class Fighter L1 (d10), CON 10 → +0, no species: max d10 = 10.
  const single = rec.provided.hydrate({
    abilities: { CON: 10 }, classes: [{ classId: 'fighter', level: 1 }],
  }).sheet.derived.maxHp;
  assert.equal(single, 10, 'single-class L1 Fighter → max d10 = 10');

  // Multiclass: the FIRST entry's level takes the max die; the rest average.
  // Fighter first (max d10=10) + Wizard L1 (avg d6=4) = 14.
  const fighterFirst = rec.provided.hydrate({
    abilities: { CON: 10 }, classes: [{ classId: 'fighter', level: 1 }, { classId: 'wizard', level: 1 }],
  }).sheet.derived.maxHp;
  assert.equal(fighterFirst, 14, 'Fighter first (max d10=10) + Wizard (avg d6=4) = 14');

  // Wizard first (max d6=6) + Fighter (avg d10=6) = 12 — the first entry takes the max die.
  const wizardFirst = rec.provided.hydrate({
    abilities: { CON: 10 }, classes: [{ classId: 'wizard', level: 1 }, { classId: 'fighter', level: 1 }],
  }).sheet.derived.maxHp;
  assert.equal(wizardFirst, 12, 'Wizard first (max d6=6) + Fighter (avg d10=6) = 12');
});

test('core-rules: AC never drops below the 10+DEX unarmored floor for a malformed armor record (AC-1)', () => {
  const { rec } = withFake();
  const abilities = { DEX: 14, CON: 10 };  // +2 DEX → floor 12
  const bad = rec.provided.hydrate({
    abilities, level: 1, className: 'Fighter',
    inventory: [{ name: 'Broken Plate', location: 'equipped' }],
  }).sheet;
  assert.equal(bad.derived.armorClass, 12, 'garbage baseAC -5 is floored at unarmored 10+DEX(+2)');
  assert.ok(bad.ac.candidates.some((c) => c.id === 'unarmored'), 'unarmored candidate always present');
});

test('core-rules: martial-finesse-or-light proficiency covers only finesse/light martials (PR-5)', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({
    abilities: { STR: 12, DEX: 16 }, className: 'Rogue', level: 1,
    inventory: [
      { id: 'w1', ref: 'rapier', location: 'equipped' },      // martial + finesse → proficient
      { id: 'w2', ref: 'greatsword', location: 'equipped' },  // martial, heavy/two-handed → NOT proficient
      { id: 'w3', ref: 'dagger', location: 'ready' },         // simple → proficient (subset grants simple)
    ],
  });
  const rapier = sheet.weapons.find((w) => w.ref === 'rapier');
  const greatsword = sheet.weapons.find((w) => w.ref === 'greatsword');
  const dagger = sheet.weapons.find((w) => w.ref === 'dagger');
  assert.equal(rapier.proficient, true, 'finesse martial is proficient');
  assert.equal(greatsword.proficient, false, 'non-finesse/non-light martial is NOT proficient');
  assert.equal(dagger.proficient, true, 'simple weapon proficient (subset includes simple)');
  // Proficiency shows in the attack bonus: rapier uses DEX(+3) + PB(+2) = 5; the
  // greatsword (STR +1, not proficient) is just +1.
  assert.equal(rapier.attackBonus, 5, 'DEX +3 + PB +2');
  assert.equal(greatsword.attackBonus, 1, 'STR +1, no PB (not proficient)');
});

test('core-rules: saveProf manually unions extra saving-throw proficiencies (PR-4)', () => {
  const { rec } = withFake();
  // Wizard saves are INT/WIS; a manual saveProf adds STR on top of the class set.
  const { sheet } = rec.provided.hydrate({
    abilities: { STR: 14, INT: 16 }, className: 'Wizard', level: 5, saveProf: { STR: true },
  });
  assert.equal(sheet.saves.STR.proficient, true, 'manual STR save proficiency unions in');
  assert.equal(sheet.saves.STR.total, 5, 'STR +2 + PB 3 (now proficient)');
  assert.equal(sheet.saves.INT.proficient, true, 'class INT save still proficient');
  assert.equal(sheet.saves.DEX.proficient, false, 'untouched save stays non-proficient');
});

test('core-rules: expertise on a non-proficient skill is ignored (PR-2)', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({
    abilities: { DEX: 14 }, className: 'Wizard', level: 5,
    skillExpertise: { acrobatics: true },   // acrobatics is NOT proficient
  });
  assert.equal(sheet.skills.acrobatics.proficient, false, 'not proficient');
  assert.equal(sheet.skills.acrobatics.expertise, false, 'expertise ignored without proficiency');
  assert.equal(sheet.proficiencies.skills.acrobatics, 'none', 'reported as none');
  assert.equal(sheet.skills.acrobatics.total, 2, 'just the DEX mod, no PB doubling');
});

test('core-rules: progression lookup above the seed cap returns the highest row ≤ level', () => {
  const { rec } = withFake();
  // Ranger progression rows stop at L10; querying L15 must use the L10 row
  // (preparedSpells 8), not return null / the L1 row.
  const r15 = rec.provided.hydrate({ abilities: { WIS: 16 }, className: 'Ranger', level: 15 }).sheet;
  assert.equal(r15.spellcasting.perClass[0].preparedLimit, 8, 'L15 ranger uses the L10 cap row (highest ≤ 15)');
});

test('core-rules: emits pools + hit dice + slots + charges with structured recharge (FE-2/FE-3)', () => {
  const { rec } = withFake();
  const s1 = rec.provided.hydrate({ abilities: { CHA: 16 }, className: 'Barbarian', level: 1 }).sheet;
  const R = (s, k) => (s.resources || []).find((r) => r.key === k);
  // Pools — progression / per-level / ability-mod maxes; recharge normalized.
  assert.equal(R(s1, 'rage').max, 2, 'L1 Rage max = 2 (progression)');
  assert.equal(R(s1, 'rage').kind, 'pool');
  assert.deepEqual(R(s1, 'rage').recharge, [{ on: 'long', amount: 'full' }], 'string recharge → full-on-long');
  assert.deepEqual(R(s1, 'insp').recharge, [{ on: 'short', amount: 1 }, { on: 'long', amount: 'full' }], 'array recharge kept');
  assert.equal(R(s1, 'pool').max, 5, 'per-level 5×1');
  assert.equal(R(s1, 'insp').max, 3, 'abilityMod CHA 16 → +3');
  // Hit dice — aggregated by die, half-level long-rest regain.
  const hd = R(s1, 'hit-dice-d12');
  assert.ok(hd && hd.kind === 'hitdice' && hd.max === 1 && hd.die === 'd12', 'L1: 1× d12 hit die');
  assert.deepEqual(hd.recharge, [{ on: 'long', amount: 'halfLevel' }]);
  const s6 = rec.provided.hydrate({ abilities: { CHA: 8 }, className: 'Barbarian', level: 6 }).sheet;
  assert.equal(R(s6, 'rage').max, 4, 'L6 Rage = 4');
  assert.equal(R(s6, 'hit-dice-d12').max, 6, 'L6 → 6 hit dice');
  assert.equal(R(s6, 'insp').max, 1, 'CHA 8 (−1) floored to min 1');
  // Spell slots — one resource per level, full on long rest; no class pools.
  const wiz = rec.provided.hydrate({ abilities: { INT: 16 }, className: 'Wizard', level: 5 }).sheet;
  const slot1 = R(wiz, 'slot-1');
  assert.ok(slot1 && slot1.kind === 'slot' && slot1.max === 4, 'wizard L5 → 1st-level slots (4)');
  assert.deepEqual(slot1.recharge, [{ on: 'long', amount: 'full' }]);
  assert.ok(wiz.resources.some((r) => r.kind === 'hitdice'), 'wizard emits hit dice');
  assert.ok(!wiz.resources.some((r) => r.kind === 'pool'), 'wizard has no class pools');
  // Charge — a feat free-cast (Fey Touched: Misty Step, 1/long).
  const ft = rec.provided.hydrate({ abilities: { INT: 14 }, className: 'Wizard', level: 5, feats: [{ featId: 'fey-touched' }] }).sheet;
  const ch = (ft.resources || []).find((r) => r.kind === 'charge');
  assert.ok(ch && ch.max === 1, 'feat free-cast → a charge (max 1)');
  assert.deepEqual(ch.recharge, [{ on: 'long', amount: 'full' }], '1/long → full-on-long');
});

test('core-rules: subclass resources are emitted, resolved at the class level (FE-2)', () => {
  const { rec } = withFake();
  const s = rec.provided.hydrate({ classes: [{ classId: 'fighter', level: 7, subclass: 'eldritch-knight' }] }).sheet;
  const r = (s.resources || []).find((x) => x.key === 'ek-pool');
  assert.ok(r, 'subclass classResources are emitted alongside class ones');
  assert.equal(r.max, 3, 'resolved at the class level (7 → progression row 7 → 3)');
  assert.equal(r.source.type, 'subclass', 'tagged with subclass provenance');
});

test('core-rules: renderers survive the smoke pass', () => {
  const { rec } = dryRunRegister(register, META);
  assert.ok(smokeRegistrations(rec).ok, JSON.stringify(smokeRegistrations(rec).failures));
});

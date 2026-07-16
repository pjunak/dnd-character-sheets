// Self-test for the BUILT-IN rules engine (rules/engine.js + rules/api.js —
// merged from the retired dnd55e-core-rules addon), driven through the sheets
// addon's real register(): `rec.provided` is the rules api this addon
// provide()s for other addons, identical to the one the panels consume.
// Run: node --test tests/rules.mjs  (assumes ttrpg-codex is a sibling checkout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dryRunRegister, smokeRegistrations } from '../../ttrpg-codex/web/js/addon-test-harness.mjs';
import register from '../entry.js';
import { makeFake } from './fake-phb.mjs';
import { makeEngine } from '../model.js';

const META = {
  id: 'dnd55e-sheets',
  permissions: ['ui:override', 'ui:action', 'ui:settings-tab', 'data:read:characters', 'data:write:characters.addonData'],
  optionalDependencies: { 'dnd55e-compendium': { range: '>=0.1.0' } },
};

const withFake = () => dryRunRegister(register, META, { deps: { 'dnd55e-compendium': makeFake() } });

test('rules: feature-record grants expand fromCategory into pool choices', () => {
  const fake = makeFake();
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const model = makeEngine({ num, host: {}, NS: 'x', ABILITIES: [], SKILLS: [], abilityMod: () => 0, sheetOf: () => ({}) });
  const choices = model.collectChoices([{ classId: 'sorcerer', level: 2, subclass: '' }], fake);
  const mm = choices.find((c) => c.id === 'metamagic');
  assert.ok(mm, 'metamagic choice collected from the feature record grants');
  assert.equal(mm.kind, 'enumerated');
  assert.equal(mm.from.length, 2, 'fromCategory expanded to the 2 metamagic options');
  assert.ok(mm.from.includes('metamagic-twinned-spell'), 'options are feature ids');
  // level gating: no metamagic choice at sorcerer level 1
  assert.ok(!model.collectChoices([{ classId: 'sorcerer', level: 1, subclass: '' }], fake).find((c) => c.id === 'metamagic'), 'level-gated');
});

test('rules: option-pool count grows with level (countByLevel)', () => {
  const fake = makeFake();
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const model = makeEngine({ num, host: {}, NS: 'x', ABILITIES: [], SKILLS: [], abilityMod: () => 0, sheetOf: () => ({}) });
  const at = (lvl) => model.collectChoices([{ classId: 'sorcerer', level: lvl, subclass: '' }], fake).find((c) => c.id === 'metamagic');
  assert.equal(at(2).count, 2, 'L2 → 2 metamagic options known');
  assert.equal(at(9).count, 2, 'L9 → still 2 (before the L10 step)');
  assert.equal(at(10).count, 4, 'L10 → 4');
  assert.equal(at(17).count, 6, 'L17 → 6');
});

test('rules: ASI-opportunity levels are per-class and include class extras (B4.0 item 3)', () => {
  const fake = makeFake();
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const model = makeEngine({ num, host: {}, NS: 'x', ABILITIES: [], SKILLS: [], abilityMod: () => 0, sheetOf: () => ({}) });
  // Per-class timing: Fighter 4 / Wizard 1 → Fighter's L4 ASI, nothing for the L1 Wizard.
  const mc = model.collectChoices([{ classId: 'fighter', level: 4, subclass: '' }, { classId: 'wizard', level: 1, subclass: '' }], fake).filter((c) => c.kind === 'asiMode');
  assert.ok(mc.some((c) => c.id === 'asi:fighter:4'), 'Fighter L4 ASI present (per-class, not character-level)');
  assert.ok(!mc.some((c) => c.id.startsWith('asi:wizard')), 'the level-1 Wizard contributes no ASI');
  // Class extras come from the class progression: a mock class declaring ASI at 6 & 14.
  const withProg = { getItem: (k, id) => (k === 'class' && id === 'ftr') ? { id: 'ftr', name: 'F', progression: [{ level: 6, features: ['Ability Score Improvement'] }, { level: 14, features: ['Ability Score Improvement'] }] } : null, getItemByName: () => null, listFeatures: () => [] };
  const lv = model.collectChoices([{ classId: 'ftr', level: 20, subclass: '' }], withProg).filter((c) => c.kind === 'asiMode').map((c) => c.level);
  assert.ok(lv.includes(6) && lv.includes(14), 'progression-declared extra ASIs (Fighter 6 & 14) are included');
  assert.ok([4, 8, 12, 16, 19].every((l) => lv.includes(l)), 'base ASI levels still present (union — no regression)');
});

test('rules: reconcile drops orphaned choices + ability grants after a structural change (B4.0 item 4)', () => {
  const fake = makeFake();
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const model = makeEngine({ num, host: {}, NS: 'x', ABILITIES: [], SKILLS: [], abilityMod: () => 0, sheetOf: () => ({}) });
  // Was Fighter 8 (ASI at 4 & 8), picked +2 CHA at L8; then dropped to Fighter 4.
  const s = {
    classes: [{ classId: 'fighter', level: 4, subclass: '' }],
    featureChoices: { 'asi:fighter:4': 'asi', 'asi:fighter:4:ability': 'STR', 'asi:fighter:8': 'asi', 'asi:fighter:8:ability': 'CHA' },
    abilityGrants: [
      { id: 'asi:fighter:4:ability', source: { type: 'asi' }, assign: { STR: 2 } },
      { id: 'asi:fighter:8:ability', source: { type: 'asi' }, assign: { CHA: 2 } },
    ],
  };
  model.reconcile(s, fake);
  assert.ok(s.abilityGrants.some((g) => g.id === 'asi:fighter:4:ability'), 'the valid L4 grant is kept');
  assert.ok(!s.abilityGrants.some((g) => g.id === 'asi:fighter:8:ability'), 'the orphaned L8 grant is pruned (no phantom +2 CHA)');
  assert.ok(s.featureChoices['asi:fighter:4'], 'the valid L4 choice is kept');
  assert.ok(!s.featureChoices['asi:fighter:8'], 'the orphaned L8 choice is pruned');
});

test('rules: a half-feat ability pick bumps the score (B4.0 item 2 / AB-2)', () => {
  const { rec } = withFake();
  // A multi-option half-feat's chosen +1 reaches the engine as a feat-type abilityGrant.
  const sheet = rec.provided.hydrate({ baseStats: { INT: 15 }, className: 'Wizard',
    abilityGrants: [{ id: 'asi:wizard:4:featability', source: { type: 'feat' }, assign: { INT: 1 } }] }).sheet;
  assert.equal(sheet.abilities.INT.score, 16, '15 + 1 (half-feat ability pick applied)');
});

test('rules: per-class prepared spell level is capped by that class in a multiclass (B4.2)', () => {
  const { rec } = withFake();
  const sc = rec.provided.hydrate({ classes: [
    { classId: 'wizard', level: 5, subclass: '' },
    { classId: 'paladin', level: 2, subclass: '' },
  ] }).sheet.spellcasting;
  const wiz = sc.perClass.find((p) => p.classId === 'wizard');
  const pal = sc.perClass.find((p) => p.classId === 'paladin');
  assert.equal(wiz.maxSpellLevel, 3, 'Wizard 5 prepares up to 3rd-level spells');
  assert.equal(pal.maxSpellLevel, 1, 'Paladin 2 caps at 1st-level (NOT the combined pool max)');
  assert.ok(sc.slots.length >= 3, 'the combined slot pool still reaches 3rd level');
});

test('rules: Warlock Pact Magic — short-rest slots, own level cap, no slot combine (B4.3)', () => {
  const { rec } = withFake();
  const sheet = rec.provided.hydrate({ classes: [{ classId: 'warlock', level: 5, subclass: '' }] }).sheet;
  const wl = sheet.spellcasting.perClass.find((p) => p.classId === 'warlock');
  assert.deepEqual(wl.pact, { slots: 2, level: 3 }, 'L5 Warlock → 2 pact slots at 3rd level');
  assert.equal(wl.maxSpellLevel, 3, 'the prepare cap follows the pact slot level');
  assert.deepEqual(sheet.spellcasting.slots, [], 'no standard Spellcasting slots (Pact Magic is separate)');
  const res = (sheet.resources || []).find((r) => r.key === 'pact-slot');
  assert.ok(res && res.max === 2, 'a pact-slot resource is emitted (max 2)');
  assert.equal(res.recharge[0].on, 'short', 'pact slots recharge on a SHORT rest');
});

test('rules: a pact class printing pact slots as spellSlots never double-counts them (B4.3 guard)', () => {
  // Some books print the Warlock's pact-slot column as `progression[].spellSlots`.
  // Reading that as LEVELED Spellcasting slots would double-count (pactMagic
  // already emits the pact pool), so the single-caster ownSlots path skips pact.
  const fake = makeFake();
  fake.getItem('class', 'warlock').progression[0].spellSlots = [1];
  const { rec } = dryRunRegister(register, META, { deps: { 'dnd55e-compendium': fake } });
  const sheet = rec.provided.hydrate({ classes: [{ classId: 'warlock', level: 1 }] }).sheet;
  assert.deepEqual(sheet.spellcasting.slots, [], 'printed pact slots do NOT become leveled Spellcasting slots');
  assert.deepEqual(sheet.spellcasting.perClass[0].pact, { slots: 1, level: 1 }, 'the pact pool is still emitted once');
  assert.equal((sheet.resources || []).filter((r) => r.kind === 'slot').length, 1, 'exactly ONE slot resource (the pact pool)');
});

test('rules: provides a versioned rules API', () => {
  const { ok, rec, error } = dryRunRegister(register, META);
  assert.ok(ok, error);
  assert.ok(rec.provided && rec.provided.apiVersion === 1, 'apiVersion 1');
  assert.equal(typeof rec.provided.hydrate, 'function', 'hydrate()');
  assert.equal(typeof rec.provided.derive.proficiencyBonus, 'function', 'derive.proficiencyBonus()');
  assert.equal(typeof rec.provided.derive.maxHp, 'function', 'derive.maxHp()');
  assert.equal(rec.settingsTabs.length, 0, 'no host settings tab — sheet options live on the sheet\'s own ⚙ tab');
});

test('rules: universal math is correct, with or without compendium', () => {
  const { rec } = dryRunRegister(register, META);
  const { sheet, warnings } = rec.provided.hydrate({ abilities: { STR: 16, DEX: 14 }, level: 5, className: 'Wizard' });
  assert.equal(sheet.abilities.STR.mod, 3, 'STR 16 → +3');
  assert.equal(sheet.derived.proficiencyBonus, 3, 'level 5 → PB +3');
  assert.equal(sheet.derived.initiative, 2, 'DEX 14 → init +2');
  assert.ok(Array.isArray(warnings)); // no compendium → no class-lookup warning (data() is null)
});

test('rules: passes compendium data through + resolves the class record', () => {
  const { rec } = withFake();
  assert.ok(rec.provided.listClasses().length >= 3, 'passthrough listClasses');
  const { sheet } = rec.provided.hydrate({ className: 'Wizard', level: 1 });
  assert.equal(sheet.class?.id, 'wizard', 'resolves class via compendium');
  assert.equal(sheet.derived.hitDie, 'd6', 'pulls hitDie from the class record');
});

test('rules: derives HP / AC / saves / slots / mastery from content', () => {
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
  assert.equal(sheet.spellcasting.perClass[0].prepares, 'spellbook', 'wizard prepares from a spellbook');   // SP-5
  assert.equal(sheet.spellcasting.perClass[0].spellbookKnown, 14, 'L5 wizard learns 6 + 2×4 = 14 free');    // SP-5
  assert.equal(sheet.spellcasting.perClass[0].level, 5, 'perClass carries the class level');
  assert.equal(sheet.weaponMastery.slots, 2, 'wizard weapon mastery');                   // EQ-4
});

test('rules: AC takes the best eligible base, armor beats Unarmored Defense', () => {
  const { rec } = withFake();
  const abilities = { STR: 14, DEX: 14, CON: 16, INT: 8, WIS: 10, CHA: 8 };
  const unarmored = rec.provided.hydrate({ abilities, level: 5, className: 'Barbarian' }).sheet;
  assert.equal(unarmored.derived.armorClass, 15, 'Unarmored Defense 10 + DEX(+2) + CON(+3)'); // AC-1
  const armored = rec.provided.hydrate({
    abilities, level: 5, className: 'Barbarian', inventory: [{ name: 'Breastplate', location: 'equipped' }],
  }).sheet;
  assert.equal(armored.derived.armorClass, 16, 'Breastplate 14 + DEX capped at 2'); // AC-2
});

test('rules: a third-caster subclass (classes[] shape) gets spells from the subclass', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({
    abilities: { INT: 14 }, classes: [{ classId: 'fighter', level: 3, subclass: 'eldritch-knight' }],
  });
  assert.equal(sheet.totalLevel, 3);
  assert.equal(sheet.spellcasting.perClass.length, 1, 'EK grants spellcasting');     // SP-8
  assert.equal(sheet.spellcasting.perClass[0].type, 'third');
  assert.equal(sheet.spellcasting.perClass[0].preparedLimit, 3);
  assert.equal(sheet.spellcasting.perClass[0].prepares, 'list', 'EK prepares from the list, not a spellbook');  // SP-5
  assert.equal(sheet.spellcasting.perClass[0].spellbookKnown, 0, 'non-spellbook caster: no book allotment');    // SP-5
  assert.deepEqual(sheet.spellcasting.slots, [2], 'caster level ⌊3/3⌋ = 1');           // MC-2
  assert.equal(sheet.weaponMastery.slots, 3, 'fighter mastery');
});

test('rules: applies resolved skill proficiencies + expertise', () => {
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

test('rules: applies ability grants over base scores, clamped to 20', () => {
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

test('rules: a cap-raising grant (Epic Boon) pushes past 20 — hard ceiling 30, per-ability (AB-4)', () => {
  const { rec } = withFake();
  // 2024 Epic Boon: "+1, to a maximum of 30" — the grant carries cap:30.
  const boon = rec.provided.hydrate({ baseStats: { INT: 20 }, className: 'Wizard',
    abilityGrants: [{ id: 'asi:wizard:19:featability', source: { type: 'feat' }, assign: { INT: 1 }, cap: 30 }] }).sheet;
  assert.equal(boon.abilities.INT.score, 21, 'the boon +1 lands above 20');
  assert.equal(boon.abilities.INT.mod, 5, 'INT 21 → +5');
  const plain = rec.provided.hydrate({ baseStats: { INT: 20 }, className: 'Wizard',
    abilityGrants: [{ id: 'x', source: { type: 'feat' }, assign: { INT: 1 } }] }).sheet;
  assert.equal(plain.abilities.INT.score, 20, 'a cap-less grant still clamps at 20');
  const wild = rec.provided.hydrate({ baseStats: { STR: 28 }, className: 'Wizard',
    abilityGrants: [{ id: 'x', assign: { STR: 5 }, cap: 99 }] }).sheet;
  assert.equal(wild.abilities.STR.score, 30, 'nothing exceeds 30 (the 2024 absolute max)');
  const scoped = rec.provided.hydrate({ baseStats: { INT: 20, WIS: 22 }, className: 'Wizard',
    abilityGrants: [{ id: 'x', assign: { INT: 1 }, cap: 30 }] }).sheet;
  assert.equal(scoped.abilities.WIS.score, 20, 'the raised cap applies ONLY to abilities that grant touches');
});

test('rules: computes weapon attacks for equipped weapons (EQ-3/4/5)', () => {
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

test('rules: grants always-prepared spells from subclass + feat (provenance)', () => {
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

test('rules: species grants senses, resistances, and a per-level HP bonus', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({ abilities: { CON: 14 }, level: 5, className: 'Wizard', race: 'Dwarf' });
  assert.equal(sheet.senses.darkvision, 120, 'take-highest darkvision'); // SB-4
  assert.ok(sheet.resistances.includes('poison'));
  assert.equal(sheet.speed, 30);
  assert.equal(sheet.derived.maxHp, 37, '32 base + Dwarven Toughness (+1/level × 5)'); // HP-3
});

test('rules: caster surfaces per-level cantrips-known + prepared', () => {
  const { rec } = withFake();
  const { sheet } = rec.provided.hydrate({ abilities: { INT: 16 }, className: 'Wizard', level: 5 });
  assert.equal(sheet.spellcasting.perClass[0].cantripsKnown, 4, 'L5 wizard cantrips');  // SP-7
  assert.equal(sheet.spellcasting.perClass[0].preparedLimit, 9, 'L5 wizard prepared');  // SP-2
});

test('rules: selected lineage applies senses / speed / per-level HP', () => {
  const { rec } = withFake();
  const drow = rec.provided.hydrate({ abilities: { CON: 12 }, className: 'Wizard', level: 5, race: 'Elf', lineage: 'drow' }).sheet;
  assert.equal(drow.senses.darkvision, 120, 'drow take-highest 60→120');           // SB-4
  const wood = rec.provided.hydrate({ className: 'Wizard', level: 1, race: 'Elf', lineage: 'wood-elf' }).sheet;
  assert.equal(wood.speed, 35, 'wood-elf +5 speed');                               // SB-3
  const hill = rec.provided.hydrate({ abilities: { CON: 14 }, className: 'Wizard', level: 5, race: 'Dwarf', lineage: 'hill-dwarf' }).sheet;
  assert.equal(hill.derived.maxHp, 42, '32 + (species 1 + lineage 1)/level × 5');  // HP-3
});

test('rules: lineage spells are level-gated + provenance-tagged', () => {
  const { rec } = withFake();
  const ids = (lvl) => rec.provided.hydrate({ className: 'Wizard', level: lvl, race: 'Elf', lineage: 'drow' }).sheet.spellcasting.granted.map((g) => g.ref);
  const l1 = ids(1);
  assert.ok(l1.includes('dancing-lights'), 'L0 cantrip granted at level 1');
  assert.ok(!l1.includes('faerie-fire') && !l1.includes('darkness'), 'higher-level lineage spells gated out');
  const l5 = rec.provided.hydrate({ className: 'Wizard', level: 5, race: 'Elf', lineage: 'drow' }).sheet.spellcasting.granted;
  assert.ok(l5.some((g) => g.ref === 'faerie-fire') && l5.some((g) => g.ref === 'darkness'), 'lineage spells unlock by level');
  assert.equal(l5.find((g) => g.ref === 'faerie-fire').source.type, 'species', 'tagged species provenance');
});

test('rules: a single-class half-caster uses its OWN slot table (2024 L1)', () => {
  const { rec } = withFake();
  const l1 = rec.provided.hydrate({ abilities: { CHA: 16 }, className: 'Paladin', level: 1 }).sheet;
  assert.deepEqual(l1.spellcasting.slots, [2], 'L1 paladin: two 1st-level slots (own table), not [] from floor');
  assert.equal(l1.spellcasting.perClass[0].preparedLimit, 2, 'and prepares 2');
  const l5 = rec.provided.hydrate({ abilities: { CHA: 16 }, className: 'Paladin', level: 5 }).sheet;
  assert.deepEqual(l5.spellcasting.slots, [4, 2], 'L5 paladin = 4× 1st, 2× 2nd');
});

test('rules: single-class half-caster reads printed slots at high levels (not the heuristic)', () => {
  const { rec } = withFake();
  // The combined-caster-level heuristic diverges from the printed Paladin table
  // at high levels (it would give L19 = [4,3,3,3,2]); the class table wins.
  const slots = (lvl) => rec.provided.hydrate({ abilities: { CHA: 16 }, className: 'Paladin', level: lvl }).sheet.spellcasting.slots;
  assert.deepEqual(slots(11), [4, 3, 3], 'Paladin L11 printed slots');
  assert.deepEqual(slots(17), [4, 3, 3, 1], 'Paladin L17 printed slots');
  assert.deepEqual(slots(19), [4, 3, 3, 1], 'Paladin L19 printed slots (= L20), NOT the heuristic [4,3,3,3,2]');
});

test('rules: single-class full-caster reads printed slots at high levels', () => {
  const { rec } = withFake();
  const slots = (lvl) => rec.provided.hydrate({ abilities: { INT: 16 }, className: 'Wizard', level: lvl }).sheet.spellcasting.slots;
  assert.deepEqual(slots(11), [4, 3, 3, 2, 1, 1], 'Wizard L11 printed slots');
  assert.deepEqual(slots(17), [4, 3, 3, 3, 2, 1, 1, 1, 1], 'Wizard L17 printed slots');
  assert.deepEqual(slots(19), [4, 3, 3, 3, 3, 1, 1, 1, 1], 'Wizard L19 printed slots');
});

test('rules: single-class caster falls back to the heuristic when content lacks spellSlots', () => {
  const { rec } = withFake();
  // Ranger ships no spellSlots in its progression → the engine must fall back to
  // the ceil(level/2) caster-level heuristic rather than returning [].
  const r5 = rec.provided.hydrate({ abilities: { WIS: 16 }, className: 'Ranger', level: 5 }).sheet;
  assert.deepEqual(r5.spellcasting.slots, [4, 2], 'L5 ranger via heuristic (ceil(5/2)=3 → [4,2])');
  assert.ok(r5.spellcasting.slots.length > 0, 'heuristic never yields empty slots for an odd-level half-caster');
});

test('rules: multiclassing half-casters round UP per class (2024 change)', () => {
  const { rec } = withFake();
  // 2024 PHB Multiclassing, Spell Slots: "Half your levels (round up) in the
  // Paladin and Ranger classes" — 2014 rounded down; 2024 half-casters cast
  // from level 1, so each odd-level half-caster contributes the extra level.
  const mc = rec.provided.hydrate({ classes: [{ classId: 'paladin', level: 5 }, { classId: 'ranger', level: 5 }] }).sheet;
  assert.deepEqual(mc.spellcasting.slots, [4, 3, 3], 'Pal5/Ran5 → ceil(5/2)+ceil(5/2)=6 combined → [4,3,3]');  // MC-2
  const solo = rec.provided.hydrate({ classes: [{ classId: 'paladin', level: 10 }] }).sheet;
  assert.deepEqual(solo.spellcasting.slots, [4, 3, 2], 'single Paladin 10 keeps its own table');
  // Even-level halves are unchanged by the rounding direction.
  const even = rec.provided.hydrate({ classes: [{ classId: 'paladin', level: 4 }, { classId: 'ranger', level: 4 }] }).sheet;
  assert.deepEqual(even.spellcasting.slots, [4, 3], 'Pal4/Ran4 → 2+2=4 combined → [4,3]');
});

test('rules: choose-grants resolve picks + expose pending choices (SP-10)', () => {
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

test('rules: a feat with hpPerLevel (Tough) raises max HP', () => {
  const { rec } = withFake();
  const base = rec.provided.hydrate({ abilities: { CON: 14 }, className: 'Wizard', level: 5 }).sheet.derived.maxHp;
  const tough = rec.provided.hydrate({ abilities: { CON: 14 }, className: 'Wizard', level: 5, feats: [{ featId: 'tough' }] }).sheet.derived.maxHp;
  assert.equal(tough - base, 10, 'Tough = +2/level × 5');
});

test('rules: first character level gets the max hit die; later levels average (HP-1)', () => {
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

test('rules: an empty class-roster row (no class picked yet) contributes nothing', () => {
  const { rec } = withFake();
  // The Builder's "＋ Add class" placeholder ({classId:''}) must not add a
  // phantom level (avg-d8 HP, PB scaling) while the player hasn't picked yet.
  const cd = { abilities: { CON: 14 }, classes: [{ classId: 'wizard', level: 3, subclass: '' }] };
  const base = rec.provided.hydrate(cd).sheet;
  const withBlank = rec.provided.hydrate({ ...cd, classes: cd.classes.concat([{ classId: '', level: 1, subclass: '' }]) }).sheet;
  assert.equal(withBlank.totalLevel, base.totalLevel, 'total level unchanged by a placeholder row');
  assert.equal(withBlank.derived.maxHp, base.derived.maxHp, 'max HP unchanged by a placeholder row');
  assert.equal(withBlank.derived.proficiencyBonus, base.derived.proficiencyBonus, 'PB unchanged by a placeholder row');
  assert.equal(withBlank.classes.length, 1, 'the resolved class list skips the placeholder');
  // All-placeholder roster (a brand-new engine-mode character): nothing computed yet.
  const blank = rec.provided.hydrate({ classes: [{ classId: '', level: 1, subclass: '' }] }).sheet;
  assert.equal(blank.derived.maxHp, 0, 'no class picked → no phantom HP');
  assert.equal(blank.totalLevel, 1, 'total level falls back to the flat level (min 1)');
});

test('rules: AC never drops below the 10+DEX unarmored floor for a malformed armor record (AC-1)', () => {
  const { rec } = withFake();
  const abilities = { DEX: 14, CON: 10 };  // +2 DEX → floor 12
  const bad = rec.provided.hydrate({
    abilities, level: 1, className: 'Fighter',
    inventory: [{ name: 'Broken Plate', location: 'equipped' }],
  }).sheet;
  assert.equal(bad.derived.armorClass, 12, 'garbage baseAC -5 is floored at unarmored 10+DEX(+2)');
  assert.ok(bad.ac.candidates.some((c) => c.id === 'unarmored'), 'unarmored candidate always present');
});

test('rules: martial-finesse-or-light proficiency covers only finesse/light martials (PR-5)', () => {
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

test('rules: a non-origin class grants only its multiclassProficiencies weapons when declared (PR-5)', () => {
  // The compendium doesn't ship the field yet — records WITHOUT it must keep
  // the full starting set (the guard is inert), records WITH it reduce.
  const inv = [{ id: 'w1', ref: 'longsword', location: 'equipped' }];
  const abilities = { STR: 14, INT: 16 };
  const plain = makeFake();
  const { rec: r1 } = dryRunRegister(register, META, { deps: { 'dnd55e-compendium': plain } });
  const noField = r1.provided.hydrate({ abilities, classes: [{ classId: 'wizard', level: 3 }, { classId: 'fighter', level: 1 }], inventory: inv }).sheet;
  assert.equal(noField.weapons[0].proficient, true, 'no multiclassProficiencies field → full starting set (inert fallback)');
  const reduced = makeFake();
  reduced.getItem('class', 'fighter').multiclassProficiencies = { weapons: ['simple'] };
  const { rec: r2 } = dryRunRegister(register, META, { deps: { 'dnd55e-compendium': reduced } });
  const mc = r2.provided.hydrate({ abilities, classes: [{ classId: 'wizard', level: 3 }, { classId: 'fighter', level: 1 }], inventory: inv }).sheet;
  assert.equal(mc.weapons[0].proficient, false, 'a MULTICLASSED-INTO fighter grants only its reduced set (no martial)');
  const origin = r2.provided.hydrate({ abilities, classes: [{ classId: 'fighter', level: 1 }, { classId: 'wizard', level: 3 }], inventory: inv }).sheet;
  assert.equal(origin.weapons[0].proficient, true, 'the ORIGIN fighter still grants its full starting set');
});

test('rules: saveProf manually unions extra saving-throw proficiencies (PR-4)', () => {
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

test('rules: expertise on a non-proficient skill is ignored (PR-2)', () => {
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

test('rules: progression lookup above the seed cap returns the highest row ≤ level', () => {
  const { rec } = withFake();
  // Ranger progression rows stop at L10; querying L15 must use the L10 row
  // (preparedSpells 8), not return null / the L1 row.
  const r15 = rec.provided.hydrate({ abilities: { WIS: 16 }, className: 'Ranger', level: 15 }).sheet;
  assert.equal(r15.spellcasting.perClass[0].preparedLimit, 8, 'L15 ranger uses the L10 cap row (highest ≤ 15)');
});

test('rules: emits pools + hit dice + slots + charges with structured recharge (FE-2/FE-3)', () => {
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
  // Hit dice — aggregated by die; 2024 long rest regains ALL spent dice.
  const hd = R(s1, 'hit-dice-d12');
  assert.ok(hd && hd.kind === 'hitdice' && hd.max === 1 && hd.die === 'd12', 'L1: 1× d12 hit die');
  assert.deepEqual(hd.recharge, [{ on: 'long', amount: 'full' }]);
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

test('rules: subclass resources are emitted, resolved at the class level (FE-2)', () => {
  const { rec } = withFake();
  const s = rec.provided.hydrate({ classes: [{ classId: 'fighter', level: 7, subclass: 'eldritch-knight' }] }).sheet;
  const r = (s.resources || []).find((x) => x.key === 'ek-pool');
  assert.ok(r, 'subclass classResources are emitted alongside class ones');
  assert.equal(r.max, 3, 'resolved at the class level (7 → progression row 7 → 3)');
  assert.equal(r.source.type, 'subclass', 'tagged with subclass provenance');
});

test('rules: class features grant by RECORD identity — a drifted table string cannot mis-grant', () => {
  const { rec } = withFake();
  const feats = (lvl) => rec.provided.hydrate({ className: 'Wizard', level: lvl }).sheet.features;
  // The fake wizard's L2 row name-drops the L18 'Spell Mastery' (the bug a stale
  // book actually shipped). Records are the identity: L2 grants Scholar, never
  // Spell Mastery — and the entry carries the record id + name + provenance.
  const l2 = feats(2);
  assert.deepEqual(l2.find((f) => f.id === 'wizard-scholar'),
    { id: 'wizard-scholar', name: 'Scholar', source: { type: 'class', id: 'wizard', level: 2 } },
    'record-derived entry: record id + name + class provenance');
  assert.ok(!l2.some((f) => /spell.mastery/i.test(String(f.name || f.id))), 'the drifted string grants NOTHING at L2');
  assert.ok(l2.some((f) => f.id === 'wizard-arcane-recovery' && f.source.level === 1), 'the L1 record granted too');
  // At 18 the record grants at its own level — even though the abbreviated table
  // has no L18 row mentioning it (records grant; strings only label).
  const sm = feats(18).find((f) => f.id === 'wizard-spell-mastery');
  assert.ok(sm && sm.source.level === 18, 'Spell Mastery arrives at L18, from the record');
});

test('rules: repeat same-name feature records (Expertise ×2) BOTH grant, each at its level', () => {
  const { rec } = withFake();
  const at = (lvl) => rec.provided.hydrate({ className: 'Rogue', level: lvl }).sheet.features;
  assert.deepEqual(at(6).filter((f) => f.name === 'Expertise').map((f) => [f.id, f.source.level]),
    [['rogue-expertise', 1], ['rogue-expertise-6', 6]],
    'both occurrences grant, with distinct record ids + levels');
  assert.deepEqual(at(5).filter((f) => f.name === 'Expertise').map((f) => f.id), ['rogue-expertise'],
    'below the repeat level only the first occurrence grants');
});

test('rules: recordless strings still grant — generic labels, ARCH-4 books, subclass features', () => {
  const { rec } = withFake();
  // Mixed row: rogue L3 pairs the recordless 'Rogue Subclass' label with a real
  // record — the label survives beside it, in the printed order.
  const l3 = rec.provided.hydrate({ className: 'Rogue', level: 3 }).sheet.features.filter((f) => f.source.level === 3);
  assert.deepEqual(l3.map((f) => f.id), ['Rogue Subclass', 'rogue-steady-aim'], 'generic label + record coexist, table order kept');
  assert.equal(l3[0].name, undefined, 'a string fallback keeps the label-as-id shape (no name)');
  // A book with NO feature records for the class (warlock) → strings verbatim.
  assert.deepEqual(rec.provided.hydrate({ className: 'Warlock', level: 1 }).sheet.features,
    [{ id: 'Pact Magic', source: { type: 'class', id: 'warlock', level: 1 } }],
    'ARCH-4: a recordless book degrades to the printed strings');
  // Subclass features keep their own (unchanged) path + provenance.
  const ek = rec.provided.hydrate({ classes: [{ classId: 'fighter', level: 3, subclass: 'eldritch-knight' }] }).sheet.features;
  assert.deepEqual(ek.find((f) => f.id === 'war-bond'),
    { id: 'war-bond', name: 'War Bond', source: { type: 'subclass', id: 'eldritch-knight', level: 3 } });
});

test('rules: option-pool records (category) are choice fodder, never auto-granted features', () => {
  const { rec } = withFake();
  const feats = rec.provided.hydrate({ className: 'Sorcerer', level: 2 }).sheet.features;
  assert.ok(feats.some((f) => f.id === 'sorcerer-metamagic'), 'the Metamagic parent grants (by record)');
  assert.ok(!feats.some((f) => /quickened|twinned/i.test(String(f.name || f.id))), 'its metamagic OPTIONS do not');
});

test('rules: renderers survive the smoke pass', () => {
  const { rec } = dryRunRegister(register, META);
  assert.ok(smokeRegistrations(rec).ok, JSON.stringify(smokeRegistrations(rec).failures));
});

// ── ARCH-7: ruleset parameterization ────────────────────────────────
// The engine's system constants come from the data provider's `ruleset`
// record, resolved per constant over the 2024 defaults (rules/ruleset.js).

import * as Engine from '../rules/engine.js';
import { DEFAULT_RULESET, resolveRuleset } from '../rules/ruleset.js';
import { makeRulesApi } from '../rules/api.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Representative builds spanning every ruleset-touched path: printed slots,
// multiclass fractions, pact magic, spellbook, resources, mastery, caps,
// attunement.
const GOLDEN_BUILDS = [
  { className: 'Wizard', level: 5, baseStats: { INT: 16, CON: 14 } },
  { classes: [{ classId: 'paladin', level: 5 }, { classId: 'sorcerer', level: 1 }], baseStats: { CHA: 16 } },
  { className: 'Warlock', level: 5, baseStats: { CHA: 16 } },
  { className: 'Barbarian', level: 3, race: 'Dwarf', lineage: 'hill-dwarf', background: 'Sage',
    inventory: [{ ref: 'longsword', location: 'equipped' }, { ref: 'breastplate', location: 'equipped', attuned: true }] },
  { className: 'Fighter', level: 19, feats: [{ featId: 'weapon-master' }],
    abilityGrants: [{ source: 'boon', assign: { STR: 1 }, cap: 30 }], baseStats: { STR: 20 } },
];

test('ruleset: golden regression — no record / null / full default record are byte-identical (ARCH-7)', () => {
  const fake = makeFake();
  for (const cd of GOLDEN_BUILDS) {
    const bare = Engine.hydrate(cd, fake);
    assert.deepEqual(Engine.hydrate(cd, fake, null), bare, 'explicit null ruleset changes nothing');
    assert.deepEqual(Engine.hydrate(cd, fake, {}), bare, 'empty partial record changes nothing');
    assert.deepEqual(Engine.hydrate(cd, fake, DEFAULT_RULESET), bare, 'the full default record changes nothing');
  }
});

test('ruleset: casterFractions.half="down" flips the 2014 multiclass rounding (MC-2)', () => {
  const fake = makeFake();
  const cd = { classes: [{ classId: 'paladin', level: 5 }, { classId: 'sorcerer', level: 1 }] };
  // 2024 default: ceil(5/2)+1 = 4 → [4,3].
  assert.deepEqual(Engine.hydrate(cd, fake).sheet.spellcasting.slots, [4, 3]);
  // 2014 rounding: floor(5/2)+1 = 3 → [4,2].
  const rs2014 = { constants: { casterFractions: { half: 'down' } } };
  const out = Engine.hydrate(cd, fake, rs2014).sheet.spellcasting;
  assert.equal(out.casterLevel, 3);
  assert.deepEqual(out.slots, [4, 2]);
});

test('ruleset: rest.longRestHitDice="half" maps hit-dice recharge to halfLevel (2014)', () => {
  const fake = makeFake();
  const cd = { className: 'Barbarian', level: 4 };
  const hd = (rs) => Engine.hydrate(cd, fake, rs).sheet.resources.find((r) => r.kind === 'hitdice');
  assert.deepEqual(hd(null).recharge, [{ on: 'long', amount: 'full' }], '2024: ALL hit dice back');
  assert.deepEqual(hd({ constants: { rest: { longRestHitDice: 'half' } } }).recharge,
    [{ on: 'long', amount: 'halfLevel' }], '2014: half-your-total');
});

test('ruleset: capabilities.weaponMastery=false zeroes mastery slots (2014 has no mastery)', () => {
  const fake = makeFake();
  const cd = { className: 'Fighter', level: 5, feats: [{ featId: 'weapon-master' }] };
  assert.equal(Engine.hydrate(cd, fake).sheet.weaponMastery.slots, 4, '2024: class 3 + feat 1');
  assert.equal(Engine.hydrate(cd, fake, { capabilities: { weaponMastery: false } }).sheet.weaponMastery.slots, 0);
});

test('ruleset: ability/attunement caps + epic-boon capability come from the record', () => {
  const fake = makeFake();
  // Lower ability cap clamps the granted score (default 20 stays 20).
  const cd = { className: 'Fighter', level: 1, baseStats: { STR: 16 }, abilityGrants: [{ source: 'x', assign: { STR: 4 } }] };
  assert.equal(Engine.hydrate(cd, fake).sheet.abilities.STR.score, 20);
  assert.equal(Engine.hydrate(cd, fake, { constants: { abilityCap: 18 } }).sheet.abilities.STR.score, 18);
  // Attunement limit 1 → two attuned items over-attune.
  const inv = { className: 'Fighter', level: 1, inventory: [{ ref: 'longsword', attuned: true }, { ref: 'dagger', attuned: true }] };
  assert.equal(Engine.hydrate(inv, fake).sheet.attunement.over, false, '2024 limit 3');
  const tight = Engine.hydrate(inv, fake, { constants: { attunementLimit: 1 } }).sheet.attunement;
  assert.deepEqual({ limit: tight.limit, over: tight.over }, { limit: 1, over: true });
  // epicBoons: null (2014) removes the category's raised cap.
  const boon = { category: 'epicBoon' };
  assert.equal(Engine.featAbilityCap(boon), 30, '2024: boons raise the cap to 30');
  assert.equal(Engine.featAbilityCap(boon, resolveRuleset({ capabilities: { epicBoons: null } })), null);
});

test('ruleset: a partial record only overrides what it names (per-constant fallback)', () => {
  const rs = resolveRuleset({ edition: '2014', constants: { abilityCap: 22 } });
  assert.equal(rs.edition, '2014');
  assert.equal(rs.constants.abilityCap, 22, 'named constant overrides');
  assert.deepEqual(rs.constants.multiclassSlots['20'] || rs.constants.multiclassSlots[20],
    [4, 3, 3, 3, 3, 2, 2, 1, 1], 'unnamed constants keep the 2024 defaults');
  assert.equal(rs.capabilities.weaponMastery, true, 'unnamed capabilities keep the defaults');
  assert.equal(resolveRuleset(undefined), DEFAULT_RULESET, 'no record → the default object itself');
});

test('ruleset: DEFAULT_RULESET matches the compendium dnd-2024 record (drift guard)', (t) => {
  // Dev-only cross-repo guard: the printed record and the engine defaults must
  // agree exactly. Skips when the sibling checkout is absent (CI without it).
  const p = fileURLToPath(new URL('../../dnd55e-compendium/data/phb/rulesets/dnd-2024.json', import.meta.url));
  if (!existsSync(p)) return t.skip('dnd55e-compendium sibling checkout not present');
  const rec = JSON.parse(readFileSync(p, 'utf8'));
  assert.deepEqual(rec.constants, DEFAULT_RULESET.constants, 'constants drifted between record and engine defaults');
  assert.deepEqual(rec.capabilities, DEFAULT_RULESET.capabilities, 'capabilities drifted');
  assert.equal(rec.edition, DEFAULT_RULESET.edition);
});

test('ruleset: provided rules api surface is the documented contract (shape lock)', () => {
  // rules/README.md documents this surface for other addons (a future combat
  // tracker consumes it via host.use('dnd55e-sheets')). Removing/renaming a
  // method is a BREAKING change: bump apiVersion and update the doc.
  const { rec } = withFake();
  const api = rec.provided;
  assert.equal(api.apiVersion, 1);
  assert.deepEqual(Object.keys(api).sort(), [
    'apiVersion', 'derive', 'getFeature', 'getItem', 'getItemByName', 'getRecords', 'getRuleset',
    'hydrate', 'listArmor', 'listBackgrounds', 'listClasses', 'listEquipment', 'listFeats',
    'listFeatures', 'listSkills', 'listSpecies', 'listSpells', 'listSubclasses', 'listWeapons',
  ].sort());
  assert.deepEqual(Object.keys(api.derive).sort(),
    ['abilityMod', 'armorClass', 'initiative', 'maxHp', 'multiclassSlots', 'proficiencyBonus', 'saveDC'].sort());
  // getRuleset always returns a RESOLVED ruleset (fake data has no record → defaults).
  assert.equal(api.getRuleset().edition, '2024');
  assert.equal(api.getRuleset().constants.abilityCap, 20);
  // A provider that ships a record sees it merged in.
  const withRecord = makeRulesApi(() => ({ ...makeFake(), getRuleset: () => ({ edition: '2014', constants: { abilityCap: 22 } }) }));
  assert.equal(withRecord.getRuleset().edition, '2014');
  assert.equal(withRecord.getRuleset().constants.abilityCap, 22);
  assert.equal(withRecord.getRuleset().constants.attunementLimit, 3, 'unnamed constants still default');
});

test('ruleset: a feat record\'s structured initiative modifiers beat the alert fallback (CX-2)', () => {
  const fake = makeFake();
  // A 2014-style Alert: flat +5, no PB — the record field is the authority.
  fake.getItem = ((orig) => (kind, id) => {
    const r = orig(kind, id);
    if (kind === 'feat' && id === 'alert') return { id: 'alert', name: 'Alert', category: 'general', modifiers: [{ target: 'initiative', add: 5 }] };
    return r;
  })(fake.getItem);
  const cd = { className: 'Fighter', level: 5, baseStats: { DEX: 14 }, feats: [{ featId: 'alert' }] };
  assert.equal(Engine.hydrate(cd, fake).sheet.derived.initiative, 2 + 5, 'record modifiers win: DEX +2, flat +5');
  // Without a record (name-only book), the legacy alert→PB fallback still fires.
  const bare = makeFake();
  bare.getItem = ((orig) => (kind, id) => (kind === 'feat' && id === 'alert' ? null : orig(kind, id)))(bare.getItem);
  assert.equal(Engine.hydrate(cd, bare).sheet.derived.initiative, 2 + 3, 'fallback: DEX +2, PB +3');
});

// ── ARCH-7 stage 4: provider candidate list + the character's ruleset tag ──

const make2014Provider = () => ({
  ...makeFake(),
  getRuleset: () => ({ edition: '2014', constants: { casterFractions: { half: 'down' } }, capabilities: { weaponMastery: false, epicBoons: null, backgroundAsi: false } }),
});

test('ruleset: provider probe walks the candidate list — a 2014 provider under the second id drives the rules', () => {
  const META2 = { ...META, optionalDependencies: { ...META.optionalDependencies, 'dnd5e-compendium': { range: '>=0.1.0' } } };
  const { rec } = dryRunRegister(register, META2, { deps: { 'dnd5e-compendium': make2014Provider() } });
  const api = rec.provided;
  assert.equal(api.getRuleset().edition, '2014', 'second candidate id found when the first is absent');
  const out = api.hydrate({ classes: [{ classId: 'paladin', level: 5 }, { classId: 'sorcerer', level: 1 }] }).sheet.spellcasting;
  assert.deepEqual(out.slots, [4, 2], '2014 half-caster round-down flows through the provided api');
  assert.equal(api.hydrate({ className: 'Fighter', level: 5 }).sheet.weaponMastery.slots, 0, 'capability gate flows through');
});

test('ruleset: edition mismatch warns (advisory) and Builder saves re-stamp the tag', () => {
  const fake2014 = make2014Provider();
  const host = { use: (id) => (id === 'dnd5e-compendium' ? fake2014 : null) };
  const num2 = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const model = makeEngine({ num: num2, host, NS: 'x', ABILITIES: [], SKILLS: [], abilityMod: () => 0, sheetOf: () => ({}), clampHp: (hp) => num2(hp, 0) });
  const engine = model.getRules();
  assert.ok(engine, 'candidate-list probe finds the provider');
  // A 2024-built character under a 2014 provider: renders + warns (ARCH-5 advisory).
  const r = model.safeHydrate(engine, { ruleset: '2024', className: 'Wizard', level: 1 });
  assert.ok(r && r.sheet, 'mismatch never blocks rendering');
  assert.match(r.warnings[0], /2024.*2014/, 'the mismatch is surfaced as the first warning');
  // Same-edition characters get no such warning.
  assert.ok(!model.safeHydrate(engine, { ruleset: '2014', className: 'Wizard', level: 1 }).warnings.some((w) => /ruleset/.test(w)));
  // materializeInto re-stamps the tag from the provider's edition (DEG-1 save path).
  const s = { ruleset: '2024', className: 'Wizard', level: 1, abilities: {} };
  model.materializeInto(s, engine);
  assert.equal(s.ruleset, '2014', 'Builder save stamps the active provider edition');
});

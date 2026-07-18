# rules/ — the built-in D&D rules engine

The generic **D&D rules engine**, a module of the character-sheets addon — it
always ships with the sheet, and what is optional is the *content*.

It is a **data-driven handler**: it encodes the *system* rules (how proficiency bonus,
ability modifiers, AC, HP, saves, spell slots are computed, and how declarative
grants/modifiers/formulas are interpreted) but contains **no content**. All content
comes from a per-book data addon —
`dnd55e-compendium` (a private sibling repo) — soft-used
via `host.use` (a manifest `optionalDependencies` entry). Adding a new
class/subclass/item/spell is a book-addon data change and never touches this engine.

**Edition independence (ARCH-7, 2026-07-10).** The engine targets no single edition:
its system constants (multiclass slot table, caster-fraction rounding, ASI budgets,
ability caps, point buy, rest rules, …) and subsystem capability flags (weapon
mastery, epic boons, background-vs-species ASI) live in **`ruleset.js`** as
`DEFAULT_RULESET` — the D&D 2024 values — and the data provider may override them by
shipping a `ruleset` record (see the compendium's `data/SCHEMA.md`). `resolveRuleset`
merges the record **per constant** over the defaults, so a missing or partial record
degrades to 2024 behavior, never breakage. Authority order for any rule value:

```
printed class progression  >  ruleset record  >  built-in 2024 defaults
```

## Layout

- **`engine.js`** — the pure, host-free derivation pipeline (plus the shared rules
  facts: `ABILITIES`, `SKILL_ABILITY`, point buy, `clampHp`, `abilityMod`…).
  Unit-tested by `../tests/rules.mjs` with a fake book api.
- **`ruleset.js`** — `DEFAULT_RULESET` (the 2024 system constants + capability flags)
  and `resolveRuleset(record)` (per-constant merge of a provider's `ruleset` record).
- **`api.js`** — `makeRulesApi(getData)`: binds the engine to a live data provider and
  returns the api the sheet panels consume (and that the addon `provide()`s for other
  addons):
  - `list*()` / `getItem()` — passthrough of book data for the sheet's dropdowns.
  - `hydrate(decisions)` — turns the character's decisions into a fully computed sheet;
    **never throws** (failures accumulate as `warnings`, mirroring Living-scroll's
    error-isolated pipeline).
  - `getRuleset()` — the RESOLVED ruleset (always a full object, never null).
  - `derive.*` — granular stat helpers.

The sheet activates engine mode only while book data is present (`getRules()` in
`../model.js`); without it the sheet falls back to hand-filled values, so
installing/uninstalling the book addon never breaks a sheet.

## The provided api is a CONTRACT

`entry.js` `provide()`s this api for other addons — a future combat tracker consumes
it via `host.use('dnd-sheets')` with one manifest `optionalDependencies` line. The
surface is **shape-locked** by a test in `../tests/rules.mjs` ("shape lock"): the
exact method list is

`apiVersion` · `listClasses` · `listSubclasses` · `listFeatures` · `getFeature` ·
`listSpecies` · `listBackgrounds` · `listFeats` · `listSpells` · `listEquipment` ·
`listArmor` · `listWeapons` · `listSkills` · `getItem` · `getItemByName` ·
`getRecords` · `getRuleset` · `hydrate` · `derive` (`abilityMod`,
`proficiencyBonus`, `multiclassSlots`, `initiative`, `maxHp`, `armorClass`, `saveDC`).

Adding a method is fine (additive). **Removing or renaming one, or changing a return
shape, is a breaking change**: bump `apiVersion`, update the shape-lock test and this
doc, and keep the old name delegating for at least one release. This contract — not
repo separation — is what lets the sheet's panels be edited freely without breaking
consumers; if a second consumer ever makes the shared repo painful, the whole `rules/`
dir extracts cleanly (pure module, fake-fixture tests, this documented surface).

## Status

The full hydration pipeline is **implemented** (ported from
[Living-scroll](https://github.com/pjunak/Living-scroll)'s `rules_engine` +
`dnd24_mechanics`). `hydrate(decisions)` runs the whole sequence — abilities (with
ability grants, capped per the ruleset; 2024: 20) → classes + proficiency bonus → species/lineage
(speed, senses, resistances, per-level HP) → background → HP → AC → initiative →
saves → skills (proficiency + expertise) → spellcasting (per-class DC/attack,
prepared limits, slot pool, provenance-tagged granted spells + pending choices) →
weapon mastery → weapon attacks + attunement → collected features. Every step is
error-isolated, so a bad content record degrades to a `warning` rather than
throwing, and the sheet is always returned. `derive.*` exposes granular helpers
(`abilityMod`, `proficiencyBonus`, `multiclassSlots`, `initiative`, `maxHp`,
`armorClass`, `saveDC`).

**Spell slots:** a single caster class reads its class record's own printed
per-level slot progression (`progression[].spellSlots`) verbatim; only genuine
multiclassing (2+ caster classes) uses the combined-caster-level table (fraction
rounding per the ruleset — 2024: halves round up, thirds down). When a class's
(abbreviated) content lacks `spellSlots`, the engine falls back to a
caster-level heuristic so it never reports empty slots.

**Multiclassing & HP:** the character's first level gets the maximum of its hit
die; every other level gets the average. For the common single-class case this is
simply that class's die; multiclass order beyond the first entry doesn't change
the total, so no "origin class" is tracked.

**Collected features:** class features grant from the per-class `feature`
records (`listFeatures({classId})`, record level ≤ class level) — the
`progression[].features` name-strings are display labels, not identity (a
drifted table once granted the L18 Spell Mastery to a L2 wizard). A string
grants only when the class has no record of that name (the generic labels —
ASI / Epic Boon / "\<Class\> Subclass" / upgrade markers — and whole books that
predate feature records, ARCH-4); a string whose name is a record's at another
level is drift and grants nothing. Same-name repeat records (rogue/bard
Expertise, Metamagic) each grant at their own level; option-pool records
(`category`: metamagic/maneuver/invocation) are choice fodder, never
auto-granted. Every entry stays provenance-tagged
(`{ id, name?, source: { type, id, level } }`).

## Develop

```sh
node --test tests/rules.mjs   # from the repo root; assumes ttrpg-codex is a sibling
```

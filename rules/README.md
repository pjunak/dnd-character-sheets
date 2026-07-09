# rules/ — the built-in D&D 5.5e (2024) rules engine

The generic **D&D 5.5e (2024) rules engine**, a module of the character-sheets addon.
It began life as the standalone `dnd55e-core-rules` addon and was **merged into this
repo** (full git history preserved) once it was clear the sheet was its only consumer —
the engine now always ships with the sheet, and what is optional is the *content*.

It is a **data-driven handler**: it encodes the *system* rules (how proficiency bonus,
ability modifiers, AC, HP, saves, spell slots are computed, and how declarative
grants/modifiers/formulas are interpreted) but contains **no content**. All content
comes from a per-book data addon —
[`dnd55e-compendium`](https://github.com/pjunak/dnd55e-compendium) — soft-used
via `host.use` (a manifest `optionalDependencies` entry). Adding a new
class/subclass/item/spell is a book-addon data change and never touches this engine.

## Layout

- **`engine.js`** — the pure, host-free derivation pipeline (plus the shared rules
  facts: `ABILITIES`, `SKILL_ABILITY`, point buy, `clampHp`, `abilityMod`…).
  Unit-tested by `../tests/rules.mjs` with a fake book api.
- **`api.js`** — `makeRulesApi(getData)`: binds the engine to a live data provider and
  returns the api the sheet panels consume (and that the addon `provide()`s for other
  addons):
  - `list*()` / `getItem()` — passthrough of book data for the sheet's dropdowns.
  - `hydrate(decisions)` — turns the character's decisions into a fully computed sheet;
    **never throws** (failures accumulate as `warnings`, mirroring Living-scroll's
    error-isolated pipeline).
  - `derive.*` — granular stat helpers.

The sheet activates engine mode only while book data is present (`getRules()` in
`../model.js`); without it the sheet falls back to hand-filled values, so
installing/uninstalling the book addon never breaks a sheet.

## Status

The full hydration pipeline is **implemented** (ported from
[Living-scroll](https://github.com/pjunak/Living-scroll)'s `rules_engine` +
`dnd24_mechanics`). `hydrate(decisions)` runs the whole sequence — abilities (with
ability grants, capped at 20) → classes + proficiency bonus → species/lineage
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
multiclassing (2+ caster classes) uses the round-down combined-caster-level
table. When a class's (abbreviated) content lacks `spellSlots`, the engine falls
back to a caster-level heuristic so it never reports empty slots.

**Multiclassing & HP:** the character's first level gets the maximum of its hit
die; every other level gets the average. For the common single-class case this is
simply that class's die; multiclass order beyond the first entry doesn't change
the total, so no "origin class" is tracked.

## Develop

```sh
node --test tests/rules.mjs   # from the repo root; assumes ttrpg-codex is a sibling
```

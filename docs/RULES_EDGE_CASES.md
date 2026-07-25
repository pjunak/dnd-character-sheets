# Rules runtime contract and edge cases

This is the canonical current-state contract for the rules engine built into
`dnd-sheets`. It describes shipped behavior, not implementation history or
future design proposals. Provider schema details and current cross-repository
gaps live in `dnd55e-compendium/data/SCHEMA.md` and `data/GAPS.md`.

## Contract boundaries

- The addon id is `dnd-sheets`; that id also owns
  `character.addonData["dnd-sheets"]` and must not change without a data-key
  migration.
- The engine is part of this addon. `rules/api.js` exposes its pure API to
  future consumers; moving or extracting it is not part of the contract.
- Book data is optional. The 2024 provider id is `dnd55e-compendium`; the
  reserved 2014 provider id is `dnd5e-compendium`.
- The sheet addon manifest uses host addon API v2 and requires the
  `lifecycle.dispose` and `i18n.catalogs` capabilities. The rules object
  returned through `host.provide(...)` separately has `apiVersion: 1`.
  Provider API versions and host manifest API versions are different
  namespaces.
- `collections.dm` is an available API-v2 host capability for addon-owned
  DM-only collections. This addon does not require or use it.
  The sheet contract does not require or advertise it.

## Stored decisions and materialized fields

The builder decision spine includes `classes`, `baseStats`, `abilityGrants`,
`featureChoices`, `grantChoices`, `grantCastingAbilities`, spell selections,
equipment state, and `overrides`. On hydration, the engine derives rules-owned values and the addon
materializes the result into the ordinary character fields used by the host.
The view model applies explicit overrides over the derived result; overrides
are never folded into provider data.

When no compatible provider is available, the sheet remains hand-fillable and
uses the last materialized flat fields. The sheet records a bounded baseline of
the fields owned by materialization. If any of those fields change before the
provider returns, or the returning provider has a different edition, computed
mode remains disabled for that character until the user explicitly chooses:

- keep the exact hand-filled values and remain in manual mode; or
- resume the stored decision spine and rematerialize from the installed
  provider.

Play state such as current HP, inventory, currency, resource uses, and manual
spell entries is not part of the baseline and never triggers reconciliation.
The choice is per character and does not disable the provider for other sheets.

Derived validation is advisory. Over-budget point buy, over-limit prepared
spells, unmet prerequisites, and similar warnings do not silently delete user
choices.

## Hydration order

After resolving the ruleset, `hydrate()` runs error-isolated steps in this
order:

1. ability scores and caps;
2. ordered classes, total level, and proficiency bonus;
3. species, lineage, background, hit points, Armor Class, and initiative;
4. saving throws, skills, armor proficiencies, and tool proficiencies;
5. spellcasting, granted spells, and pending spell choices;
6. weapon mastery, equipped weapon attacks, and attunement;
7. record-first collected features; and
8. build-derived resource trackers.

The model then materializes the result and the view model applies explicit
overrides. Class roster position and grant provenance are observable contract
inputs rather than display-only metadata.

## Classes and multiclassing

- Class array order is significant. The first class is the origin class for
  saving throws, first-level hit points, and starting proficiency semantics.
- Total character level drives proficiency bonus. Per-class level drives class
  features and each class's spellcasting contribution.
- Class features are record-first: matching `feature` records are authoritative
  for identity and level. `progression[].features` supplies printed ordering
  and a label fallback only when no record exists at all; a same-name record at
  another level is not granted early.
- The origin class uses `startingProficiencies`; later classes use
  `multiclassProficiencies` when present. Reduced skill choices and armor,
  weapon, and tool grants are all consumed. A provider that omits the reduced
  object falls back to starting proficiencies for compatibility.

## Abilities, feats, and choices

- Base scores and provider grants are combined before user overrides.
  Ability caps are enforced by the derived result and surfaced through
  warnings rather than destructive choice cleanup.
- Every repeatable or ambiguous choice needs a stable id. `grantChoices` uses
  that id so selections survive rehydration.
- Fixed spell grants and filtered `choose` grants are supported for feats,
  species, and lineages. Filters support exact or maximum spell level and a
  union of class-list, school, and explicit-id sources.
- A feat's `spellList` expands each caster's selectable pool.
  `prepareSpellListOf` can make the lists of owned feats in a named category
  always prepared.
- Granted spells carry fixed or selected casting abilities. Unresolved
  selections appear in `castingAbilityChoices`; chosen values are stored in
  `grantCastingAbilities` and copied into grant provenance.

## Spellcasting

- `spellcasting.type` selects full, half, third, or pact contribution.
  Multiclass slot math comes from the resolved ruleset; Pact Magic remains a
  separate pool and its resources recover on a Short Rest.
- A class or subclass `progression` row can provide `preparedSpells`,
  `cantripsKnown`, and an optional printed `spellSlots` row. Printed slots win
  for a single caster. Otherwise the resolved ruleset table is used. Current
  2024 class records omit printed `spellSlots`, so their real slot pools use
  the ruleset; pact slots use `constants.pactMagic`.
- The engine consumes `ability`, `type`, `prepares`, and `ritual` from the
  spellcasting descriptor. Provider fields such as `prepared` and `startLevel`
  are not currently independent engine inputs.
- Prepared and cantrip limits are tracked per casting source. Over-limit lists
  remain visible and produce warnings.
- Wizard spellbooks are character-owned learned-spell references. Provider
  spell records remain immutable.
- Granted spells preserve their source and distinguish always-prepared and
  free-use semantics. Choice grants use the same stable choice machinery as
  other builder decisions.
- Class-specific attunement-limit schedules override the ruleset baseline at
  the relevant class level. Resource recharge entries may similarly use
  `minLevel`; species may grant proficiency-bonus-sized resource pools.
- A feat may grant a separately tracked, restricted spell slot with a bounded
  level rule and structured Short/Long Rest recharge. It never merges into the
  ordinary multiclass slot table.
- Eldritch Knight and Arcane Trickster have third-caster descriptors but no
  shipped subclass progression rows, so the provider currently yields no
  prepared-spell or cantrip limit for them. This is a known provider defect.

## Equipment and Armor Class

- Equipment references resolve against provider records; character-owned
  quantity and state stay in the sheet blob.
- Armor Class uses `armorType`, `baseAC`, `dexCap`, and `acBonus`, with the
  selected/equipped items and explicit overrides.
- Provider armor records already include `strReq` and
  `stealthDisadvantage`. The current engine does not apply either field, so no
  speed-penalty warning or derived Stealth-disadvantage flag is promised yet.

## Ruleset authority and compatibility

The resolved edition ruleset overrides built-in 2024 defaults per constant.
Printed record data is more specific than a ruleset constant; built-in values
are the final compatibility fallback. The 2024 provider and built-in defaults
are byte-checked by the cross-repository tests for the constants they share.

Structural 2014 support is intentionally incomplete until a real
`dnd5e-compendium` provider exists. Provider selection may recognize the
reserved id, but that does not make untested 2014 record shapes part of the
runtime contract.

## Verification

Pure engine behavior is covered by `tests/rules.mjs`; addon/provider wiring and
choice UI behavior are covered by `tests/smoke.mjs`. Provider record integrity
belongs to the compendium repository. Any contract change must update the
provider data/schema, consumer behavior, and both sides' tests together.

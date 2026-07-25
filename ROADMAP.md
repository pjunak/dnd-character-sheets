# Roadmap

Only unfinished work owned by `dnd-sheets` belongs here. The current runtime
contract and known limits are documented in
[`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md).

## Mobile layout

Finish the narrow-screen character-sheet and builder layouts, including the
tab strip, dense derived-stat panels, choice controls, and inventory tables.

## Builder hover preview

Add a non-interactive preview for options in the builder spine so a player can
inspect a species, background, class, subclass, or feat without changing the
saved selection.

## Spellbook metadata

Extend copied spellbook entries beyond the current flat spell-reference array
when a concrete workflow needs source notes, copy cost, or transcription
status. Keep provider records immutable and store character-specific metadata
in the sheet blob.

## Multiclass proficiency contract

Distinguish the origin class from later classes while collecting proficiency
choices. Consume reduced weapon, armor, tool, and skill grants once the
compendium supplies complete `multiclassProficiencies` payloads. The present
cross-repository gap is detailed in the compendium's `data/GAPS.md`.

## Future 2014 provider compatibility

Implement and test 2014-specific shapes only against a real
`dnd5e-compendium` provider. Expected pressure points include species ability
scores and subraces, known-versus-prepared spellcasting, and the 2014 feat/ASI
model. Do not infer these shapes from the 2024 provider.

## Feature-owned mechanics

Structure additional feature effects only when a real provenance-aware
consumer requires them. Introduce one narrowly scoped mechanic at a time with
provider data, engine behavior, and regression tests in the same change.

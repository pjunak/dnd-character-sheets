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

## Print, export, and import

Complete printable-sheet localization, provide a user-facing JSON export, and
add an explicit file-picker import flow with validation and a recoverable
preview.

## Multiclass proficiency contract

Distinguish the origin class from later classes while collecting proficiency
choices. Consume reduced weapon, armor, tool, and skill grants once the
compendium supplies complete `multiclassProficiencies` payloads. The present
cross-repository gap is detailed in the compendium's `data/GAPS.md`.

## Provider-loss reconciliation

Decide how to reconcile manual edits made while the optional compendium is
unavailable with the stored builder decisions that resume when it returns.
The current behavior deliberately preserves both: flat materialized fields are
the fallback while offline, and the engine resumes from the decision spine
after rehydration.

## Future 2014 provider compatibility

Implement and test 2014-specific shapes only against a real
`dnd5e-compendium` provider. Expected pressure points include species ability
scores and subraces, known-versus-prepared spellcasting, and the 2014 feat/ASI
model. Do not infer these shapes from the 2024 provider.

## Feature-owned mechanics

Structure additional feature effects only when a real provenance-aware
consumer requires them. Introduce one narrowly scoped mechanic at a time with
provider data, engine behavior, and regression tests in the same change.

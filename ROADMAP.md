# ROADMAP — dnd55e-character-sheets (engine + character sheet)

**Remaining work only** — one self-contained point per possible future implementation.
Current state, architecture and workflow: [`AGENTS.md`](AGENTS.md) · shipped history: git log ·
edge-case ledger: [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md).

## Blocked on a maintainer decision

1. **Record images.** The render seam exists (`rec.image` → `host.asset`, thumbnail slots in browse
   rows); nothing ships images. Needs an image *source/licensing* decision — open-licensed sets
   (e.g. game-icons.net, already used for host map markers, CC BY), original art, or user uploads.
   Never scraped WotC art (SRD covers text only).

## Deferred features (pick up when wanted)

1. **Mobile layout.** Out of scope for incremental tweaks — needs a dedicated redesign of the
   sheet's column model. Do not attempt via CSS patches.
2. **Builder spine hover-preview.** Hover a collapsed level row → read-only preview; click to pin
   into edit. Deferred because hover-expand with native `<select>`s + full re-render is fragile.
   Revisit only if the quick-glance need proves real in play.
3. ~~**Epic Boon @19.**~~ CLOSED 2026-07-10 (maintainer-approved): implemented as the standard
   L19 pick, not a house-rule toggle — the level-19 slot's feat picker offers the `epicBoon`
   category (grouped "Epic Boons" optgroup) alongside general feats, per the 2024 rule ("an Epic
   Boon feat or another feat you qualify for"; an ASI is itself a feat, so the ASI mode stays).
   A boon's structured `abilityScoreIncrease` applies through the existing grant machinery with a
   raised per-ability cap of 30 (AB-4 slice; `'ANY'` expands to all six abilities); prose-only
   boon effects stay prose, like every other feat.
4. **FE-8 — feature-owned structured mechanics.** Only when a provenance-dependent feature demands
   it (no current consumer).
5. **Spellbook refinements.**
   a. Source note on *copied* spells — copied refs live in the flat `s.spellbook` array, so only
      custom spells carry `sourceNote`; needs per-book-entry metadata (`ref → {note, cost}`).
   b. ~~Scroll→spell verification~~ — CLOSED 2026-07-10: the copy form now lists only scrolls
      whose name matches the picked spell (`scroll of <name>`, contains-fallback; a no-match
      state otherwise), and `spellCopy` consumes a scroll only when it holds the copied spell.
   c. Unaffordable copy is guided, not hard-blocked (gp clamps ≥0) — BY DESIGN; revisit only if it
      misleads players in practice.
6. **Print / export refinements.** Print-sheet labels are English-only (i18n pass); import is
   paste-JSON (add a file picker).
7. ~~**Inventory item kind.**~~ CLOSED 2026-07-10: `invAddRef` stores `kind` beside the ref;
   the weapon→armor probe survives only for legacy rows, and the by-name fallback covers both kinds.
8. **Multiclass skill-choice descriptors (PR-5, second half).** `classWeaponProf` now honors a
   non-origin class's `multiclassProficiencies.weapons` (inert until the compendium ships the
   field), but `collectChoices` still offers every class's FULL starting skills choice: the
   Builder's class tabs call it with single-class sub-lists, so roster position is unknowable
   there without reworking its call convention (descriptors would need an `ownerClassId` so the
   spine can filter a full-roster collection). Do that rework when the compendium data lands.
9. **2014-edition structural enablers (ARCH-7 stage 5).** The engine is ruleset-parameterized
   (2026-07-10: constants + capability flags come from the data provider's `ruleset` record,
   per-constant fallback to the built-in 2024 defaults; the provider probe is a candidate list
   keyed on the character's `ruleset` tag). What remains is the structural 2014 shapes, gated on
   record-field *presence* and deferred until a `dnd5e-compendium` repo actually starts: species
   `abilityIncreases` (+ subraces), the spells-known / prepared-formula casting model, half-feat
   ASIs. Each lands with a rules.mjs case proving 2024 fixtures are byte-identical.
10. **Combat addon consumption (stage 6).** A future combat tracker consumes this addon's provided
   rules api (`host.use('dnd55e-sheets')` — surface documented in `rules/README.md`, shape-locked
   by tests). Extract a dedicated rules addon only if that proves painful in practice; a host
   `discover()` capability registry only if a third provider family ever appears.

(Closed 2026-07-08: `aria-live` budget counts — point-buy/ASI edits now announce "{n} pts left"
through the host's persistent live region, `host.ui.announce`, which survives the full-panel
re-render that blocked the in-page approach.)

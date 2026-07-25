# AGENTS.md — dnd-character-sheets (repo guide for AI agents)

**What this repo is.** The D&D character-sheet addon for the
[ttrpg-codex](https://github.com/pjunak/ttrpg-codex) host app. **Addon id is
`dnd-sheets`** — the host keys on the manifest id, and the id (not the repo
dir name) namespaces `character.addonData['dnd-sheets']`. Tabbed sheet UI
(Overview / Character Sheet [incl. inventory] / Combat / Spellbook / Builder /
Settings)
**plus the built-in pure rules engine** (`rules/engine.js` + `rules/api.js`).
The engine is **edition-parameterized** (ARCH-7): built-in 2024 constants, a
data provider's `ruleset` record overrides per constant. Standalone
hand-fillable; declares `optionalDependencies: dnd55e-compendium` (2024) and
`dnd5e-compendium` (2014, future) — engine mode lights up when a book
addon's data is present. `provide()`s the rules API for future consumers
(e.g. a combat addon).

## Read these first

1. [`README.md`](README.md) — tabs, editing model, dev + test commands.
2. [`rules/README.md`](rules/README.md) — the engine: layout, hydration
   pipeline, slot/multiclass semantics.
3. [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md) — the canonical
   current runtime contract and edge cases. It intentionally contains no
   implementation history; `model.js` remains the truth for shipped field
   names.
4. The **canonical addon-authoring contract** lives in the host repo:
   `../ttrpg-codex/examples/addons/AGENTS.md` (condensed) and
   `../ttrpg-codex/examples/addons/AUTHORING.md` (full reference,
   [GitHub](https://github.com/pjunak/ttrpg-codex/blob/main/examples/addons/AUTHORING.md)).
   This file deliberately does NOT vendor a copy — a stale copy misled agents
   here before.

## Layout + the naming trap

```
addon.json          manifest — id dnd-sheets, optionalDependencies, tests.client
locales/en.json     declarative English UI source catalog loaded by the host
entry.js            composition root: register(host), panels, tab routing,
                    fragment render, rules API provision, domain disposers
actions.base.js     tabs, direct fields/proficiencies, overrides, layout
actions.spells.js   spell prep/book, swaps, grants, drag/drop, manager
actions.inventory.js inventory/equipment + add-item wizard; addInventoryItems
actions.resources.js resources/rest; pure applyHpChange helper
actions.builder.js  guided decision mutations
actions.transfer.js print/export/import; owns download URL timers
actions.shared.js   small action-map registration helper
ui-state.js         per-character session UI state; persists tab/layout only
equipment-model.js pure inventory resolution + worn/attuned slot model
model.js            THE data layer: stored-blob read/migration, viewModel,
                    builderMutate + materializeInto (DEG-1), getRules() probe
panel.overview.js   ⚠ renders the CHARACTER SHEET tab (id `stats`) — entry.js appends
                    panel.backpack.js below it (Backpack has no own tab anymore)
panel.sheet.js      ⚠ renders the COMBAT tab
panel.spellbook.js / panel.backpack.js / panel.builder.js / editor.js
panel.print.js      print/PDF sheet (new-window, self-contained) + JSON import modal
ui.js               shared render helpers — statTip/entityRef are THE hover+link
                    primitives; heroTile/abilityTile compose host classes; styleTag
helpers.js          compendiumHref / firstPara / featureRecordFor
rules/              the PURE engine (host-free, unit-tested): engine.js + api.js
tests/              smoke/rules plus focused pure-module tests
```
The Overview tab has no module — it is the host's own wiki profile folded in
via the `characters:body` takeover.

The **Builder** is internally sub-tabbed: a **Character** tab (abilities, species,
background, class roster, level-independent extra feats) + **one tab per class**,
each a per-level **progression spine** whose rows expand in place (accordion) to
edit that level's choices. Sub-tab / open-row state is session-only and not
persisted. A sheet-wide toolbar offers Print / Export / Import (B4.6).

## Layering rules (where new code goes)

- **Panels render only.** No stored-blob mutation, no rules math in panels.
- **`entry.js` composes; `actions.*.js` own controller behavior.** Register a
  new action in exactly one domain module and pass its dependencies explicitly
  from `entry.js`. Domain-local timers/state must have a disposer returned to
  the composition root. The host lifecycle removes registrations; domain
  disposers clear only their owned resources.
- **`ui-state.js` owns UI state.** Tabs and layout are the only persisted
  preferences. Modal, wizard, selection, and Builder state stays in memory and
  is cleared on disposal.
- **`model.js` owns the pipeline + every mutator.** Any new engine-affecting
  mutation MUST route through `builderMutate`/`materializeInto` — that is the
  **DEG-1 obligation**: every Builder edit materializes computed values into
  the flat fallback fields so removing the engine/book degrades to a
  hand-filled sheet, never a data loss.
- **`rules/` stays pure and host-free** (no `host`, no DOM) — that's what
  makes it unit-testable. Rules facts (point-buy costs, clamps, tables) live
  here, never in panels.
- **Content belongs in the book addon** (`../dnd55e-compendium`) — this
  repo ships no rulebook data; `tests/fake-phb.mjs` fakes it for engine-mode
  tests.

## Current state (high level; detail = git log + README)

Feature-complete through the B4/B5 arcs: engine mode (book data present) with
the guided per-level **tabbed Builder** (progression spines, ASI ± steppers over
a shared budget, reconcile-on-change), the **spellbook** (Wizard learned pool,
copy-from-scroll, Warlock Pact Magic), **print/PDF + JSON export/import**, and
the full **UI polish** pass — whole-row click targets with hover/focus rings,
editable-HP tile, a compact text-labelled vitals strip (incl. per-class spell
save DC / spell attack tiles; the icon-glyph vitals were reverted), 3-state
proficiency dots + a filled/struck shield-shaped AC indicator,
keyboard-navigable sub-tabs, host `.codex-chip` spell/inventory chips. All repeatable UI renders host `.codex-*`
components; standalone (no book) degrades to a hand-filled sheet (DEG-1).

## Working here — the facts that bite

- **Branch workflow** *(changed 2026-07-10)*: development happens directly on
  **`main`** — the old long-lived `agentic-dev` branch is retired; don't create
  it or per-task branches. Commit only when the maintainer asks. When a batch
  spans the host, integrate **`ttrpg-codex` first** — addon CI checks out
  `ttrpg-codex@main` for the test harness.
- **Sibling checkouts assumed**: `../ttrpg-codex` (harness + dev-install),
  `../dnd55e-compendium` (the data this consumes; its `data/SCHEMA.md`
  is the record-shape contract behind `rules/api.js`), `../Living-scroll`
  (Python port source-of-truth for rule edge cases).
- **Dev loop**: from `../ttrpg-codex` run
  `node scripts/dev-install-addon.cjs ../dnd-character-sheets`, restart the
  app. **Repo edits are invisible until re-dev-installed.**
- **Tests**: `node --test tests/smoke.mjs tests/rules.mjs` from THIS repo's
  root — on Windows only relative file paths work (`node --test tests/` and
  absolute paths false-fail); node runs from PowerShell, not Git Bash, on the
  maintainer's machine. `tests.client` in the manifest is dev-only (the
  install green-gate runs `tests.server`, which this addon doesn't declare).
- **Release**: bump `addon.json` version → push → DM updates via the wizard.
  Client-only changes need no server restart. **Update-all never grants NEW
  permissions** — a release adding a `permissions[]` entry must go through the
  per-addon wizard, or it silently never activates.
- The harness enforces `meta.permissions` when the test META declares them —
  keep test METAs in sync with `addon.json` (an under-declared permission
  passes tests and rolls the addon back at load).

## Contract recap (full rules in the host repo)

- All HTML through `host.h` (`esc` everything dynamic, `dataAction`/`dataOn`
  handlers); design tokens + host component classes (`.codex-tile`,
  `.codex-tab-strip`, `.codex-tip` …) only.
- **Repeatable UI is host-defined — consume it, don't re-skin it.** Forms and
  common controls live in `../ttrpg-codex` so the whole app stays on one style
  (and can be re-themed later); addons only use them. Number entry → `ui.numField`
  (renders the host `.codex-stepper`); tabs → `.codex-tab-strip` / `.codex-tab`
  (+ `.is-active`); stat tiles → `.codex-tile`; fields → `.edit-input`; hover
  legends → `ui.statTip` / `entityRef` (`.codex-tip` / `.codex-pop`); warnings →
  `.codex-warnings`; stat glyphs → `host.h.icon(name)` (`.codex-icon`; feature-
  detect and fall back to text); browse rows/tiles + skeletons → `.codex-link-row`
  / `.codex-link-tile` / `.codex-skel`. Do NOT hand-roll a look-alike (custom −/＋
  buttons, a bespoke tab underline, a local SVG glyph set): budget/live-play logic
  can live addon-side, but the *control* is the host's. Quick-adjust action
  buttons (tracker ±) use `.inline-create-btn`. When something addon-local
  proves generic (a 2nd consumer appears), promote it INTO `ttrpg-codex`
  rather than copying it between addons — that's how the `.codex-*`
  family grew; domain *semantics* (save shields, prof dots) stay addon-side,
  built from host tokens.
- **What deliberately stays addon-local** (boundary, not debt): composition
  helpers (`ui.js` `heroTile`/`abilityTile` — layout arrangements OF host
  components), the sheet's page-layout CSS (`ctx.ui.styleTag`, scoped under
  `.addon-dnd-sheets`), and domain indicators (save-shield fill, 3-state
  proficiency dots, AC shield dot — game semantics, not reusable chrome).
  All token-built, so themes still apply.
- `register(host)` side-effect-free except `register*`; renderers must survive
  sparse/empty input (blobs from older schema versions included — `model.js`
  forward-migrates on read).
- Action names are internal UI wiring, not a consumer API. The public
  programmatic contract is the versioned object passed to `host.provide()`.
  `tests/smoke.mjs` locks the retained action inventory, render paths, and
  unload/reload cleanup.
- Code and source data stay in **English**. UI text is keyed through the
  scoped `host.i18n` facade; English lives in `locales/en.json`, and any
  additional locale may be partial.

## Settled decisions (don't relitigate)

- **One edition per campaign; the data addon dictates the rules.** The engine
  is edition-parameterized (ARCH-7) with built-in 2024 defaults; 2014 lands as
  structural shapes gated on record-field presence, shipped by a
  `dnd5e-compendium` data addon (ROADMAP item 9).
- **Combat automation out of scope** — the sheet stores/computes; a combat
  resolver would be a separate addon consuming this one's `provide()`.
- Engine mode == book data present (the 4-state matrix collapsed when the
  engine merged in); stored `overrides[field]` always beats computed (ARCH-3).
- When the engine is present, editing flows through the Builder; inline edits
  cover the standalone mode.
- **Whole-state Builder** — every choice stays freely editable at any time;
  never lock out corrections (guide, don't block: warnings are advisory,
  unaffordable actions clamp instead of refusing).

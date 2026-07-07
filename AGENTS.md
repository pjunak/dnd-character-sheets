# AGENTS.md — dnd55e-character-sheets (repo guide for AI agents)

**What this repo is.** The D&D 5.5e (2024) character-sheet addon for the
[ttrpg-codex](https://github.com/pjunak/ttrpg-codex) host app. **Addon id is
`dnd55e-sheets`** — deliberately ≠ the repo dir name, so
`character.addonData['dnd55e-sheets']` never needed a migration; the host keys
on the manifest id. Tabbed sheet UI (Overview / Character Sheet [incl. inventory] /
Combat / Spellbook / Builder) **plus the built-in pure rules engine**
(`rules/engine.js` + `rules/api.js`, merged in from the retired
`dnd55e-core-rules` addon). Standalone hand-fillable; declares
`optionalDependencies: dnd55e-players-handbook` — engine mode lights up when
that book addon's data is present. `provide()`s the rules API for future
consumers (e.g. a combat addon).

## Read these first

1. [`README.md`](README.md) — tabs, editing model, dev + test commands.
2. [`rules/README.md`](rules/README.md) — the engine: merge history, layout,
   hydration pipeline, slot/multiclass semantics.
3. [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md) — the design spine
   (stable IDs ARCH-*/SP-*/…, locked decisions §13). Historical names inside
   entries ("core-rules", "compendium") are retired — the header explains how
   to read them; `model.js` is the truth for shipped field names.
4. The **canonical addon-authoring contract** lives in the host repo:
   `../ttrpg-codex/examples/addons/AGENTS.md` (condensed) and
   `../ttrpg-codex/examples/addons/AUTHORING.md` (full reference,
   [GitHub](https://github.com/pjunak/ttrpg-codex/blob/main/examples/addons/AUTHORING.md)).
   This file deliberately does NOT vendor a copy — a stale copy misled agents
   here before.

## Layout + the naming trap

```
addon.json          manifest — id dnd55e-sheets, optionalDependencies, tests.client
entry.js            register(host), tab strip + routing, vitals-bar placement —
                    its header comment is the de-facto architecture doc
model.js            THE data layer: stored-blob read/migration, viewModel,
                    builderMutate + materializeInto (DEG-1), getRules() probe
panel.overview.js   ⚠ renders the CHARACTER SHEET tab (id `stats`) — entry.js appends
                    panel.backpack.js below it (Backpack has no own tab anymore)
panel.sheet.js      ⚠ renders the COMBAT tab
panel.spellbook.js / panel.backpack.js / panel.builder.js / editor.js
panel.print.js      print/PDF sheet (new-window, self-contained) + JSON import modal
rules/              the PURE engine (host-free, unit-tested): engine.js + api.js
tests/              smoke.mjs + rules.mjs (+ fake-phb.mjs fixture data)
```
The Overview tab has no module — it is the host's own wiki profile folded in
via the `characters:body` takeover.

The **Builder** is internally sub-tabbed: a **Character** tab (abilities, species,
background, class roster, level-independent extra feats) + **one tab per class**,
each a per-level **progression spine** whose rows expand in place (accordion) to
edit that level's choices. Sub-tab / open-row are in-memory (`ctx.builderState`,
not persisted). A sheet-wide toolbar offers Print / Export / Import (B4.6).

## Layering rules (where new code goes)

- **Panels render only.** No stored-blob mutation, no rules math in panels.
- **`model.js` owns the pipeline + every mutator.** Any new engine-affecting
  mutation MUST route through `builderMutate`/`materializeInto` — that is the
  **DEG-1 obligation**: every Builder edit materializes computed values into
  the flat fallback fields so removing the engine/book degrades to a
  hand-filled sheet, never a data loss.
- **`rules/` stays pure and host-free** (no `host`, no DOM) — that's what
  makes it unit-testable. Rules facts (point-buy costs, clamps, tables) live
  here, never in panels.
- **Content belongs in the book addon** (`../dnd55e-players-handbook`) — this
  repo ships no rulebook data; `tests/fake-phb.mjs` fakes it for engine-mode
  tests.

## Working here — the facts that bite

- **Sibling checkouts assumed**: `../ttrpg-codex` (harness + dev-install),
  `../dnd55e-players-handbook` (the data this consumes; its `data/SCHEMA.md`
  is the record-shape contract behind `rules/api.js`), `../Living-scroll`
  (Python port source-of-truth for rule edge cases).
- **Dev loop**: from `../ttrpg-codex` run
  `node scripts/dev-install-addon.cjs ../dnd55e-character-sheets`, restart the
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
  `.codex-warnings`. Do NOT hand-roll a look-alike (custom −/＋ buttons, a bespoke
  tab underline): budget/live-play logic can live addon-side, but the *control* is
  the host's. Quick-adjust action buttons (HP ±, tracker ±) use `.inline-create-btn`.
- `register(host)` side-effect-free except `register*`; renderers must survive
  sparse/empty input (blobs from older schema versions included — `model.js`
  forward-migrates on read).
- Everything in **English**.

## Settled decisions (don't relitigate)

- **2024 rules only** (2014 = separate future addons).
- **Combat automation out of scope** — the sheet stores/computes; a combat
  resolver would be a separate addon consuming this one's `provide()`.
- Engine mode == book data present (the 4-state matrix collapsed when the
  engine merged in); stored `overrides[field]` always beats computed (ARCH-3).
- When the engine is present, editing flows through the Builder; inline edits
  cover the standalone mode.

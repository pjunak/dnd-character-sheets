# ROADMAP — dnd55e-character-sheets (engine + character sheet)

Concise, **forward-looking** dev roadmap (agent-maintained): remaining work + deferred backlog only.
Repo guide: [`AGENTS.md`](AGENTS.md); edge-case ledger: [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md).
Shipped history lives in git + `AGENTS.md` — it is not repeated here.

## Architecture (one-liners)
- Built-in rules engine (`rules/engine.js` pure pipeline + `rules/api.js`) bound to live book data via
  `host.use('dnd55e-players-handbook')`. Standalone (no book) degrades to a hand-filled sheet (DEG-1/ARCH-4).
- `model.js` = adapter: `builderModel`/`collectChoices`/`resolveChoices`/`reconcile`/`decisionsOf`/`materializeInto`
  + `mutate`/`builderMutate`. Panels render from `ctx` (helpers/ui/engine). `ui.js` `statTip`/`entityRef` are the
  hover+link primitives; `helpers.js` holds `compendiumHref`/`firstPara`/`featureRecordFor`.
- Builder is internally **tabbed** (Character tab + one per class); each class tab is a per-level **progression spine**
  with click-to-expand rows. Whole-state — every choice stays freely editable at any time (never lock out corrections).

## Shipped
Everything through **B4.6** is integrated to `main`: feature-kind consumption, hover+link per entity, builder
correctness (reconcile/FE-7), the spellbook (Wizard learned-pool + copy-from-scroll / add-from-another-source), Warlock
Pact Magic, the guided per-level tabbed Builder, and print/PDF + JSON export/import. Detail is in git history +
`AGENTS.md`. CI: Node 26, `setup-node@v5`; 89 tests (`node --test tests/smoke.mjs tests/rules.mjs`). **Now on `main`:** the
L1 duplicate-skill dedupe (bogus "content pending" row gone), B5 whole-row click targets (full-row overlay `<button>`,
keyboard + `aria-expanded`), and ASI number-pickers (background + every ASI level + half-feat sub-pick as ± steppers over
a shared point budget — enabling the previously-impossible +1/+1 split).

**Fixed on `agentic-dev` (awaiting integration to `main`; 92 tests):**
- **Unified-UI compliance** (`8bf1c3d`, `01a0d8e`). Per the repo principle that repeatable UI lives in `ttrpg-codex` and
  addons only consume it: the builder sub-tab strip now uses the host `.codex-tab-strip`/`.codex-tab` (like the sheet's top
  tab bar), and all three builder steppers (point-buy, ASI, class level) render the host `.codex-stepper` via `ui.numField`
  instead of hand-rolled ± buttons. Dir-based step actions became value-based set actions; orphaned actions removed.
  Principle recorded in `AGENTS.md`.
- **HP tile redesign** (`a58f367`). Current HP is a directly-editable host `.codex-stepper` (type, or ± by 1, clamped
  `[0,max]`); Max + Temp HP are small steppers beneath. Dropped the wasted vertical ± AND the separate heal/damage-by-
  amount field (+ its dead action/strings). A red stepper border flags bloodied (≤35%).
- **Vital icons** (`65aefdc`). AC / Init / Speed / Proficiency / Passive / HP now show a compact inline-SVG glyph
  (shield / bolt / chevrons / +badge / eye / heart, gold-theme stroke) in the `.codex-tile` label slot; the full stat name
  stays as the tile title + the icon's `aria-label`. `ui.heroTile` gained an `icon` option.
- **Backpack folded into the Character Sheet tab** (`689527e`). Retired the standalone Backpack tab; inventory + currency
  render full-width at the bottom of the Character Sheet under a 🎒 heading. Strip: Overview / Character Sheet / Combat /
  (Spellbook) / (Builder).

## Remaining (in order)

1. **B5 — remaining UI polish.**
   - **Hover / focus-visible feedback** on the builder spine rows + compendium browse rows — NOW ACHIEVABLE (earlier notes
     wrongly said blocked): the sheet injects a `<style>` via `ctx.ui.styleTag`, so `:hover`/`:focus-visible` rules can ship
     addon-side; the handbook can add the same to its route render.
   - **Bigger click targets, round 2.** Audit chips + proficiency dots for the same tiny-hit-area problem.
   - Record **images** (render seam exists; nothing ships images — needs an image source); **accessibility** (`aria-live`
     on the budget/point counts, keyboard tab-nav on the builder sub-tabs); **skeleton** loading. The PB icon (+badge) may
     want a less "add"-like glyph. Full **mobile** layout is out of scope (needs a dedicated redesign — maintainer's call).

## Deferred / tech-debt
- **B4.5b hover-preview (maybe):** the guided spine expands rows on **click**. A future option — hover a collapsed row
  for a **read-only** preview, click to pin into edit — was deferred (hover-expand with native `<select>` + full
  re-render is fragile; a two-state design that cuts against "less code"). Revisit if the quick-glance proves worth it.
- **FE-8** feature-owned structured mechanics — revisit only when a provenance-dependent feature demands it.
- **Epic Boon @19** still modeled as a generic ASI (its own 2024 feat category; `feat.epicBoon` exists).
- Inventory items store only `it.ref`, not kind (probe weapon→armor; extend or store kind if more ref-kinds appear).
- **Spellbook-management refinements:** (a) a **source note on copied spells** — copied refs live in the flat
  `s.spellbook` array, so only custom spells (`s.spells`) carry `sourceNote`; a per-book-entry note needs book metadata
  (ref → `{note,cost}`). (b) **scroll→spell auto-detection** — the copy form lists `/scroll/i` inventory items and
  consumes the chosen one, but doesn't verify it holds the picked spell. (c) gp is deducted clamped ≥0 and does **not**
  hard-block an unaffordable copy (by design — guide, don't lock out).
- **Print/export refinements:** print sheet labels are English-only (i18n later); import is paste-JSON (a file-picker
  import is a nice-to-have).

## Workflow
All agent work on **`agentic-dev`**; maintainer cherry-picks → `main`. **Verify `git branch --show-current` == `agentic-dev`
immediately before every commit** (a commit-time guard has already caught one slip). Sync `agentic-dev` onto `main`
before a new batch. Run `node --test tests/smoke.mjs tests/rules.mjs` (relative paths; PowerShell for node) before committing.

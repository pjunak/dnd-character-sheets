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
`AGENTS.md`. CI: Node 26, `setup-node@v5`. **Also on `main`:** the L1 duplicate-skill dedupe and the whole **B5
UI-polish batch** — whole-row click targets + hover/focus feedback, ASI number-pickers (shared budget, +1/+1 splits),
unified-UI compliance (host tab strip + steppers), the editable-HP tile redesign, vital icons, Backpack folded into the
Character Sheet tab, 3-state proficiency dots + AC shield indicator, builder sub-tab keyboard nav, chip comfort height.

**On `agentic-dev` (awaiting integration to `main`; 95 tests):**
- **Vitals glyphs now come from the HOST icon set.** The unified-UI hoist landed: `ttrpg-codex` (commit `a60f100`,
  its `agentic-dev`) now owns `.codex-link-row`/`.codex-link-tile`, `.codex-skel`, and `utils.iconGlyph` → `host.h.icon`
  (as `.codex-icon` SVGs, stroke `currentColor`), plus a harness mirror and a `design-system.test.mjs` pinning the
  guarantees. This repo deleted its local vitals SVG set — `panel.header.js` maps stat→glyph and feature-detects
  `h.icon` (an older host degrades to text labels; regression-tested both ways).
  ⚠ Integration order: **codex first**, then the addons (addon CI checks out `ttrpg-codex@main` for the harness).
- **Chips promoted + PB glyph fixed** (codex `b3229fc`). Spell/inventory chips render the host `.codex-chip`
  (+ `-danger`) — the local `S.chip` style string is gone; the PB tile switched from `plus-circle` (read as an "add"
  button) to the new `medal` glyph. This closes the chips promotion candidate from the boundary note below.

## Remaining (in order)

1. **B5 — remaining UI polish.** Done except two externally-gated items:
   - Record **images** (blocked — needs the maintainer's image source/licensing decision; the render seam exists).
   - Full **mobile** layout is out of scope (needs a dedicated redesign).
   (Everything else shipped: click targets, hover/focus, steppers, HP tile, icons — PB now a `medal` glyph — dots,
   keyboard nav, chips, skeletons where applicable. The sheet renders synchronously from the store, so it has nothing
   to skeleton.)

## Deferred / tech-debt
- **Unified-UI boundary (what stays addon-side, and why).** The generic pieces are hoisted (host owns tokens + the
  `.codex-*` component classes + the `h.icon` glyph set; this addon only consumes). What remains addon-local is
  *deliberate*, not debt: (a) **composition helpers** (`ui.js` `heroTile`/`abilityTile`) — layout arrangements OF host
  components for this sheet, not reusable chrome; (b) **`ctx.ui.styleTag`** — page-layout CSS for the sheet's column
  grid + spine rows, scoped under `.addon-dnd55e-sheets` per the host CSS contract; (c) **domain indicators** — the
  save shield (fill = proficiency), 3-state proficiency dots, AC shield dot: these encode D&D *semantics*, and hoisting
  them would push game concepts into a game-agnostic host. All are built from host tokens, so themes still apply.
  The chips candidate is closed: the design pass split it into `.codex-chip` (management chip, this repo) and
  `.codex-badge` (read-only fact pill, PHB + bestiary) — different components, one home (codex `b3229fc`).
  The agent may do such promotions itself on the codex `agentic-dev` branch (maintainer-directed 2026-07-08); the
  old "host is reference-only" note is obsolete.
- **`aria-live` budget counts (deferred).** Announcing point-buy/ASI "N pts left" changes to screen readers needs a
  *persistent* live region, but every edit re-renders the whole panel (no stable element survives), so `aria-live` there
  wouldn't announce reliably. Revisit if the panels move to a targeted-update / stable-live-region model.
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

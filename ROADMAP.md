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
`AGENTS.md`. CI: Node 26, `setup-node@v5`; 84 tests on `main` (`node --test tests/smoke.mjs tests/rules.mjs`).

**Fixed on `agentic-dev` (awaiting integration to `main`; 89 tests):**
- **Duplicate-skill-choice bug** (`836754d`). Every class declared its L1 skills choice twice — `startingProficiencies.skills`
  (with a `from` pool) AND a redundant bare `grants.choices` `{type:'skills'}` with no `from` — so `collectChoices` emitted a
  second empty `enumerated` descriptor that rendered a bogus "No options available (content pending)" row at L1 on all 12
  classes. `collectChoices` now dedupes by descriptor id (keep-first); the handbook also drops the redundant entry (either
  alone suffices). Real-data-shaped regression test added (the shared fake doesn't replicate the duplication).
- **B5 · bigger click targets** (`6bd3b17`). The whole builder spine row is now the toggle — a full-row overlay `<button>`
  layered behind the content (dead-space clicks fall through via pointer-events; inner compendium links stay live;
  keyboard-focusable + `aria-expanded`), replacing the tiny "L1"-only hit area.
- **B5 · ASI number pickers** (`f0b5b06`). The ASI split-select dropdowns (background ASI + each ASI level + half-feat
  ability sub-pick) are now +/- steppers per eligible ability sharing a cumulative budget (class ASI 2 / bg 3 / half-feat
  its amount) — also enabling the previously-impossible +1/+1 split. `builderAsiStep` re-validates the budget; the
  abilityGrants map stays the engine's source of truth.

## Remaining (in order)

1. **B5 — remaining UI polish.** (Bigger click targets + ASI number pickers landed — see above.)
   - **Bigger click targets, round 2.** Audit the OTHER controls flagged — chips, tiles, proficiency dots — for the same
     tiny-hit-area problem, and the compendium browse side (see the handbook ROADMAP).
   - Record **images** (render seam exists; nothing ships images — needs an image source/decision); **accessibility**
     (focus-visible, `aria-live`, `<label>`/select association, keyboard nav); **responsive/mobile**; **skeleton** loading.

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

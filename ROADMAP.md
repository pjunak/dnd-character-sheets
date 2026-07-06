# ROADMAP — dnd55e-character-sheets (engine + character sheet)

Concise dev roadmap (agent-maintained). Repo guide: [`AGENTS.md`](AGENTS.md); edge-case ledger:
[`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md); cross-repo history: the maintainer's plan file.

## Architecture (one-liners)
- Built-in rules engine (`rules/engine.js` pure pipeline + `rules/api.js`) bound to live book data via
  `host.use('dnd55e-players-handbook')`. Standalone (no book) degrades to a hand-filled sheet (DEG-1/ARCH-4).
- `model.js` = adapter: `builderModel`/`collectChoices`/`resolveChoices`/`reconcile`/`decisionsOf`/`materializeInto`
  + `mutate`/`builderMutate`. Panels render from `ctx` (helpers/ui/engine). `ui.js` `statTip`/`entityRef` are the
  hover+link primitives; `helpers.js` holds `compendiumHref`/`firstPara`/`featureRecordFor`.
- Whole-state Builder: every choice stays freely editable at any time (never lock out corrections).

## Shipped (integrated to main)
- feature-kind consumption: Builder-log hover cards + `fromCategory` option-pool expansion.
- **B1.2** clickable feature names in the Builder log.
- **B2** hover+link per entity — spells (Spellbook + Combat), equipment (`attacksBlock` + Backpack), class/subclass
  (header line). Shared `entityRef(kind,id,name,legend)` + `compendiumHref` + `firstPara`.
- **B4.0** builder correctness — `reconcile()` prunes orphaned choices/ability-grants after structural edits (fixes
  phantom ASI bumps); ASI levels derived from class `progression` (Fighter 6/14, Rogue 10); bg-ASI + half-feat verified.
- **B4.1 (FE-7)** option-pool pick uniqueness (sibling exclusion + dedup); the whole-state editor IS the "swap".
- **B4.2a** per-class prepared-level cap (`maxSpellLevel`) + ritual affordance (⟳ on prepared ritual spells).
- **B4.3** Warlock Pact Magic — `pactMagic(level)` (derived 2024 table); short-rest `pact-slot` resource; no combine.
- **B4.4** read-tab **Features summary** (Combat tab) + feats ↗ link; `featureRecordFor` promoted to `helpers.js`.
- **B4.5 spell swap** — 🔄 button + floating picker + persisted `spellSwaps` history (`{level,classId,out,in}`,
  out→in with hover+link, ✕-to-forget). Coexists with free re-prep.
- **B4.2b Wizard spellbook (SP-5)** — a `prepares:'spellbook'` caster prepares from a LEARNED pool (`s.spellbook`),
  not the whole class list: a Spellbook group (learn/forget from the class list, drag or click) + free-by-level hint
  (engine `spellbookKnown` = 6 + 2·(L−1)); the prepared pool + swap-in pool draw from the book. Non-wizards unchanged.
- **Spellbook management (B4.2c)** — TWO add buttons on the Spellbook tab: **📜 Copy from a spell scroll** (spellbook
  casters only — pick a class spell, pay 50 gp × level, optionally consume a `/scroll/i` inventory item → `s.spellbook`,
  preparable) and **✎ Add from another source** (any class — feat / magic item / homebrew: `origin:'other'` + free-text
  `sourceNote` + a **cast-with-slots** flag defaulting on for spellcasters, per 2024/SP-10). Each opens a focused
  floating modal (mode in the flag value) with its own removal list; other-source spells show a ◈ "castable with
  spell slots" marker. Non-casters get only "another source" (no cast-with-slots).
- **B4.5b Guided per-level flow (capstone)** — the Builder is internally **tabbed**: a **Character tab** (abilities,
  species/lineage, background + bg-ASI, class roster, and level-independent **extra feats** — compendium featId feeds the
  engine or free-text, each with a source note) + **one tab per class**. Each class tab is that class's **progression
  spine**: a row per class level with features (link+hover) + the **choices made as chips** (subclass, ASI/feat, skills,
  pools, **spell swaps out→in at their level**); **click a row to expand it in place** (accordion, one open at a time)
  into that level's editors; **level via +/-** (a + opens the new level); soft "needs choices" flag (never blocks).
  Sub-tab + open-row are in-memory (default Character, not persisted). Swaps stamp the class level for placement.
- CI: Node 26, `setup-node@v5`; 80 tests green (`node --test tests/smoke.mjs tests/rules.mjs`).

## Remaining (in order)
1. **B4.6 — Export / print / share** a sheet.
2. **B5 — UI polish.** Record images; accessibility (focus-visible, aria-live, `<label>`, keyboard nav); responsive;
   skeletons.

## Deferred / tech-debt
- **B4.5b hover-preview (maybe):** the guided spine expands rows on **click**. A future option — hover a collapsed row
  to show a **read-only** preview of that level, click to pin into edit — was considered and deferred (hover-expand with
  native `<select>` controls + full re-render is fragile; it's a two-state design that cuts against "less code"). Revisit
  if the quick-glance proves worth it.
- **FE-8** feature-owned structured mechanics — revisit only when a provenance-dependent feature demands it.
- **Epic Boon @19** still modeled as a generic ASI (its own 2024 feat category; `feat.epicBoon` exists).
- Inventory items store only `it.ref`, not kind (probe weapon→armor; extend or store kind if more ref-kinds appear).
- **Spellbook-management refinements** (from the copy/custom popup): (a) a **source note on copied spells** — copied
  refs live in the flat `s.spellbook` array, so only custom spells (in `s.spells`) carry `sourceNote`; a per-book-entry
  note needs book metadata (ref → `{note,cost}`). (b) **scroll→spell auto-detection** — the copy form lists `/scroll/i`
  inventory items and consumes the chosen one, but doesn't verify it actually holds the picked spell (no data links a
  scroll record to its spell). (c) gp is deducted clamped ≥0 and does **not** hard-block an unaffordable copy (by
  design — guide, don't lock out).

## Workflow
All agent work on **`agentic-dev`**; maintainer cherry-picks → `main`. **Verify `git branch --show-current` before
each commit.** Run `node --test tests/smoke.mjs tests/rules.mjs` (relative paths; PowerShell for node) before committing.

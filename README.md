# dnd-sheets

A **fully hand-fillable D&D character sheet** addon for
[ttrpg-codex](https://github.com/pjunak/ttrpg-codex) (the *O Barvách Draků* CodexHost
framework). Addon id: `dnd-sheets`.

The sheet stores its D&D data per character in `character.addonData['dnd-sheets']`
— it does **not** own a collection, and it does **not** duplicate anything the host
already owns (name, portrait, species, lore, relationships). It integrates by claiming
the host's character `body` fragment (`registerFragmentOp` · replace), which makes the
article full-width: the host folds its side-card and every relationship/event section
into the body html this addon receives, and the addon shows that whole wiki profile as
its first tab.

## What it does

The character's native page **is** the Overview tab: the host's side-card (with its
✏ Upravit button), connections, facts and lore arrive folded into the body fragment,
so the tab strip sits at the very top of the page (only the host's breadcrumb rides
above it). The D&D tabs follow:

- **Overview** — the host's own wiki profile (side-card + sections + lore), reused as tab 1 (not copied).
- **Character Sheet** — D&D identity (class/level/background/alignment), ability scores,
  saving throws, skills, mechanical notes, and **inventory + currency** grouped by
  carry location.
- **Combat** — attacks from equipped/ready weapons, a castable-spells quick-reference,
  and resource trackers (Rage, Ki, slots…) with the Rest wizard.
- **Spellbook** — prepared/cantrip slots, granted & choose-grant sections; a Wizard prepares from a **learned
  spellbook** (copy from a scroll for gp) and any class can **add a spell from another source** (feat/item/homebrew,
  slot-castable for casters); level-up spell **swaps** are recorded with history.
- **Builder** — a responsive **build-progress rail** links every unresolved
  foundation, class, subclass, feat, proficiency, and granted-spell decision
  to its editor. A **Character** tab owns creation choices; each class gets a
  per-level progression spine whose rows expand in place.
  Only with the rules engine and only for editors.
- **Settings** — per-sheet tools, rightmost: the vitals-layout switch (compact /
  classic), plus **🖨 Print / PDF** (a self-contained printable sheet), **⬇ Export**
  (download a versioned character JSON), and **⬆ Import** (file or paste,
  bounded validation, preview, explicit confirmation, and immediate undo —
  editors only).

A slim **vitals bar** (a directly-editable **HP** stepper, plus text-labelled AC,
Initiative, Speed, Passive Perception and a class-level line — Proficiency has no
tile, it's already folded into every formula) renders full-width under the tabs on
Spellbook; Character Sheet and Combat place it inside their own right column.

**Editing is direct and role-gated — there is no separate "edit mode" and no second edit
button.** The host's own **✏ Upravit** owns identity/lore/portrait (it rides the host
side-card, which lands inside the Overview tab); editors
(`!isAnonymous()`) change D&D stats directly in the tabs (and the Builder), while
anonymous viewers get a clean read-only sheet. Live-play controls (HP, trackers,
spell prep, proficiency toggles) follow the same gate.

Everything can be entered by hand. The **rules engine is built in** (`rules/engine.js`, a
pure host-free module) — but without book data it only does universal D&D arithmetic
(ability modifiers `⌊(score−10)/2⌋`, proficiency totals). The addon has **no hard
dependencies** and works entirely standalone.

## Architecture

`entry.js` is the composition root: it builds the model/UI context, composes the
panels, registers the character-body fragment, provides the versioned rules API,
and collects domain disposers. Controller actions live in focused modules:

- `actions.base.js` — tabs, direct fields/proficiencies, overrides, layout.
- `actions.spells.js` — preparation, spellbooks, grants, swaps, drag/drop,
  and spell management.
- `actions.inventory.js` — inventory/equipment and the add-item wizard.
- `actions.resources.js` — resources and rests.
- `actions.builder.js` — guided Builder decisions.
- `builder-progress.js` — pure completion model and navigation targets for the
  Builder progress rail.
- `actions.transfer.js` — print, JSON export, and import.
- `ui-state.js` — isolated per-character session state, with persistence limited
  to tab and layout preferences.
- `equipment-model.js` — pure inventory resolution and equipment-slot
  classification shared by the header and backpack.
- `sheet-transfer.js` — versioned export envelope and bounded legacy-compatible
  import validation.
- `provider-state.js` — per-character materialized baseline and explicit
  rulebook-return reconciliation.

Panels remain render-only, `model.js` owns stored-sheet mutation and
materialization, and `rules/` remains pure and host-free. Action names are
internal UI wiring; the supported consumer contract is the rules object exposed
through `host.provide()`.

## Designed to grow

- **Rules in harmony:** the sheet *soft-uses* a rules-data addon
  (`dnd55e-compendium`, a manifest `optionalDependencies` entry) — when one is
  installed, the built-in engine auto-fills stats from class/species/background choices,
  free-text fields become dropdowns, and the Builder tab appears. If the book addon is
  absent, the sheet falls back to manual entry — installing/uninstalling it never breaks
  a sheet. Further books ride the compendium's content groups (DM-toggleable per
  campaign), and the engine is **edition-parameterized**: built-in 2024 constants,
  overridable by a provider's `ruleset` record (`dnd5e-compendium` is the reserved
  2014 provider). If computed flat values were edited while the provider was
  unavailable, that character stays hand-filled until the user explicitly
  keeps manual mode or resumes the rulebook; other characters are unaffected.
  Supplement records can add fixed traits and proficiencies, runtime choices,
  expanded spell lists, granted-spell casting abilities and upcast schedules,
  resource pools, selected self-effect modes, and class-specific attunement
  limits without book-specific code. The same generic contract handles nested
  proficiency grants, senses, mutually exclusive modes, delegated subclass
  spell lists, and printed armor restrictions. Disabling a compendium book group removes
  those records from hydration; stored fallback fields cannot turn a removed
  rule grant into a manual choice.
- **Rules API for other addons:** the addon `provide()`s the same rules api the panels
  consume (`hydrate` / `derive.*` / `list*` passthroughs), so another addon can
  declare a dependency on `dnd-sheets` and reuse the engine.
- **Localization:** all UI strings flow through the scoped `host.i18n` facade.
  `addon.json` declares packaged JSON catalogs under `locales/`; English is the
  source of truth and partial translations fall back per key through the host's
  per-user locale rules. The current package ships English.

## Develop

No build step (browser ES modules). From a sibling checkout of the host:

```sh
node scripts/dev-install-addon.cjs ../dnd-character-sheets   # from the ttrpg-codex repo
```

Run the complete test suite (assume the host repo is a sibling directory):

```sh
node --test tests/*.mjs
```

See [`rules/README.md`](rules/README.md) for the provided API and
[`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md) for the canonical
runtime semantics. [`AGENTS.md`](AGENTS.md) contains the repository contract.

## License

The original software and documentation in this repository are licensed under
the [MIT License](LICENSE).

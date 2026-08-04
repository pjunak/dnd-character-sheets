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
- **Settings** — per-sheet tools, rightmost: a per-character, per-browser style
  selector (Compact by default, Classic built in, compatible renderer addons
  discovered automatically), plus **🖨 Print / PDF** (a self-contained printable sheet), **⬇ Export**
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

Everything can be entered by hand. Rules computation is optional and belongs to
a separate addon implementing `dnd5e.rules-engine`; rules records belong to a
separate `dnd5e.rules-data` provider. The sheet has no hard dependency on either
and remains usable when they are absent, disabled, or temporarily unavailable.

## Architecture

`entry.js` is the composition root: it builds the model/UI context, composes the
panels, registers the character-body fragment, discovers services, and collects
domain disposers. Controller actions live in focused modules:

- `actions.base.js` — tabs, direct fields/proficiencies, overrides, renderer selection.
- `actions.spells.js` — preparation, spellbooks, grants, swaps, drag/drop,
  and spell management.
- `actions.inventory.js` — inventory/equipment and the add-item wizard.
- `actions.resources.js` — resources and rests.
- `actions.builder.js` — guided Builder decisions.
- `builder-progress.js` — pure completion model and navigation targets for the
  Builder progress rail.
- `actions.transfer.js` — print, JSON export, and import.
- `ui-state.js` — isolated per-character session state, with persistence limited
  to tab and renderer preferences.
- `renderer-registry.js` — normalized built-in and third-party renderer discovery,
  permission checks, selection, and failure fallback.
- `equipment-model.js` — pure inventory resolution and equipment-slot
  classification shared by the header and backpack.
- `sheet-transfer.js` — versioned export envelope and bounded legacy-compatible
  import validation.
- `provider-state.js` — per-character materialized baseline and explicit
  rulebook-return reconciliation.

Panels remain render-only and `model.js` owns stored-sheet mutation,
materialization, and service-identity reconciliation. Rules implementation and
rules data are intentionally absent from this repository.

## Designed to grow

- **Rules in harmony:** the sheet consumes one optional, host-selected
  `dnd5e.rules-engine` service. That engine consumes a compatible rules-data
  provider without the sheet naming either addon. When both are available the
  engine auto-fills stats and unlocks the Builder; otherwise the sheet uses its
  durable hand-filled/materialized fields. If computed flat values were edited while the provider was
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
- **Independent styles:** any addon can provide `dnd-sheets.renderer` v1. The
  sheet lists compatible providers automatically; no repository change or
  addon-id whitelist is required. Renderer preference is local to each browser
  and character, Compact is the safe fallback, and unavailable preferences are retained.
- **Localization:** all UI strings flow through the scoped `host.i18n` facade.
  `addon.json` declares packaged JSON catalogs under `locales/`; English is the
  source of truth and partial translations fall back per key through the host's
  per-user locale rules. The current package ships English.

## Upgrade from the built-in rules engine

For an existing installation, install `dnd-engine` first, then update the
rules-data addon, and update `dnd-sheets` last. The official compendium keeps a
temporary legacy publication during this migration, so an older sheet release
continues to automate while the new engine is being introduced. Once this
sheet version is active, it uses only the host-selected `dnd5e.rules-engine`
service and never names the compendium or engine addon.

If no compatible engine is selected, sheets remain hand-fillable and retain
their stored/materialized values. Installing a compatible engine later enables
the Builder without migrating the `dnd-sheets` character namespace.

## Develop

No build step (browser ES modules). From a sibling checkout of the host:

```sh
node scripts/dev-install-addon.cjs ../dnd-character-sheets   # from the ttrpg-codex repo
```

Run the complete test suite (assume the host and `addon-dnd-engine` repos are
sibling directories):

```sh
node --test tests/*.mjs
```

See [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md) for the sheet-side
service and reconciliation semantics and
[`docs/RENDERER_CONTRACT.md`](docs/RENDERER_CONTRACT.md) for third-party style
authoring. [`AGENTS.md`](AGENTS.md) contains the
repository contract; the engine API is documented in the sibling engine repo.

## License

The original software and documentation in this repository are licensed under
the [MIT License](LICENSE).

# AGENTS.md — dnd-character-sheets

This repository contains the `dnd-sheets` addon for the sibling
`ttrpg-codex` host. The manifest ID is a permanent data namespace:
character state lives at `character.addonData["dnd-sheets"]`. Do not rename it
without a data migration.

The addon remains hand-fillable without a provider. When a compatible
compendium is present, its built-in pure rules engine hydrates a guided builder
and computed sheet. It publishes a versioned rules API for optional consumers.

## Read before editing

1. [`README.md`](README.md) for user-visible behavior and development commands.
2. [`rules/README.md`](rules/README.md) for the rules-engine boundary.
3. [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md) for current mechanics
   and deliberately unsupported cases.
4. `../ttrpg-codex/examples/addons/AGENTS.md` for the host contract.
5. `../dnd55e-compendium/data/SCHEMA.md` when changing provider record use.

`model.js` and the tests are authoritative for stored field names. Do not copy
the host authoring contract into this repository.

## Architecture

```text
addon.json              API-v2 manifest and optional providers
entry.js                composition root and public API registration
actions.*.js            domain controllers and owned cleanup
actions.shared.js       action-map registration helper
model.js                stored-blob migration, view model, builder mutations
provider-state.js       provider detection and per-character materialization
ui-state.js             session UI state and persisted view preferences
equipment-model.js      pure inventory/equipment resolution
sheet-transfer.js       bounded, versioned JSON import/export
panel.*.js              rendering only
ui.js / helpers.js      shared presentation helpers
rules/                  pure host-free rules engine and public API
locales/en.json         complete English UI source catalog
tests/                  smoke, rule, state, transfer, and pure-module tests
```

The host wiki profile is the Overview tab. `panel.overview.js` renders the
Character Sheet tab and composes the backpack below it; `panel.sheet.js`
renders Combat. Preserve this naming unless doing a deliberate, tested rename.

## Boundaries that protect maintainability

- `entry.js` composes modules. Register each action in exactly one domain
  controller and pass dependencies explicitly.
- Panels render. They do not mutate stored blobs or implement rules math.
- `model.js` owns migrations and mutations. Builder changes flow through
  `builderMutate()` and `materializeInto()` so computed state is copied into
  flat fallback fields.
- The fallback fields are a durability contract: losing or disabling a
  provider must leave a usable hand-filled sheet rather than erase data.
- `provider-state.js` resolves provider availability per character. Do not
  assume a globally installed provider means every stored character is safe to
  recompute.
- `rules/` stays deterministic, host-free, and DOM-free. Rules facts and
  edition-dependent tables belong there, not in panels.
- Rulebook records belong in a compendium addon. Tests use `tests/fake-phb.mjs`
  instead of embedding production book data.
- Add supplement mechanics through generic documented record fields. Do not
  branch on sourcebook IDs in the engine, model, panels, or actions.
- `ui-state.js` owns transient navigation, modal, wizard, and selection state.
  Persist only intentional view preferences.
- Domain controllers dispose their own timers, URLs, listeners, and other
  resources. The host disposes registrations.
- Optional providers enhance the sheet but never become an accidental hard
  dependency. Probe through `host.use()` behind a coherent standalone fallback.
- Action names are internal UI wiring. The object passed to `host.provide()` is
  the versioned consumer contract.

## UI and localization

- Escape dynamic and translated text with `host.h.esc()` at HTML boundaries.
- Use host actions/events and shared `.codex-*` components for common controls.
- Keep sheet composition and D&D-specific indicators scoped under
  `.addon-dnd-sheets`; build them from host tokens.
- Promote a component into the host only after it has a genuine second
  consumer. Keep game-specific semantics local.
- English source text lives in `locales/en.json`; other catalogs may be
  partial. Never register strings in core or read host language storage
  directly.
- Renderers handle missing providers, old sparse blobs, empty collections, and
  disposal/reload without throwing.

## Working loop

Run from this repository in PowerShell:

```text
node --test tests/smoke.mjs tests/rules.mjs tests/ui-state.mjs tests/equipment-model.mjs tests/sheet-transfer.mjs tests/provider-state.mjs
```

Use relative test paths on Windows. From the host repository, install the
current source with:

```text
node scripts/dev-install-addon.cjs ../dnd-character-sheets
```

Source edits are not visible in the app until reinstall. Client-only changes
need a refresh; host/server changes may require restart. Keep test metadata
aligned with `addon.json`, and run relevant host addon compatibility tests when
the manifest or facade use changes.

Development happens on `main`. Do not create branches, commits, releases, or
pushes unless the maintainer asks. Planning notes are local-only and must not be
committed.

## Scope

- One ruleset provider is selected for a campaign; stored overrides win over
  computed values.
- Builder choices remain editable and validation is advisory where possible.
- Combat resolution/automation is a separate addon concern.
- Structured 2014 support depends on a future compatible provider and must
  remain optional until one exists.

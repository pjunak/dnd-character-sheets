# Sheet rules and renderer integration contract

This document defines the boundaries owned by `dnd-sheets`. Rules derivation
semantics belong to the selected engine addon; rules record semantics belong to
the selected rules-data provider.

## Stable ownership

- The addon id is `dnd-sheets`. It is also the permanent key at
  `character.addonData["dnd-sheets"]`; changing it requires an explicit data-key
  migration.
- The host owns character identity, portrait, lore, relationships, routing,
  authorization, persistence, and addon lifecycle.
- This addon owns the sheet decision blob, durable hand-filled/materialized
  fields, sheet tabs and actions, renderer selection UI, and renderer contract.
- This repository contains no rules engine and no rulebook records.

## Rules-engine discovery

The manifest consumes optional cardinality-one `dnd5e.rules-engine` v2 through
`host.useService()`. It never names an engine or data-provider addon. The host
selects among compatible engine providers; the engine independently selects a
compatible rules-data service.

An engine is active only when its API is compatible and `getAvailability()`
reports available rules data. Otherwise the sheet remains fully hand-fillable,
the Builder is hidden, and the last materialized flat values remain usable.

The sheet delegates ruleset-dependent calculations and Builder semantics to
the engine API. `getBuilderPlan()` supplies normalized classes, base scores,
point buy, creation grants, class choices, advancement levels, feat categories,
and caps. `applyBuilderChoice()` validates mutations, and
`reconcileBuilderDecisions()` prunes decisions invalidated by structural
changes. Panels and actions must not recreate those policies, spell-copy
costs, hit-die averages, edition constants, or sourcebook-specific branches.
Presentation vocabulary and manual-mode arithmetic may remain local.

Provider-owned record links are resolved through
`engine.resolveReference(kind, id, mode)`. The sheet must render plain text when
the provider supplies no safe route; it must never synthesize a named
compendium route.

## Stored decisions and reconciliation

The decision spine includes classes, base scores, grants, feature and spell
choices, manual proficiencies, equipment state, and overrides. Successful
hydration is copied into ordinary fallback fields so removing services never
turns a character blank or unreadable.

Each materialization stores a bounded snapshot plus the full computation
identity: engine addon/version/contract, rules-data addon/version/contract,
content revision, ruleset id/version, and edition. Recalculation pauses for that
character when:

- a materialized field was changed manually;
- the edition changed; or
- any other engine/data/ruleset/content identity component changed.

The user must explicitly keep the current values in manual mode or resume the
Builder and rematerialize. Current HP, inventory, currency, resource uses, and
other play state do not trigger reconciliation. The choice is per character.

Legacy edition-only snapshots are safe but intentionally reconcile once when a
full service identity becomes available.

## Renderer discovery and selection

The manifest consumes optional cardinality-many `dnd-sheets.renderer` v2
through `host.listServices()`. A provider is accepted by contract and schema,
not by addon id, when it:

- exposes `apiVersion: 2`, `descriptor()`, and `render(payload)`;
- declares `sheetSchemaVersion: 1` and a safe renderer id; and
- has explicit `ui:override` and `data:read:characters` grants, because the
  sheet delegates HTML production and a bounded character snapshot.

The effective renderer identity is `<provider-addon-id>:<renderer-id>`. Built-in
styles use the same registry with identities `builtin:compact` and
`builtin:classic`; Compact is the default.

Preference is stored in local browser storage per character. It is not campaign
data, so two players or browsers may choose different styles for the same
entity. Legacy Classic/Compact layout keys migrate on read. If a preferred
renderer is missing, invalid, throws, or returns an invalid result, the sheet
uses Compact without deleting the preference. It resumes automatically when
the provider returns.

A descriptor may restrict itself declaratively by class IDs, subclass IDs,
editions, and ruleset IDs. The registry evaluates those fields from the current
character and selected engine context. Inapplicable providers are omitted from
that character's selector; a previously selected provider falls back exactly
like a missing one. The sheet contains no class/subclass or provider whitelist.

The Settings tab and selector remain sheet-owned so a renderer cannot hide the
mechanism used to leave it. Renderer input is cloned/frozen, excludes other
addons' `addonData`, and includes only the bounded character identity, this
sheet's blob, computed sheet result, warnings, editability, surface, and default
HTML. Renderer output is failure-isolated and size-bounded.

## Verification

- `tests/provider-state.mjs` covers full-identity and manual reconciliation.
- `tests/renderer-registry.mjs` covers whitelist-free discovery, per-character
  and per-browser preferences, privilege checks, and safe fallback.
- `tests/smoke.mjs` covers integration against the real extracted engine with a
  synthetic rules-data provider.
- Engine mechanics and provider-schema integrity are tested in their owning
  repositories.

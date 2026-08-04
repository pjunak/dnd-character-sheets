# `dnd-sheets.renderer` v1 authoring contract

A renderer addon can add a sheet style without changing `dnd-sheets` or naming
the rules engine/data provider. The host loads compatible providers before the
sheet and the sheet discovers all of them through `host.listServices()`.

## Manifest

```json
{
  "apiVersion": 2,
  "hostVersion": ">=1.2.0",
  "permissions": ["ui:override", "data:read:characters"],
  "services": {
    "provides": [
      { "contract": "dnd-sheets.renderer", "version": "1.0.0" }
    ]
  }
}
```

Both permissions are required. The sheet rejects providers without them so a
service cannot obtain character data or inject UI through another addon's
grants.

## API

Register one immutable API object:

```js
export default function register(host) {
  const api = Object.freeze({
    apiVersion: 1,
    descriptor: () => Object.freeze({
      id: 'ink',
      label: host.i18n.t('renderer.name'),
      description: host.i18n.t('renderer.description'),
      sheetSchemaVersion: 1,
    }),
    render(payload) {
      return `<div class="my-addon-ink">${payload.defaultHtml}</div>`;
    },
  });
  host.provideService('dnd-sheets.renderer', '1.0.0', api);
}
```

`descriptor()` must return a stable lowercase `id` using letters, numbers, and
hyphens (maximum 64 characters). The persisted identity is
`<provider-addon-id>:<renderer-id>`, so neither component may be renamed without
a preference migration. Labels and descriptions are plain localized text.

`render(payload)` is synchronous and returns an HTML string. Dynamic values
must be escaped with the provider's `host.h.esc()` before interpolation. Keep
styles scoped under a provider-owned class and use host design tokens. A
renderer may wrap or replace `payload.defaultHtml`; wrapping it is the simplest
way to preserve the sheet's tested controls while changing presentation.

## Payload schema 1

The input is a detached, recursively frozen snapshot:

```text
sheetSchemaVersion  1
surface             overview | stats | combat | spellbook | builder
character           { id, title, portrait }
sheet               dnd-sheets decision/materialized blob
computed            selected engine's computed sheet, or null
warnings            engine warnings
editable            whether sheet controls may be shown
defaultHtml          built-in Compact/Classic HTML for this surface
```

The snapshot never includes another addon's `addonData`, host facades, Store
methods, DOM objects, or mutable engine/provider records. The Settings surface
is intentionally not delegated, ensuring the user can always select another
renderer.

Provider actions remain provider-owned: register them with `host.registerAction`
and create attributes with `host.h.dataAction()` / `host.h.dataOn()`. Dispose
listeners, timers, and other resources through the normal addon lifecycle.

## Failure behavior

Invalid descriptors, incompatible schema versions, missing permissions,
exceptions, non-string output, and output over the size bound are isolated. The
sheet renders Compact/default HTML and remains usable. The user's preferred
identity is retained so it resumes automatically after a temporary disable,
update, or failure is fixed.

Tests should exercise registration with the host's published addon harness and
should verify rendering over sparse, standalone, and engine-computed payloads.

# dnd55e-sheets

A **fully hand-fillable D&D 5.5e (2024) character sheet** addon for
[ttrpg-codex](https://github.com/pjunak/ttrpg-codex) (the *O Barvách Draků* CodexHost
framework). Addon id: `dnd55e-sheets`.

The sheet stores its D&D data per character in `character.addonData['dnd55e-sheets']`
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
  saving throws, skills, mechanical notes.
- **Combat** — attacks from equipped/ready weapons + resource trackers (Rage, Ki, slots…).
- **Spellbook** — prepared/cantrip slots, granted & choose-grant sections, extras
  (shown only when the character has spells).
- **Backpack** — inventory grouped by carry location + currency.
- **Builder** — guided progression; rightmost, only with the rules engine and only for
  editors.

A slim **vitals bar** (HP with live **+/-**, AC, Initiative, Speed, Proficiency, Passive
Perception, plus a class-level line) sits under the tabs on the mechanical tabs.

**Editing is direct and role-gated — there is no separate "edit mode" and no second edit
button.** The host's own **✏ Upravit** owns identity/lore/portrait (it rides the host
side-card, which lands inside the Overview tab); editors
(`!isAnonymous()`) change D&D stats directly in the tabs (and the Builder), while
anonymous viewers get a clean read-only sheet. Live-play controls (HP ±, trackers,
spell prep, proficiency toggles) follow the same gate.

Everything can be entered by hand. The only math done here is universal D&D arithmetic that
holds regardless of content — ability modifiers `⌊(score−10)/2⌋` and proficiency totals
(`mod + PB` when proficient). It has **no dependencies** and works entirely standalone.

## Designed to grow

- **Rules in harmony (later):** the sheet *soft-uses* the `dnd55e-core-rules` engine (which
  reads `dnd55e-compendium` data) to auto-fill stats from class/species/background choices
  and to turn free-text fields into dropdowns. If those addons are absent, the sheet falls
  back to manual entry — installing/uninstalling them never breaks a sheet.
- **Localization:** all UI strings flow through a vendored `i18n.js` that mirrors the host's
  localization design (English source of truth, per-locale catalogs layered on top, browser
  default, per-key English fallback). v1 ships English only; adding a language is dropping a
  `strings/<locale>.js` and one `registerCatalog` call — no rewrite.

## Develop

No build step (browser ES modules). From a sibling checkout of the host:

```sh
node scripts/dev-install-addon.cjs ../dnd_5.5e_character_sheets_addon   # from the ttrpg-codex repo
```

Run the client smoke test (assumes the host repo is a sibling directory):

```sh
node --test tests/smoke.mjs
```

See [`AGENTS.md`](AGENTS.md) for the full addon authoring contract.

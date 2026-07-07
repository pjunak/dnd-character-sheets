# ROADMAP — dnd55e-character-sheets (engine + character sheet)

**Remaining work only** — one self-contained point per possible future implementation.
Current state, architecture and workflow: [`AGENTS.md`](AGENTS.md) · shipped history: git log ·
edge-case ledger: [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md).

## Blocked on a maintainer decision

1. **Record images.** The render seam exists (`rec.image` → `host.asset`, thumbnail slots in browse
   rows); nothing ships images. Needs an image *source/licensing* decision — open-licensed sets
   (e.g. game-icons.net, already used for host map markers, CC BY), original art, or user uploads.
   Never scraped WotC art (SRD covers text only).

## Deferred features (pick up when wanted)

1. **Mobile layout.** Out of scope for incremental tweaks — needs a dedicated redesign of the
   sheet's column model. Do not attempt via CSS patches.
2. **Builder spine hover-preview.** Hover a collapsed level row → read-only preview; click to pin
   into edit. Deferred because hover-expand with native `<select>`s + full re-render is fragile.
   Revisit only if the quick-glance need proves real in play.
3. **Epic Boon @19.** Currently modeled as a generic ASI; the 2024 rules make it its own feat
   category (`feat.epicBoon` exists in the data). Implement as a category-filtered feat pick.
4. **FE-8 — feature-owned structured mechanics.** Only when a provenance-dependent feature demands
   it (no current consumer).
5. **Spellbook refinements.**
   a. Source note on *copied* spells — copied refs live in the flat `s.spellbook` array, so only
      custom spells carry `sourceNote`; needs per-book-entry metadata (`ref → {note, cost}`).
   b. Scroll→spell verification — the copy form lists `/scroll/i` inventory items and consumes the
      chosen one, but doesn't check the scroll actually holds the picked spell.
   c. Unaffordable copy is guided, not hard-blocked (gp clamps ≥0) — BY DESIGN; revisit only if it
      misleads players in practice.
6. **Print / export refinements.** Print-sheet labels are English-only (i18n pass); import is
   paste-JSON (add a file picker).
7. **Inventory item kind.** `it.ref` stores no kind (weapon→armor is probed). Store the kind
   alongside the ref when a third ref-kind appears.

(Closed 2026-07-08: `aria-live` budget counts — point-buy/ASI edits now announce "{n} pts left"
through the host's persistent live region, `host.ui.announce`, which survives the full-panel
re-render that blocked the in-page approach.)

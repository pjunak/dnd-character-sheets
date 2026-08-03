// ═══════════════════════════════════════════════════════════════
//  ui.js — shared render primitives used across the tab panels.
//
//  Every function returns an HTML string built through host.h (esc) with design
//  tokens only. The most-repeated inline style blocks are hoisted into named
//  const strings (S.*) so the visual language lives in one place and can't drift
//  between call sites (M8).
//
//  The visual system (2024 redesign):
//    • section(title, body)   a titled group — a gold tick + label + hairline,
//                             then the body. The one section header everywhere,
//                             so hierarchy reads consistently across tabs.
//    • card(body)             a boxed surface (bg-surface) for nested groups.
//    • heroTile / abilityTile the two stat-tile shapes (vitals vs. abilities).
//    • profRow                a saving-throw / skill line (trained dot + total).
//    • overrideControls       the engine-mode "type a manual value / ↺ auto" pair,
//                             shared by the header vitals and any panel.
//
//  `makeUI(ctx)` binds host.h + t + the pipeline pieces it needs (viewModel
//  fields are passed in by callers, not pulled here).
// ═══════════════════════════════════════════════════════════════

import { equipmentModel } from './equipment-model.js';

export function makeUI(ctx) {
  const { host, t, num, signed, compendiumHref, titleize, firstPara } = ctx;
  const { esc } = host.h;

  // ── Scoped stylesheet (tokens only) ──────────────────────────────
  // Addons can't ship global CSS, but a <style> scoped under our own
  // `.addon-dnd-sheets` wrapper is sanctioned (AUTHORING §"bespoke styling
  // goes in an .addon-<id> wrapper"). Only the sheet-specific LAYOUT lives
  // here — the popover legend, tab strip, stat tile and warning list all use
  // the host's shared component classes (widgets.css: .codex-tip/.codex-pop,
  // .codex-tab-strip/.codex-tab, .codex-tile, .codex-warnings), which is what
  // keeps them theme-aware for free.
  const STYLE = `
    /* Full-width sheet layout (UX): the ability CARDS (score + integrated save +
       that ability's skills) stack in a vertical column down the left, from the
       very top; the tab's other content (vitals bar + attacks/spells/trackers)
       fills the column to the right. Stacks below on narrow screens. */
    .addon-dnd-sheets .dse-cols { display:flex; gap:var(--space-4); align-items:flex-start; flex-wrap:wrap }
    .addon-dnd-sheets .dse-cards { display:flex; flex-direction:column; gap:var(--space-3); flex:0 1 17rem; min-width:14rem }
    .addon-dnd-sheets .dse-cols-main { flex:1 1 20rem; min-width:0 }
    @media (max-width:768px){ .addon-dnd-sheets .dse-cards { flex-basis:100% } }
    .addon-dnd-sheets .dse-trait-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,2fr); gap:var(--space-2); padding:var(--space-1) 0; border-bottom:1px solid var(--border-subtle); font-size:var(--text-sm) }
    .addon-dnd-sheets .dse-trait-label { color:var(--text-muted) }
    .addon-dnd-sheets .dse-trait-value { color:var(--text-light); min-width:0 }
    .addon-dnd-sheets .dse-mode-row { display:flex; align-items:center; gap:var(--space-2); padding:var(--space-1) 0; border-bottom:1px solid var(--border-subtle) }
    .addon-dnd-sheets .dse-mode-name { flex:1; color:var(--text-light); font-size:var(--text-sm) }
    .addon-dnd-sheets .dse-mode-state { color:var(--text-muted); font-size:var(--text-xs) }
    /* Compact vitals strip: two tall anchor tiles (the HP counter + the AC/shield
       tile) with the small stats stacked two-high in a column-flow grid, so the
       whole strip reads as ONE uniform-height band. Tiles hug their label/value
       width instead of growing to fill the row (the host default is flex:1 1 5rem)
       — no wasted width, and the band stays narrow enough to sit beside the
       ability cards eventually. */
    .addon-dnd-sheets .dse-vitals { display:flex; flex-wrap:wrap; gap:var(--space-2); align-items:stretch }
    .addon-dnd-sheets .dse-vitals .codex-tile { flex:0 1 auto; min-width:3.5rem; padding:var(--space-2) }
    .addon-dnd-sheets .dse-tile-tall { display:flex; flex-direction:column }
    .addon-dnd-sheets .dse-vitals-grid { display:grid; grid-auto-flow:column; grid-template-rows:1fr 1fr; gap:var(--space-2) }
    /* AC tile: value centred, a dotted rule, then the shield line (label + icon). */
    .addon-dnd-sheets .dse-ac-tile { justify-content:center }
    .addon-dnd-sheets .dse-ac-div { align-self:stretch; border-top:1px dotted var(--text-muted); opacity:.6; margin:var(--space-1) 0 }
    /* Equipment: a Worn group + a dynamic Attunement group, each a header row over
       a 3-up slot grid. Slots hug the band height beside the stat grid. */
    .addon-dnd-sheets .dse-eqwrap { display:flex; flex-direction:column; gap:var(--space-2); flex:1 1 15rem; min-width:13rem }
    .addon-dnd-sheets .dse-eqgrp { display:flex; flex-direction:column; gap:var(--space-1) }
    .addon-dnd-sheets .dse-eqh { display:flex; align-items:center; gap:var(--space-1); font-size:var(--text-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted) }
    .addon-dnd-sheets .dse-eqh-cnt { margin-left:auto; color:var(--accent-gold); font-weight:600; font-variant-numeric:tabular-nums }
    .addon-dnd-sheets .dse-eqh-over { color:var(--color-danger) }
    .addon-dnd-sheets .dse-eqrow { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr)); gap:var(--space-1) }
    .addon-dnd-sheets .dse-slot { min-width:0; background:var(--bg-raised); border:1px solid rgba(var(--accent-gold-rgb),.3); border-radius:var(--radius); padding:var(--space-1) var(--space-2); min-height:2.3rem; display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-1) }
    .addon-dnd-sheets .dse-slot .codex-tip { flex:1; min-width:0 }
    .addon-dnd-sheets .dse-slot-empty { border-style:dashed; border-color:var(--border-subtle); background:transparent }
    .addon-dnd-sheets .dse-slot-tag { font-size:var(--text-xs); text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted); flex:none }
    .addon-dnd-sheets .dse-slot-name { flex:1; min-width:0; font-size:var(--text-sm); color:var(--text-parchment); line-height:1.15; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
    .addon-dnd-sheets .dse-slot-name-empty { flex:1; color:var(--text-muted); font-style:italic; font-size:var(--text-xs) }
    .addon-dnd-sheets .dse-slot-x { margin-left:auto; flex:none; padding:0 var(--space-1); line-height:1 }
    .addon-dnd-sheets .dse-slot-pick { flex:1; min-width:0; width:auto; font-size:var(--text-xs); padding:var(--space-1) }
    /* Docked-stat chip (COMPACT layout): a tiny labelled number riding an
       ability card — Init on DEX, Save DC / Spell Atk on the casting ability. */
    .addon-dnd-sheets .dse-dock { display:inline-flex; align-items:center; gap:var(--space-1); background:var(--bg-raised); border:1px solid rgba(var(--accent-gold-rgb),.35); border-radius:var(--radius-sm); padding:1px var(--space-1); font-size:var(--text-xs); color:var(--text-muted); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap }
    .addon-dnd-sheets .dse-dock strong { color:var(--text-parchment); font-variant-numeric:tabular-nums }
    /* The title-row slot between the ability name and the save shield: takes
       all the leftover width and centres its docked chip (equal space each
       side). Empty on chipless cards — a pure spacer. */
    .addon-dnd-sheets .dse-dock-slot { flex:1; display:flex; justify-content:center; align-items:center; min-width:0 }
    .addon-dnd-sheets .dse-dock-sep { color:var(--text-muted); padding:0 3px }
    /* Backpack split: active (Equipped+Ready) left, stored (Pack+coin) right; a
       header row carries the title + the Add-item button (which opens the wizard). */
    .addon-dnd-sheets .dse-bp-head { display:flex; align-items:center; gap:var(--space-2); border-bottom:1px solid var(--border-subtle); padding-bottom:var(--space-1) }
    .addon-dnd-sheets .dse-bp-title { font-size:var(--text-lg); font-weight:600; color:var(--text-parchment); display:flex; align-items:center; gap:var(--space-2) }
    .addon-dnd-sheets .dse-bp-head > .inline-create-btn { margin-left:auto }
    .addon-dnd-sheets .dse-bp-split { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-4) }
    .addon-dnd-sheets .dse-bp-col { display:flex; flex-direction:column; gap:var(--space-3); min-width:0 }
    .addon-dnd-sheets .dse-bp-right { border-left:1px solid var(--border-subtle); padding-left:var(--space-4) }
    @media (max-width:768px){
      .addon-dnd-sheets .dse-bp-split { grid-template-columns:1fr }
      .addon-dnd-sheets .dse-bp-right { border-left:0; padding-left:0 }
    }
    .addon-dnd-sheets .dse-bp-lbl { font-size:var(--text-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); margin-bottom:var(--space-1) }
    .addon-dnd-sheets .dse-bp-cnt { opacity:.65 }
    /* Currency: ONE inline line pinned under the whole split (label · coin
       pairs, cp→pp ascending). margin-top:auto sinks it to the column's
       bottom — level with the rail's last ability card when the backpack
       stretches (panel.overview.js). flex-wrap is the overflow fallback. */
    .addon-dnd-sheets .dse-bp-coins { display:flex; align-items:center; gap:var(--space-3); flex-wrap:wrap; border-top:1px solid var(--border-subtle); padding-top:var(--space-2); margin-top:auto }
    .addon-dnd-sheets .dse-coin { display:inline-flex; align-items:center; gap:var(--space-1) }
    .addon-dnd-sheets .dse-coin-lbl { font-size:var(--text-xs); color:var(--accent-gold); font-weight:600 }
    /* Add-item wizard: a wide panel with a browse column + a batch-tray rail. */
    .addon-dnd-sheets .dse-aiw-panel { width:min(94vw,640px); max-width:none }
    .addon-dnd-sheets .dse-aiw { display:grid; grid-template-columns:1fr 200px; gap:var(--space-3) }
    .addon-dnd-sheets .dse-aiw-browse { min-width:0; display:flex; flex-direction:column; gap:var(--space-2) }
    .addon-dnd-sheets .dse-aiw-search { display:flex; align-items:center; gap:var(--space-2); background:var(--bg-surface); border:1px solid rgba(var(--accent-gold-rgb),.4); border-radius:var(--radius); padding:var(--space-1) var(--space-2) }
    .addon-dnd-sheets .dse-aiw-search input { border:none; background:transparent; flex:1; min-width:0 }
    .addon-dnd-sheets .dse-aiw-crumbs { display:flex; align-items:center; gap:var(--space-1); flex-wrap:wrap; font-size:var(--text-sm) }
    .addon-dnd-sheets .dse-aiw-cr { background:none; border:none; color:var(--accent-gold); cursor:pointer; padding:var(--space-1) var(--space-2); border-radius:var(--radius-sm); font:inherit }
    .addon-dnd-sheets .dse-aiw-cr:hover { background:rgba(var(--accent-gold-rgb),.1) }
    .addon-dnd-sheets .dse-aiw-cr.here { color:var(--text-parchment); font-weight:600; cursor:default }
    .addon-dnd-sheets .dse-aiw-sep { color:var(--text-muted) }
    .addon-dnd-sheets .dse-aiw-up { margin-left:auto; background:none; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); color:var(--text-muted); cursor:pointer; padding:var(--space-1) var(--space-2); font:inherit; font-size:var(--text-xs) }
    .addon-dnd-sheets .dse-aiw-folders { display:flex; flex-direction:column; gap:var(--space-1) }
    .addon-dnd-sheets .dse-aiw-folder { display:flex; align-items:center; gap:var(--space-2); padding:var(--space-1) var(--space-2); border-radius:var(--radius-sm); cursor:pointer; border:1px solid transparent; background:none; font:inherit; text-align:left; width:100% }
    .addon-dnd-sheets .dse-aiw-folder:hover { background:rgba(var(--accent-gold-rgb),.08); border-color:rgba(var(--accent-gold-rgb),.2) }
    .addon-dnd-sheets .dse-aiw-fi { color:var(--accent-gold) }
    .addon-dnd-sheets .dse-aiw-fn { color:var(--text-parchment); flex:1; font-size:var(--text-sm) }
    .addon-dnd-sheets .dse-aiw-fc { color:var(--text-muted); font-size:var(--text-xs) }
    .addon-dnd-sheets .dse-aiw-divlbl { font-size:var(--text-xs); text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); margin:var(--space-2) 0 var(--space-1) }
    .addon-dnd-sheets .dse-aiw-results { display:flex; flex-direction:column; gap:var(--space-1); max-height:320px; overflow-y:auto }
    .addon-dnd-sheets .dse-aiw-res { display:flex; align-items:center; gap:var(--space-2); padding:var(--space-1) var(--space-2); border-radius:var(--radius-sm) }
    .addon-dnd-sheets .dse-aiw-res:hover { background:rgba(var(--accent-gold-rgb),.06) }
    .addon-dnd-sheets .dse-aiw-meta { flex:1; min-width:0 }
    .addon-dnd-sheets .dse-aiw-rn { color:var(--text-parchment); font-size:var(--text-sm) }
    .addon-dnd-sheets .dse-aiw-rt { color:var(--text-muted); font-size:var(--text-xs) }
    .addon-dnd-sheets .dse-aiw-more, .addon-dnd-sheets .dse-aiw-empty { color:var(--text-muted); font-size:var(--text-xs); padding:var(--space-2); font-style:italic }
    .addon-dnd-sheets .dse-aiw-custom { display:flex; gap:var(--space-1); align-items:center; border-top:1px solid var(--border-subtle); padding-top:var(--space-2) }
    .addon-dnd-sheets .dse-aiw-custom input { flex:1; min-width:0 }
    .addon-dnd-sheets .dse-aiw-cart { border-left:1px solid var(--border-subtle); padding-left:var(--space-3); display:flex; flex-direction:column; min-width:0 }
    .addon-dnd-sheets .dse-aiw-ch { font-size:var(--text-xs); text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); margin-bottom:var(--space-2) }
    .addon-dnd-sheets .dse-aiw-cc { color:var(--accent-gold); font-weight:600 }
    .addon-dnd-sheets .dse-aiw-cbody { display:flex; flex-direction:column; gap:var(--space-1); flex:1 }
    .addon-dnd-sheets .dse-aiw-ci { display:flex; align-items:center; gap:var(--space-1); font-size:var(--text-sm); color:var(--text-parchment); padding:var(--space-1) 0; border-bottom:1px solid var(--border-subtle) }
    .addon-dnd-sheets .dse-aiw-cn { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
    .addon-dnd-sheets .dse-aiw-cfoot { margin-top:var(--space-2); display:flex; flex-direction:column; gap:var(--space-1) }
    @media (max-width:768px){
      .addon-dnd-sheets .dse-aiw { grid-template-columns:1fr }
      .addon-dnd-sheets .dse-aiw-cart { border-left:0; padding-left:0; border-top:1px solid var(--border-subtle); padding-top:var(--space-2) }
    }
    .addon-dnd-sheets .dse-builder { display:flex; flex-direction:column; gap:var(--space-3) }
    .addon-dnd-sheets .dse-builder-summary { display:flex; flex-wrap:wrap; gap:var(--space-2) }
    .addon-dnd-sheets .dse-builder-shell { display:grid; grid-template-columns:minmax(15rem,19rem) minmax(0,1fr); gap:var(--space-4); align-items:start }
    .addon-dnd-sheets .dse-builder-main { min-width:0; display:flex; flex-direction:column; gap:var(--space-4) }
    .addon-dnd-sheets .dse-build-rail { position:sticky; top:var(--space-3); overflow:hidden; background:linear-gradient(155deg,var(--bg-surface),var(--bg-raised)); border:1px solid rgba(var(--accent-gold-rgb),.32); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm) }
    .addon-dnd-sheets .dse-build-progress-head { padding:var(--space-4); border-bottom:1px solid var(--border-subtle) }
    .addon-dnd-sheets .dse-build-progress-head { cursor:pointer; list-style:none }
    .addon-dnd-sheets .dse-build-progress-head::-webkit-details-marker { display:none }
    .addon-dnd-sheets .dse-build-progress-head p { margin:0 0 var(--space-1); color:var(--accent-gold); font-size:var(--text-xs); font-weight:700; letter-spacing:.1em; text-transform:uppercase }
    .addon-dnd-sheets .dse-build-progress-head h2 { margin:0 0 var(--space-3); color:var(--text-parchment); font-size:var(--text-xl); line-height:1.15 }
    .addon-dnd-sheets .dse-build-progress-head > strong { display:block; margin-top:var(--space-2); color:var(--text-light); font-size:var(--text-sm) }
    .addon-dnd-sheets .dse-build-meter { height:.45rem; overflow:hidden; background:var(--bg-base); border:1px solid var(--border-subtle); border-radius:var(--radius-pill) }
    .addon-dnd-sheets .dse-build-meter span { display:block; height:100%; background:linear-gradient(90deg,var(--accent-gold),var(--text-parchment)); transition:width var(--dur-base) var(--ease-out) }
    .addon-dnd-sheets .dse-build-step { padding:var(--space-3) var(--space-4); border-bottom:1px solid var(--border-subtle) }
    .addon-dnd-sheets .dse-build-step:last-child { border-bottom:0 }
    .addon-dnd-sheets .dse-build-step-head { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:var(--space-2); color:var(--text-muted); font-size:var(--text-xs) }
    .addon-dnd-sheets .dse-build-step-head strong { color:var(--text-light); font-size:var(--text-sm) }
    .addon-dnd-sheets .dse-build-step.is-complete .dse-build-step-head > span:first-child { color:var(--color-success) }
    .addon-dnd-sheets .dse-build-issues { display:flex; flex-direction:column; gap:var(--space-1); margin-top:var(--space-2) }
    .addon-dnd-sheets .dse-build-issues button { min-height:44px; display:flex; align-items:center; justify-content:space-between; gap:var(--space-2); width:100%; padding:var(--space-2); color:var(--text-light); background:rgba(var(--accent-gold-rgb),.06); border:1px solid transparent; border-radius:var(--radius-sm); font:inherit; font-size:var(--text-sm); text-align:left; cursor:pointer }
    .addon-dnd-sheets .dse-build-issues button:hover { color:var(--text-parchment); background:rgba(var(--accent-gold-rgb),.12); border-color:rgba(var(--accent-gold-rgb),.28) }
    @media (max-width:1100px){
      .addon-dnd-sheets .dse-builder-shell { grid-template-columns:1fr }
      .addon-dnd-sheets .dse-build-rail { position:static }
      .addon-dnd-sheets .dse-build-step { display:inline-block; vertical-align:top; width:33.333%; min-width:15rem; border-bottom:0; border-right:1px solid var(--border-subtle) }
      .addon-dnd-sheets .dse-build-step:last-child { border-right:0 }
    }
    @media (max-width:768px){
      .addon-dnd-sheets .dse-build-progress-head { padding:var(--space-3) }
      .addon-dnd-sheets .dse-build-progress-head p,
      .addon-dnd-sheets .dse-build-progress-head h2 { display:none }
      .addon-dnd-sheets .dse-build-step.is-complete { display:none }
      .addon-dnd-sheets .dse-build-step { display:block; width:auto; min-width:0; border-right:0; border-bottom:1px solid var(--border-subtle) }
      .addon-dnd-sheets .dse-build-step:last-child { border-bottom:0 }
    }
    @media (prefers-reduced-motion:reduce){
      .addon-dnd-sheets .dse-build-meter span { transition:none }
    }
    /* Progression spine row — the full-row overlay toggle. A hover/focus tint makes
       the whole-row click target discoverable; focus-visible draws a keyboard ring. */
    .addon-dnd-sheets .dse-spine-toggle { border-radius:var(--radius-sm); transition:background var(--dur-fast) var(--ease-out); }
    .addon-dnd-sheets .dse-spine-toggle:hover { background:rgba(var(--accent-gold-rgb),0.07); }
    .addon-dnd-sheets .dse-spine-toggle:focus-visible { outline:2px solid rgba(var(--accent-gold-rgb),0.5); outline-offset:-2px; }
    .addon-dnd-sheets .dse-dot { padding:0; color:inherit; background:none; border:0; line-height:0; cursor:pointer }`;
  const styleTag = `<style>${STYLE}</style>`;

  // ── Hoisted style strings (M8) — tokens only, reused verbatim. ────
  const S = {
    // Layout
    column: 'display:flex;flex-direction:column;gap:var(--space-4)',
    // Ability tile
    abilTile: 'background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:var(--radius);padding:var(--space-2) var(--space-1);text-align:center',
    abilAbbr: 'font-size:var(--text-xs);color:var(--text-muted);letter-spacing:.08em;font-weight:600',
    abilMod: 'font-size:var(--text-2xl);color:var(--text-parchment);font-weight:700;line-height:1.1',
    abilScore: 'display:inline-block;margin-top:var(--space-1);min-width:1.75rem;padding:0 var(--space-1);background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-pill);font-size:var(--text-xs);color:var(--text-light)',
    // Proficiency row (save / skill)
    profRow: 'display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) var(--space-2);border-radius:var(--radius-sm)',
    profLabel: 'flex:1;color:var(--text-light);font-size:var(--text-sm)',
    profTotal: 'color:var(--text-parchment);font-weight:600;font-variant-numeric:tabular-nums',
    abilityTag: 'color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.03em',
    // Misc labels
    // Legacy compact tiles (Builder summary still uses these)
    statBoxLabel: 'font-size:var(--text-xs);color:var(--text-muted)',
    miniStat: 'background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:var(--space-1) var(--space-2);text-align:center;min-width:3.5rem',
    miniStatValue: 'color:var(--text-parchment);font-weight:600;font-size:var(--text-sm)',
  };

  // ── Titled section + boxed card — the two grouping primitives. ────
  // `section` is a header rule + body (no box); `right` is optional header-right
  // HTML (a count, an add button…). `card` is a bordered surface for nesting.
  function section(title, body, opts) {
    opts = opts || {};
    const right = opts.right ? `<div class="codex-section-actions">${opts.right}</div>` : '';
    const icon = opts.icon ? `<span class="codex-section-icon">${esc(opts.icon)}</span>` : '<span class="codex-section-mark"></span>';
    return `<section class="codex-section-block">
      <div class="codex-section-rule">${icon}<span class="codex-section-title">${esc(title)}</span>${right}</div>
      <div>${body}</div></section>`;
  }
  function card(body, opts) {
    opts = opts || {};
    const variant = opts.danger ? ' codex-surface-danger' : opts.accent ? ' codex-surface-accent' : '';
    return `<div class="codex-surface${variant}"${opts.style ? ` style="${opts.style}"` : ''}>${body}</div>`;
  }

  function sectionLabel(text) { return `<div class="codex-kicker">${esc(text)}</div>`; }
  function subLabel(text) { return `<div class="codex-subkicker">${esc(text)}</div>`; }

  // ── The backpack/satchel icon — stroke-drawn like the host stat glyphs
  //    (the 🎒 emoji renders as a garish school backpack on most platforms).
  //    Inherits currentColor, so it takes the surrounding text/gold tone; the
  //    vertical-align keeps it seated in plain-text headings, flex ignores it. ──
  function bagIcon(size) {
    const px = Number(size) > 0 ? Number(size) : 18;
    return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true" style="flex:none;vertical-align:-0.15em;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round"><path d="M7 9.8C7 6.9 9.2 4.7 12 4.7s5 2.2 5 5.1V19a1.9 1.9 0 0 1-1.9 1.9H8.9A1.9 1.9 0 0 1 7 19Z"/><path d="M9.6 5V3.4h4.8V5"/><path d="M7 13.4h10"/><path d="M9.7 13.4v3h4.6v-3"/></svg>`;
  }

  // ── Vital stat tile (HP / AC / Init / Speed / Proficiency / Passive). ──
  // Host component classes (.codex-tile — widgets.css): `valueHtml` is
  // pre-rendered (may carry colour); `sub` a small line under it (temp HP,
  // "auto" note); `editHtml` the edit-mode controls beneath. `accent` gives the
  // faint gold ring (used on HP/AC — the two you read most).
  function heroTile(label, valueHtml, opts) {
    opts = opts || {};
    const cls = 'codex-tile' + (opts.accent ? ' codex-tile-accent' : '') + (opts.wide ? ' codex-tile-wide' : '');
    const sub = opts.sub ? `<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:1px">${opts.sub}</div>` : '';
    const edit = opts.editHtml ? `<div style="margin-top:var(--space-1)">${opts.editHtml}</div>` : '';
    return `<div class="${cls}" title="${esc(opts.title || label)}">
      <div class="codex-tile-label">${esc(label)}</div>
      <div class="codex-tile-value">${valueHtml}</div>${sub}${edit}</div>`;
  }

  // ── Ability tile — abbr · big modifier · score pill. `scoreHtml` is either the
  //    plain score or an <input> (edit mode). `bonusHtml` shows a grant delta. ──
  function abilityTile(abbr, modText, scoreHtml, opts) {
    opts = opts || {};
    const scoreCell = opts.rawScore
      ? `<div style="margin-top:var(--space-1)">${scoreHtml}</div>`
      : `<div style="${S.abilScore}">${scoreHtml}</div>`;
    return `<div style="${S.abilTile}" title="${esc(opts.title || abbr)}">
      <div style="${S.abilAbbr}">${esc(abbr)}</div>
      <div style="${S.abilMod}">${esc(modText)}</div>
      ${scoreCell}${opts.bonusHtml || ''}</div>`;
  }

  // ── Saving-throw / skill line. `state` ∈ none|prof|exp drives the trained dot.
  //    `dotAttr` (optional) makes the dot a clickable toggle (standalone edit). ──
  // Proficiency indicator, 3 states: none = a small outline circle, proficient = a
  // small filled circle, expertise ("mastery") = a LARGER outline ring with a filled
  // centre. Inline SVG (not glyphs) so the mastery ring reads bigger and fill/stroke
  // track the theme. Clickable (dotAttr) to toggle proficiency in standalone edit.
  function profDot(state, dotAttr) {
    const gold = 'var(--accent-gold)', muted = 'var(--text-muted)';
    const shape = state === 'exp'
      ? `<circle cx="8" cy="8" r="6.6" fill="none" stroke="${gold}" stroke-width="1.6"/><circle cx="8" cy="8" r="3.1" fill="${gold}"/>`
      : state === 'prof'
        ? `<circle cx="8" cy="8" r="4.2" fill="${gold}"/>`
        : `<circle cx="8" cy="8" r="3.6" fill="none" stroke="${muted}" stroke-width="1.6"/>`;
    const svg = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" style="display:block">${shape}</svg>`;
    const title = state === 'exp' ? t('misc.expertise') : state === 'prof' ? t('misc.proficient') : t('misc.notProficient');
    if (dotAttr) {
      return `<button class="dse-dot" title="${esc(title)}" aria-pressed="${state !== 'none' ? 'true' : 'false'}"${dotAttr}>${svg}</button>`;
    }
    return `<span title="${esc(title)}" style="line-height:0">${svg}</span>`;
  }
  function profRow(state, labelHtml, totalText, opts) {
    opts = opts || {};
    return `<div style="${S.profRow}">
      ${profDot(state, opts.dotAttr)}<span style="${S.profLabel}">${labelHtml}</span>
      <strong style="${S.profTotal}">${esc(totalText)}</strong></div>`;
  }
  // Boolean-arg alias for profRow (maps prof/exp booleans → state).
  function rowLine(prof, labelHtml, totalText, exp) {
    return profRow(exp ? 'exp' : prof ? 'prof' : 'none', labelHtml, totalText);
  }

  // ── Themed numeric field — a −/＋ stepper (host `.codex-stepper`) flanking a
  //    number <input>. The host hides the native spin-buttons app-wide and steps
  //    the input on button click (see edit.css / app.js), so every number entry
  //    on the sheet is on-theme and click-friendly. `changeAttr` is a
  //    host.h.dataOn('change', …) string; `value` the current value.
  //    `inputStyle` adds inline style to the input (sizing/colour overrides);
  //    `suffixHtml` renders INSIDE the control between the input and the ＋
  //    button (display-only companion text — the HP tile's " / max"; the host
  //    click handler finds the input by querySelector, so extra children are
  //    safe). ──
  function numField(changeAttr, value, opts) {
    opts = opts || {};
    const style = [opts.width ? `width:${opts.width}` : '', opts.inputStyle || ''].filter(Boolean).join(';');
    const a = [
      'class="edit-input"', 'type="number"', 'inputmode="numeric"',
      opts.min != null ? `min="${num(opts.min)}"` : '',
      opts.max != null ? `max="${num(opts.max)}"` : '',
      `step="${opts.step != null ? num(opts.step) : 1}"`,
      opts.title ? `title="${esc(opts.title)}"` : '',
      opts.ariaLabel ? `aria-label="${esc(opts.ariaLabel)}"` : '',
      opts.placeholder != null ? `placeholder="${esc(String(opts.placeholder))}"` : '',
      `value="${esc(String(value == null ? '' : value))}"`,
      style ? `style="${style}"` : '',
      changeAttr || '',
    ].filter(Boolean).join(' ');
    return `<span class="codex-stepper"${opts.wrapStyle ? ` style="${esc(opts.wrapStyle)}"` : ''}>`
      + `<button type="button" class="codex-stepper-btn" data-num-step="-1" tabindex="-1" aria-hidden="true">−</button>`
      + `<input ${a}>`
      + (opts.suffixHtml || '')
      + `<button type="button" class="codex-stepper-btn" data-num-step="1" tabindex="-1" aria-hidden="true">＋</button>`
      + `</span>`;
  }

  // ── Hover/focus legend for a stat (UX-7). The trigger stays inline; a floating
  //    card (CSS in STYLE) explains what the stat IS, its formula, and the terms
  //    that sum to the value — "how the system arrived at the number". `legend` =
  //    {title, desc?, formula?, terms?:[{label,value}], total?, totalLabel?, aria?}.
  //    `opts.align` ∈ l|r biases the popover off a container edge; `opts.underline`
  //    adds the dotted "has-info" affordance. Renders the trigger bare if no legend. ──
  function statTip(triggerHtml, legend, opts) {
    opts = opts || {};
    if (!legend) return triggerHtml;
    const align = opts.align === 'l' ? ' codex-tip-l' : opts.align === 'r' ? ' codex-tip-r' : '';
    const inner = opts.underline ? `<span class="codex-tip-u">${triggerHtml}</span>` : triggerHtml;
    const desc = legend.desc ? `<div class="codex-pop-desc">${esc(legend.desc)}</div>` : '';
    const formula = legend.formula ? `<div class="codex-pop-formula">${esc(legend.formula)}</div>` : '';
    const terms = (legend.terms && legend.terms.length)
      ? `<div class="codex-pop-terms">${legend.terms.map((tm) => `<span class="k">${esc(tm.label)}</span><span class="v">${esc(String(tm.value))}</span>`).join('')}</div>`
      : '';
    const total = (legend.total != null)
      ? `<div class="codex-pop-total"><span class="k">${esc(legend.totalLabel || t('legend.total'))}</span><span class="v">${esc(String(legend.total))}</span></div>`
      : '';
    return `<span class="codex-tip${align}" tabindex="0" role="note" aria-label="${esc(legend.aria || legend.title || '')}">${inner}`
      + `<span class="codex-pop" role="tooltip"><span class="codex-pop-title">${esc(legend.title || '')}</span>${desc}${formula}${terms}${total}</span></span>`;
  }

  // ── A record name that (when resolvable) links to its compendium detail page
  //    AND carries a hover legend — the shared "click-to-go + hover" primitive
  // Gates on `id`: with no id the name stays plain text (no dead link),
  //    mirroring the Builder log. `legend` is a statTip legend (or null → link
  //    only, no card). The dotted "has-info" underline shows only with a legend. ──
  function entityRef(kind, id, name, legend, opts) {
    opts = opts || {};
    const label = esc(String(name == null ? '' : name));
    const inner = id ? `<a href="${esc(compendiumHref(kind, id))}">${label}</a>` : label;
    return statTip(inner, legend || null, { underline: !!legend, ...opts });
  }

  // ── Engine-mode manual override control pair. Type a value to beat
  //    the computed one; ↺ clears back to auto; a faint line flags divergence. ──
  function overrideControls(cid, field, label, numeric, autoVal, isOver) {
    const input = numField(
      host.h.dataOn('change', host.action('setOverrideValue'), cid, field, '$value'),
      isOver ? num(numeric) : '',
      { title: t('override.edit'), ariaLabel: label, placeholder: num(autoVal), width: '3rem' });
    const clrBtn = isOver
      ? `<button class="inline-create-btn" title="${esc(t('override.auto'))}"${host.h.dataAction(host.action('clearOverride'), cid, field)}>↺</button>`
      : '';
    const diverge = (isOver && num(numeric) !== num(autoVal))
      ? `<div style="font-size:var(--text-xs);color:var(--accent-gold);margin-top:var(--space-1)">${esc(t('override.diverge', { manual: num(numeric), auto: num(autoVal) }))}</div>`
      : '';
    return `${diverge}<div style="display:flex;gap:var(--space-1);justify-content:center;align-items:center">${input}${clrBtn}</div>`;
  }

  function miniStat(label, value) {
    return `<div style="${S.miniStat}"><div style="${S.statBoxLabel}">${esc(label)}</div>
      <div style="${S.miniStatValue}">${esc(String(value))}</div></div>`;
  }

  // Native <select>. Read-only renders the chosen label as text. An options
  // entry may be a GROUP — { label, options: [...] } → an <optgroup> (the Epic
  // Boons vs general feats split); flat entries behave exactly as before.
  function selectBox(value, options, actionAttr, placeholder, ro) {
    const flat = options.flatMap((o) => (o && Array.isArray(o.options) ? o.options : [o]));
    if (ro) { const sel = flat.find((o) => String(o.value) === String(value)); return `<span style="color:var(--text-parchment)">${esc(sel ? sel.label : (value || t('misc.notSet')))}</span>`; }
    const opt = (o) => `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label)}</option>`;
    const opts = (placeholder != null ? `<option value="">${esc(placeholder)}</option>` : '')
      + options.map((o) => (o && Array.isArray(o.options)
          ? `<optgroup label="${esc(o.label)}">${o.options.map(opt).join('')}</optgroup>`
          : opt(o))).join('');
    return `<select class="edit-input" ${actionAttr}>${opts}</select>`;
  }
  function fieldRow(label, control) {
    return `<label style="display:grid;grid-template-columns:8rem 1fr;gap:var(--space-2);align-items:center;padding:var(--space-1) 0">
      <span class="edit-label" style="margin:0">${esc(label)}</span><span>${control}</span></label>`;
  }
  function choiceBlock(label, control, hint) {
    return `<div style="background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:var(--radius);padding:var(--space-2) var(--space-3)">
      <div style="font-size:var(--text-sm);color:var(--text-light);margin-bottom:var(--space-1)">${esc(label)}</div>
      ${control}${hint ? `<div style="color:var(--text-muted);font-size:var(--text-xs);margin-top:var(--space-1)">${esc(hint)}</div>` : ''}</div>`;
  }

  // ── Spell ref → display info / hover legend — THE shared resolvers (used by
  //    the Spellbook and Combat panels; they were duplicated there before). A
  //    ref the compendium can't resolve gets a neutral placeholder (never a
  //    slug-titleized id — titleize is reserved for known-clean keys) with
  //    level:null, and a null legend (→ plain name, no hover card). ──
  function spellInfo(engine, ref) {
    const r = engine && engine.getItem ? engine.getItem('spell', ref) : null;
    return r ? { ref, name: r.name, level: num(r.level, 0), school: r.school || '', ritual: !!r.ritual }
             : { ref, name: t('misc.unknown'), level: null, school: '', ritual: false };
  }
  function spellLegend(engine, ref) {
    const r = engine && engine.getItem ? engine.getItem('spell', ref) : null;
    if (!r) return null;
    const lvl = num(r.level, 0);
    const terms = [{ label: t('spellbook.level'), value: lvl === 0 ? t('spellbook.cantrip') : lvl }];
    if (r.school) terms.push({ label: t('spellbook.school'), value: r.school });
    return { title: r.name, desc: r.text ? firstPara(r.text) : '', terms, aria: r.name };
  }

  function spellChip(name, sub, opts) {
    opts = opts || {};
    const color = opts.danger ? 'var(--color-danger)' : 'var(--text-parchment)';
    const badge = opts.badge ? `<span title="${esc(opts.badgeTitle || '')}">${esc(opts.badge)}</span>` : '';
    // Name links to its compendium page (when given an {kind,id} link) and/or
    // carries a hover legend; falls back to plain escaped text.
    const nameHtml = (opts.link || opts.legend)
      ? entityRef(opts.link && opts.link.kind, opts.link && opts.link.id, name, opts.legend || null)
      : esc(name);
    const right = opts.removeAttr
      ? `<button class="inline-create-btn" title="${esc(t('action.remove'))}"${opts.removeAttr}>✕</button>`
      : (opts.locked ? `<span title="${esc(t('spell.alwaysPrepared'))}" style="color:var(--accent-gold)">🔒</span>` : '');
    return `<div title="${esc(opts.title || '')}" class="codex-chip${opts.danger ? ' codex-chip-danger' : ''}">
      ${badge}<div style="flex:1"><div style="color:${color};font-size:var(--text-sm)">${nameHtml}</div>${sub ? `<div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(sub)}</div>` : ''}</div>${right}</div>`;
  }

  // Engine validation warnings (⚠) — shown in the Builder only. There is no
  // "auto-calculated by the engine" note anywhere; the computed values speak for
  // themselves. Renders nothing when there are no warnings.
  function warningsBlock(warnings) {
    const warns = (warnings || []).slice(0, 6);
    if (!warns.length) return '';
    return `<div class="codex-warnings">${warns.map((w) => '⚠ ' + esc(String(w))).join('<br>')}</div>`;
  }

  // Combat attacks from equipped/ready weapons (engine-computed, EQ-5). Renders
  // nothing in standalone (no comp.weapons).
  function attacksBlock(comp) {
    const weapons = (comp && comp.weapons) || [];
    if (!weapons.length) return '';
    const rows = weapons.map((w) => {
      const mastery = w.mastery
        ? ` <span title="${esc(t('combat.mastery'))}" style="color:${w.masteryActive ? 'var(--accent-gold)' : 'var(--text-muted)'};font-size:var(--text-xs)">${w.masteryActive ? '★' : ''}${esc(w.mastery)}</span>`
        : '';
      const profMark = w.proficient ? '' : ` <span title="${esc(t('combat.notProficient'))}" style="color:var(--color-danger);font-size:var(--text-xs)">⚠</span>`;
      // Weapon name → its compendium page, with a properties/mastery hover card.
      const legend = ((w.properties && w.properties.length) || w.mastery)
        ? { title: w.name, desc: (w.properties || []).map(titleize).join(' · '), terms: w.mastery ? [{ label: t('combat.mastery'), value: w.mastery }] : [], aria: w.name }
        : null;
      return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-bottom:1px solid var(--border-subtle)">
        <span style="flex:1;color:var(--text-light);font-size:var(--text-sm)">${entityRef('weapon', w.ref, w.name, legend)}${mastery}${profMark}</span>
        <strong style="color:var(--text-parchment);font-variant-numeric:tabular-nums">${esc(signed(num(w.attackBonus)))}</strong>
        <span style="color:var(--text-muted);font-size:var(--text-sm);min-width:6rem;text-align:right">${esc(w.damage)}${w.damageType ? ' ' + esc(w.damageType) : ''}</span>
      </div>`;
    }).join('');
    return section(t('combat.title'), rows);
  }

  return {
    S, styleTag, section, card, sectionLabel, subLabel, bagIcon, equipmentModel,
    heroTile, abilityTile, profDot, profRow, rowLine, overrideControls,
    numField, statTip, entityRef, miniStat,
    selectBox, fieldRow, choiceBlock, spellChip, spellInfo, spellLegend, warningsBlock, attacksBlock,
  };
}

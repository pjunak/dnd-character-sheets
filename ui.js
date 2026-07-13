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

export function makeUI(ctx) {
  const { host, t, num, signed, compendiumHref, titleize, firstPara } = ctx;
  const { esc } = host.h;

  // ── Scoped stylesheet (tokens only) ──────────────────────────────
  // Addons can't ship global CSS, but a <style> scoped under our own
  // `.addon-dnd55e-sheets` wrapper is sanctioned (AUTHORING §"bespoke styling
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
    .addon-dnd55e-sheets .dse-cols { display:flex; gap:var(--space-4); align-items:flex-start; flex-wrap:wrap }
    .addon-dnd55e-sheets .dse-cards { display:flex; flex-direction:column; gap:var(--space-3); flex:0 1 17rem; min-width:14rem }
    .addon-dnd55e-sheets .dse-cols-main { flex:1 1 20rem; min-width:0 }
    @media (max-width:720px){ .addon-dnd55e-sheets .dse-cards { flex-basis:100% } }
    /* Compact vitals strip: two tall anchor tiles (the HP counter + the AC/shield
       tile) with the small stats stacked two-high in a column-flow grid, so the
       whole strip reads as ONE uniform-height band. Tiles hug their label/value
       width instead of growing to fill the row (the host default is flex:1 1 5rem)
       — no wasted width, and the band stays narrow enough to sit beside the
       ability cards eventually. */
    .addon-dnd55e-sheets .dse-vitals { display:flex; flex-wrap:wrap; gap:var(--space-2); align-items:stretch }
    .addon-dnd55e-sheets .dse-vitals .codex-tile { flex:0 1 auto; min-width:3.5rem; padding:var(--space-2) }
    .addon-dnd55e-sheets .dse-tile-tall { display:flex; flex-direction:column }
    .addon-dnd55e-sheets .dse-vitals-grid { display:grid; grid-auto-flow:column; grid-template-rows:1fr 1fr; gap:var(--space-2) }
    /* Progression spine row — the full-row overlay toggle. A hover/focus tint makes
       the whole-row click target discoverable; focus-visible draws a keyboard ring. */
    .addon-dnd55e-sheets .dse-spine-toggle { border-radius:var(--radius-sm); transition:background var(--dur-fast) var(--ease-out); }
    .addon-dnd55e-sheets .dse-spine-toggle:hover { background:rgba(var(--accent-gold-rgb),0.07); }
    .addon-dnd55e-sheets .dse-spine-toggle:focus-visible { outline:2px solid rgba(var(--accent-gold-rgb),0.5); outline-offset:-2px; }`;
  const styleTag = `<style>${STYLE}</style>`;

  // ── Hoisted style strings (M8) — tokens only, reused verbatim. ────
  const S = {
    // Layout
    column: 'display:flex;flex-direction:column;gap:var(--space-4)',
    // Titled section
    sectionHead: 'display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-3);padding-bottom:var(--space-1);border-bottom:1px solid var(--border-subtle)',
    sectionTick: 'width:3px;height:.9rem;border-radius:var(--radius-pill);background:var(--accent-gold);flex:none',
    sectionTitle: 'font-size:var(--text-sm);font-weight:600;color:var(--text-light);letter-spacing:.04em;text-transform:uppercase',
    // Boxed surface
    card: 'background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4)',
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
    sectionLabel: 'font-size:var(--text-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:var(--space-2)',
    subLabel: 'color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.04em;margin-bottom:var(--space-1)',
    // Legacy compact tiles (Builder summary still uses these)
    statBox: 'background:var(--bg-raised);border-radius:var(--radius);padding:var(--space-2) var(--space-3);min-width:4.5rem;text-align:center',
    statBoxLabel: 'font-size:var(--text-xs);color:var(--text-muted)',
    statBoxValue: 'font-size:var(--text-lg);color:var(--text-parchment);font-weight:600',
    miniStat: 'background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:var(--space-1) var(--space-2);text-align:center;min-width:3.5rem',
    miniStatValue: 'color:var(--text-parchment);font-weight:600;font-size:var(--text-sm)',
  };

  // ── Titled section + boxed card — the two grouping primitives. ────
  // `section` is a header rule + body (no box); `right` is optional header-right
  // HTML (a count, an add button…). `card` is a bordered surface for nesting.
  function section(title, body, opts) {
    opts = opts || {};
    const right = opts.right ? `<div style="margin-left:auto;display:flex;align-items:center;gap:var(--space-2)">${opts.right}</div>` : '';
    const icon = opts.icon ? `<span style="font-size:var(--text-sm)">${esc(opts.icon)}</span>` : `<span style="${S.sectionTick}"></span>`;
    return `<section style="display:flex;flex-direction:column">
      <div style="${S.sectionHead}">${icon}<span style="${S.sectionTitle}">${esc(title)}</span>${right}</div>
      <div>${body}</div></section>`;
  }
  function card(body, opts) {
    opts = opts || {};
    const extra = opts.danger ? ';border-color:var(--color-danger-bd)' : opts.accent ? ';border-color:rgba(var(--accent-gold-rgb),.35)' : '';
    return `<div style="${S.card}${extra}${opts.style ? ';' + opts.style : ''}">${body}</div>`;
  }

  function sectionLabel(text) { return `<div style="${S.sectionLabel}">${esc(text)}</div>`; }
  function subLabel(text) { return `<div style="${S.subLabel}">${esc(text)}</div>`; }

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
      return `<button class="dse-dot" title="${esc(title)}" aria-pressed="${state !== 'none' ? 'true' : 'false'}" style="background:none;border:none;cursor:pointer;padding:0;line-height:0"${dotAttr}>${svg}</button>`;
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
  //    (B1/B2). Gates on `id`: with no id the name stays plain text (no dead link),
  //    mirroring the Builder log. `legend` is a statTip legend (or null → link
  //    only, no card). The dotted "has-info" underline shows only with a legend. ──
  function entityRef(kind, id, name, legend, opts) {
    opts = opts || {};
    const label = esc(String(name == null ? '' : name));
    const inner = id ? `<a href="${esc(compendiumHref(kind, id))}">${label}</a>` : label;
    return statTip(inner, legend || null, { underline: !!legend, ...opts });
  }

  // ── Engine-mode "manual override" control pair (ARCH-3). Type a value to beat
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

  // ── Statboxes the Builder summary still uses. ─────────────────────
  function statBox(label, value) {
    return `<div style="${S.statBox}"><div style="${S.statBoxLabel}">${esc(label)}</div>
      <div style="${S.statBoxValue}">${esc(String(value))}</div></div>`;
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
    return `<div style="display:grid;grid-template-columns:8rem 1fr;gap:var(--space-2);align-items:center;padding:var(--space-1) 0">
      <label class="edit-label" style="margin:0">${esc(label)}</label><div>${control}</div></div>`;
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
    S, styleTag, section, card, sectionLabel, subLabel,
    heroTile, abilityTile, profDot, profRow, rowLine, overrideControls,
    numField, statTip, entityRef, statBox, miniStat,
    selectBox, fieldRow, choiceBlock, spellChip, spellInfo, spellLegend, warningsBlock, attacksBlock,
  };
}

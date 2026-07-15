// ═══════════════════════════════════════════════════════════════
//  dnd55e-sheets — a fully hand-fillable D&D 5.5e (2024) character sheet.
//
//  Rides on the host's CORE `characters` entity (the sheet is NOT an addon
//  collection): all D&D data lives in `character.addonData['dnd55e-sheets']`,
//  written via host.store.patchAddonData. The host owns identity/lore (name,
//  portrait, species, description, relationships…); this addon reads those and
//  adds ONLY the D&D mechanics — it never duplicates them.
//
//  ── Integration: a full-width tab strip in place of the article body (ARCH) ──
//  We claim the host's `characters:body` fragment (registerFragmentOp · replace),
//  which makes the article FULL-WIDTH: the host drops its side rail and folds the
//  whole wiki profile INTO the `html` we receive — the side-card (✏ Upravit +
//  portrait/name/species/facts, floated `.article-sidecard-inbody`), every
//  relationship/event/known/questions/pets section, then the lore. That blob
//  becomes our first "Overview" tab (reused, not copied), so the tab strip sits
//  at the very top of the page; only the host's breadcrumb bar rides above. Tabs:
//    • Overview        — the host's lore (description), passed in as `html`.
//    • Character Sheet — ability scores, saving throws, skills + the Backpack
//                        (inventory & currency) under the vitals in its main column.
//    • Combat          — attacks from equipped/ready weapons + resource trackers.
//    • Spellbook       — prepared/cantrip slots, granted/choose-grant (UI-4).
//    • Builder         — guided progression; engine mode + editors only, rightmost.
//  A slim vitals bar (HP ± / AC / Init / Speed / PB / Passive + spell DC/attack
//  + class-level line) sits under the tabs on the mechanical tabs (panel.header.js).
//
//  ── Editing: direct, role-gated, NO separate mode ──
//  The host already owns the one edit affordance — "✏ Upravit" rides the
//  side-card, which lands inside our Overview tab, so it appears exactly with
//  the identity/lore content it edits. We don't add a second button: editors
//  (`!isAnonymous()`) edit D&D directly in the tabs (and the Builder);
//  anonymous viewers see read-only. Live-play controls (HP ±, trackers, prep,
//  prof toggles) follow the same gate.
//
//  ── Module layout (decomposed; native ES modules, no build step) ──
//    rules/engine.js     the PURE D&D rules engine (host-free, tests/rules.mjs)
//    rules/api.js        │  — merged from the retired dnd55e-core-rules addon.
//                        └  makeRulesApi(getData): engine + live book data.
//    helpers.js          pure constants + helpers (re-exports the rules facts).
//    model.js            decision/derivation pipeline + viewModel + mutators.
//    ui.js               shared render primitives (section/heroTile/abilityTile/…).
//    panel.header.js     the slim D&D vitals bar.
//    panel.overview.js   ┐  one render module per tab (Character Sheet / Combat /
//    panel.sheet.js      │  Spellbook / Backpack / Builder). The Overview tab is
//    panel.spellbook.js  │  just the host lore, so it has no module.
//    panel.backpack.js   │
//    panel.builder.js    ┘
//
//  Style/safety contract: HTML only via host.h (esc/dataAction/dataOn), never
//  inline onclick; colours/spacing only via design tokens var(--…); every
//  display string flows through i18n.t() so locales layer on with no rewrite.
// ═══════════════════════════════════════════════════════════════

import { t } from './i18n.js';
import {
  ABILITIES, COINS, LOCATIONS, SKILLS,
  num, abilityMod, signed, titleize, clampHp, blank, makeHelpers, compendiumHref, firstPara, featureRecordFor,
  POINT_BUY, pointCost, pointsSpent, hitDieAvg, scrollCopyCost, ASI_RULES, featAsiFrom, featAbilityCap,
} from './helpers.js';
import { makeEngine } from './model.js';
import { makeUI } from './ui.js';
import { makeLegends } from './legends.js';
import { makeRail } from './panel.rail.js';
import { makeHeaderPanel } from './panel.header.js';
import { makeOverviewPanel } from './panel.overview.js';
import { makeSheetPanel } from './panel.sheet.js';
import { makeSpellbookPanel } from './panel.spellbook.js';
import { makeBackpackPanel } from './panel.backpack.js';
import { makeAddItemPanel } from './panel.additem.js';
import { makeBuilderPanel } from './panel.builder.js';
import { makePrintPanel } from './panel.print.js';

export default function register(host) {
  const { esc } = host.h;
  const NS = host.id; // 'dnd55e-sheets'
  const { uid, sheetOf } = makeHelpers(host);

  // ── Shared context handed to every module. ──
  const ctx = {
    host, t, NS,
    ABILITIES, COINS, LOCATIONS, SKILLS,
    num, abilityMod, signed, titleize, clampHp, blank, uid, sheetOf, compendiumHref, firstPara, featureRecordFor,
    POINT_BUY, pointCost, pointsSpent, hitDieAvg, scrollCopyCost, ASI_RULES, featAsiFrom, featAbilityCap,
  };
  // Builder UI state, per character id: { tab: 'character'|<classId>, open: '<classId>:<level>'|null }.
  // In-memory (shared via ctx → the Builder panel reads it; actions below mutate it) — deliberately
  // NOT persisted: the Builder is only opened to create/level a character, so it defaults to the
  // Character tab each load, and this saves any localStorage plumbing (B4.5b).
  ctx.builderState = {};
  // Per-browser UI layout preference (Settings → Doplňky → Character Sheets):
  // 'classic' keeps every stat tile in the vitals band; 'compact' docks the
  // derived stats onto their ability cards (Init→DEX, passive→Perception row,
  // Save DC / Spell Attack→the casting ability). localStorage so each player
  // picks their own; absent key = classic.
  ctx.uiLayout = () => { try { return localStorage.getItem('dse-ui:layout') === 'compact' ? 'compact' : 'classic'; } catch (_) { return 'classic'; } };
  ctx.engine = makeEngine(ctx);
  ctx.viewModel = ctx.engine.viewModel;     // hot path — promote for panel destructuring
  ctx.ui = makeUI(ctx);
  ctx.legends = makeLegends(ctx).legends;   // per-stat hover-legend builders (UX-7)
  ctx.vitalsBar = makeHeaderPanel(ctx).vitalsBar;   // shared: Character Sheet & Combat place it in their right column
  ctx.abilityRail = makeRail(ctx).abilityRail;      // shared: the stacked ability cards (left column)
  ctx.panels = {
    vitalsBar: ctx.vitalsBar,
    ...makeOverviewPanel(ctx),
    ...makeSheetPanel(ctx),
    ...makeSpellbookPanel(ctx),
    ...makeBackpackPanel(ctx),
    ...makeAddItemPanel(ctx),
    ...makeBuilderPanel(ctx),
    ...makePrintPanel(ctx),
  };

  const { getRules, safeHydrate, decisionsOf, mutate, effectiveMaxHp } = ctx.engine;
  const { vitalsBar, panelOverview, panelSheet, panelSpellbook, panelBuilder, restModal, spellSwapModal, spellbookMgrModal, buildPrintHtml, importModal, addItemModal } = ctx.panels;

  // ── Tab model ────────────────────────────────────────────────────
  //  Overview (lore) + the mechanical tabs. Spellbook only when the character has
  //  spells (UI-4); Builder only in engine mode and for editors (rightmost).
  const visibleTabs = (engine, hasSpells, editable) => {
    const tabs = [
      { id: 'overview', icon: '🪪', label: t('tab.overview'), hint: t('tab.overviewHint') },
      { id: 'stats',    icon: '📋', label: t('tab.stats'),    hint: t('tab.statsHint') },
      { id: 'combat',   icon: '⚔️', label: t('tab.combat'),   hint: t('tab.combatHint') },
    ];
    // Backpack (inventory + currency) folded into the Character Sheet tab — no own tab.
    if (hasSpells) tabs.push({ id: 'spellbook', icon: '📖', label: t('tab.spellbook'), hint: t('tab.spellbookHint') });
    if (engine && editable) tabs.push({ id: 'builder', icon: '🛠️', label: t('tab.builder'), hint: t('tab.builderHint'), tool: true });
    return tabs;
  };
  const tabKey = (id) => 'dse-tab:' + id;
  const currentTab = (cid, tabs) => {
    let stored = null;
    try { stored = localStorage.getItem(tabKey(cid)); } catch (_) {}
    return tabs.some((tb) => tb.id === stored) ? stored : tabs[0].id;
  };
  const panelId = (cid) => 'dse-panel-' + cid;
  const tabBtnId = (cid, tabId) => 'dse-tab-' + cid + '-' + tabId;

  const hasSpellsOf = (engine, comp, s) => !engine
    || !!(comp && comp.spellcasting && ((comp.spellcasting.perClass || []).length || (comp.spellcasting.granted || []).length))
    || (Array.isArray(s.spells) && s.spells.length > 0);

  // ════════════════════════════════════════════════════════════════
  //  Body fragment override — the tab strip replaces the host's lore block.
  //  `render(html, ctx)` gets the rendered lore html + ctx.entity (the
  //  character). We keep that lore as the Overview tab and add the D&D tabs.
  // ════════════════════════════════════════════════════════════════
  host.registerFragmentOp('characters:body', {
    op: 'replace',
    render: (html, fctx) => {
      const c = fctx && fctx.entity;
      if (!c) return html;                       // defensive: never blank the page
      const s = sheetOf(c);
      const editable = !host.role.isAnonymous();
      const engine = getRules();
      const result = engine ? safeHydrate(engine, decisionsOf(s, engine)) : null;
      const comp = result && result.sheet;
      const warnings = (result && result.warnings) || [];
      const tabs = visibleTabs(engine, hasSpellsOf(engine, comp, s), editable);
      const active = currentTab(c.id, tabs);
      const pid = panelId(c.id);

      // Tab bar — host `.codex-tab-strip` component (widgets.css); ARIA tablist.
      // The Builder (a tool tab) is pushed right + gold-tinted via -tool.
      const tabBtn = (tb) => {
        const on = tb.id === active;
        const cls = 'codex-tab' + (tb.tool ? ' codex-tab-tool' : '') + (on ? ' is-active' : '');
        return `<button role="tab" class="${cls}" id="${esc(tabBtnId(c.id, tb.id))}" aria-selected="${on}" aria-controls="${esc(pid)}" tabindex="${on ? '0' : '-1'}"
          title="${esc(tb.hint || tb.label)}"
          ${host.h.dataAction(host.action('tab'), c.id, tb.id)}
          ${host.h.dataOn('keydown', host.action('tabKey'), '$ev', c.id, tb.id)}><span aria-hidden="true">${esc(tb.icon)}</span> ${esc(tb.label)}</button>`;
      };
      const tabBar = `<div role="tablist" class="codex-tab-strip" aria-label="${esc(t('sheet.title'))}">${tabs.map(tabBtn).join('')}</div>`;

      // The Overview tab is the host lore itself; mechanical tabs get the vitals bar.
      let panel = '';
      if (active === 'overview') panel = lorePanel(html);
      // The Backpack (inventory + currency) lives inside the Character Sheet tab —
      // its own tab was retired; panelOverview renders it in its main column,
      // right under the vitals, beside the ability cards.
      else if (active === 'stats') panel = panelOverview(c, s, editable, comp, engine);
      else if (active === 'combat') panel = panelSheet(c, s, editable, comp, engine);
      else if (active === 'spellbook') panel = panelSpellbook(c, s, editable, comp, engine);
      else if (active === 'builder') panel = panelBuilder(c, s, editable, comp, warnings, engine);
      // Spellbook keeps the vital strip as a full-width band on top. Character Sheet
      // & Combat place it themselves (in their right column), so entry doesn't add it.
      const vitals = (active === 'spellbook') ? vitalsBar(c, s, comp, editable, engine) : '';

      // Rest wizard — a floating overlay (host `.addon-wizard-overlay` classes),
      // rendered at the fragment root so it floats over any tab. Open state is a
      // localStorage flag toggled by restOpen/restClose; engine + editor only.
      let restOpen = false;
      try { restOpen = !!(engine && editable && restModal && localStorage.getItem('dse-rest:' + c.id) === 'open'); } catch (_) {}
      const restOverlay = restOpen ? restModal(c, s, comp) : '';
      // Level-up spell-swap modal (same floating-overlay pattern; the flag stores the
      // classId being swapped). Engine + editor only.
      let swapClass = null;
      try { if (engine && editable && spellSwapModal) swapClass = localStorage.getItem('dse-swap:' + c.id) || null; } catch (_) {}
      const swapOverlay = swapClass ? spellSwapModal(c, s, comp, engine, swapClass) : '';
      // Spellbook-management modal — same floating pattern; the flag value is the
      // mode ('copy' | 'other'), so each of the two buttons opens the right form.
      let spellMgrMode = null;
      try { if (engine && editable && spellbookMgrModal) spellMgrMode = localStorage.getItem('dse-spellmgr:' + c.id) || null; } catch (_) {}
      const spellMgrOverlay = (spellMgrMode === 'copy' || spellMgrMode === 'other') ? spellbookMgrModal(c, s, comp, engine, spellMgrMode) : '';

      // Sheet-wide toolbar (right-aligned): Print / Export always; Import is an
      // editor-only overwrite (B4.6).
      const toolbar = `<div style="display:flex;justify-content:flex-end;gap:var(--space-1);margin-bottom:var(--space-1)">
        <button class="inline-create-btn"${host.h.dataAction(host.action('printSheet'), c.id)}>🖨 ${esc(t('action.print'))}</button>
        <button class="inline-create-btn"${host.h.dataAction(host.action('exportSheet'), c.id)}>⬇ ${esc(t('action.export'))}</button>
        ${editable ? `<button class="inline-create-btn"${host.h.dataAction(host.action('importOpen'), c.id)}>⬆ ${esc(t('action.import'))}</button>` : ''}</div>`;

      // Import modal — floating overlay at the fragment root when its flag is set (editor only).
      let importOpen = false;
      try { importOpen = !!(editable && importModal && localStorage.getItem('dse-import:' + c.id) === 'open'); } catch (_) {}
      const importOverlay = importOpen ? importModal(c) : '';

      // Add-item wizard — floating overlay (editor only) when its flag is set.
      let addItemOpen = false;
      try { addItemOpen = !!(editable && addItemModal && localStorage.getItem('dse-additem:' + c.id) === 'open'); } catch (_) {}
      const addItemOverlay = addItemOpen ? addItemModal(c, s, engine) : '';

      return `<div class="addon-dnd55e-sheets" style="display:flex;flex-direction:column">${ctx.ui.styleTag}${toolbar}${tabBar}
        <div role="tabpanel" id="${esc(pid)}" aria-labelledby="${esc(tabBtnId(c.id, active))}" tabindex="0">${vitals}${panel}</div>${restOverlay}${swapOverlay}${spellMgrOverlay}${importOverlay}${addItemOverlay}</div>`;
    },
  });

  // The Overview = the host's whole wiki profile: the folded side-card (✏ Upravit
  // + portrait + identity + facts, a floated `.article-sidecard-inbody` block),
  // the relationship/event/known/questions/pets sections, then the lore.
  // `display:flow-root` contains that float so the content wraps around the
  // portrait cleanly (magazine-style) without bleeding into the next tab.
  function lorePanel(html) {
    const lore = (typeof html === 'string' && html.trim()) ? html
      : `<div style="color:var(--text-muted);font-size:var(--text-sm)">${esc(t('sheet.notesEmpty'))}</div>`;
    return `<div style="display:flow-root">${lore}</div>`;
  }

  // ════════════════════════════════════════════════════════════════
  //  Actions
  // ════════════════════════════════════════════════════════════════
  host.registerAction('tab', (cid, tabId) => {
    try { localStorage.setItem(tabKey(cid), String(tabId)); } catch (_) {}
    host.ui.rerender();
  });

  // Roving-tabindex keyboard nav across the tablist (Left/Right/Home/End).
  host.registerAction('tabKey', (ev, cid, tabId) => {
    const key = ev && ev.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    if (ev.preventDefault) ev.preventDefault();
    const engine = getRules();
    const s = sheetOf(host.store.getCharacters().find((x) => x && x.id === cid) || {});
    const result = engine ? safeHydrate(engine, decisionsOf(s, engine)) : null;
    const comp = result && result.sheet;
    const editable = !host.role.isAnonymous();
    const tabs = visibleTabs(engine, hasSpellsOf(engine, comp, s), editable);
    const ids = tabs.map((tb) => tb.id);
    const cur = ids.indexOf(tabId);
    if (cur < 0) return;
    let next = cur;
    if (key === 'ArrowLeft') next = (cur - 1 + ids.length) % ids.length;
    else if (key === 'ArrowRight') next = (cur + 1) % ids.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = ids.length - 1;
    try { localStorage.setItem(tabKey(cid), String(ids[next])); } catch (_) {}
    host.ui.rerender();
    try {
      const focusId = tabBtnId(cid, ids[next]);
      setTimeout(() => { const el = document.getElementById(focusId); if (el) el.focus(); }, 0);
    } catch (_) {}
  });

  // ── Direct inline edit (editors only; gated at render by `editable`). These
  //    write the flat decision fields the standalone viewModel reads. In engine
  //    mode the same fields are computed and these controls aren't rendered (the
  //    Builder owns them) — the actions stay guarded/harmless regardless. ──
  const STR_FIELDS = { player: 1, className: 1, subclass: 1, background: 1, alignment: 1, notes: 1 };
  const NUM_FIELDS = { level: 1, maxHp: 1, hp: 1, tempHp: 1, ac: 1, initiative: 1, speed: 1, profBonus: 1 };
  const SKILL_IDS = new Set(SKILLS.map((sk) => sk.id));
  host.registerAction('setField', (cid, field, value) => {
    if (!STR_FIELDS[field] && !NUM_FIELDS[field]) return;
    mutate(cid, (s) => {
      if (STR_FIELDS[field]) { s[field] = String(value == null ? '' : value); return s; }
      let n = num(value, 0);
      if (field === 'level') n = Math.max(1, n);
      else if (field === 'maxHp' || field === 'tempHp' || field === 'speed') n = Math.max(0, n);
      s[field] = n;
      // HP clamps respect the OVERRIDDEN max when one is stored (ARCH-3) — the
      // same value the HP tile displays — never a raw flat/computed field the
      // display already disagrees with.
      if (field === 'maxHp') s.hp = clampHp(num(s.hp, 0), effectiveMaxHp(s));
      else if (field === 'hp') s.hp = clampHp(n, effectiveMaxHp(s));
      return s;
    });
  });
  host.registerAction('setAbility', (cid, ability, value) => {
    if (ABILITIES.indexOf(ability) < 0) return;
    mutate(cid, (s) => { s.abilities = { ...s.abilities, [ability]: Math.max(1, Math.min(30, num(value, 10))) }; return s; });
  });
  host.registerAction('toggleSave', (cid, ability) => {
    if (ABILITIES.indexOf(ability) < 0) return;
    mutate(cid, (s) => { s.saveProf = { ...s.saveProf, [ability]: !s.saveProf[ability] }; return s; });
  });
  host.registerAction('toggleSkill', (cid, skillId) => {
    if (!SKILL_IDS.has(skillId)) return;
    mutate(cid, (s) => { s.skillProf = { ...s.skillProf, [skillId]: !s.skillProf[skillId] }; return s; });
  });

  // HP change → one rule. Damage (delta<0) is absorbed by Temp HP first (2024
  // rules), then eats current HP; healing only raises current HP (never temp),
  // clamped by clampHp (into [0,max] when max>0, else floored at 0).
  const applyHp = (s, delta) => {
    let d = Number(delta) || 0;
    if (d < 0) {
      const temp = num(s.tempHp, 0);
      const absorbed = Math.min(temp, -d);
      if (absorbed > 0) { s.tempHp = temp - absorbed; d += absorbed; }
    }
    const maxHp = effectiveMaxHp(s);   // override-aware max (ARCH-3)
    s.hp = clampHp(num(s.hp, maxHp) + d, maxHp);
    return s;
  };
  // `hp` — a live-play ±delta primitive (damage eats Temp HP first, then current HP;
  // heal never fills Temp). The HP tile now edits current HP directly (a host stepper
  // → setField), but this stays registered for programmatic / quick-adjust use.
  host.registerAction('hp', (id, delta) => { mutate(id, (s) => applyHp(s, delta)); });

  // ── Manual overrides (engine mode, ARCH-3) — a typed value beats the computed
  //    one; ↺ clears back to auto. ──
  const OVERRIDE_FIELDS = { maxHp: 1, ac: 1, initiative: 1, speed: 1 };
  host.registerAction('setOverrideValue', (cid, field, raw) => {
    if (!OVERRIDE_FIELDS[field]) return;
    const txt = String(raw == null ? '' : raw).trim();
    mutate(cid, (s) => {
      const ov = { ...(s.overrides || {}) };
      if (txt === '') delete ov[field];      // blank ⇒ back to auto
      else ov[field] = num(txt, 0);
      s.overrides = ov;
      return s;
    });
  });
  host.registerAction('clearOverride', (cid, field) => {
    if (!OVERRIDE_FIELDS[field]) return;
    mutate(cid, (s) => { const ov = { ...(s.overrides || {}) }; delete ov[field]; s.overrides = ov; return s; });
  });

  // Spellbook — manual/extra entries (s.spells).
  host.registerAction('spellAdd', (cid) => {
    mutate(cid, (s) => { s.spells = s.spells.concat([{ id: uid('spell'), name: '', level: 0, school: '', prepared: false, origin: 'manual' }]); return s; });
  });
  host.registerAction('copySpell', (cid) => {
    mutate(cid, (s) => { s.spells = s.spells.concat([{ id: uid('spell'), name: '', level: 1, school: '', prepared: false, origin: 'copied' }]); return s; });
  });
  host.registerAction('spellDel', (cid, sid) => {
    mutate(cid, (s) => { s.spells = s.spells.filter((sp) => sp.id !== sid); return s; });
  });
  // Engine-mode preparation (per class): cantrips + prepared picks.
  const addRef = (s, bag, classId, ref) => { const cur = (s[bag][classId] || []).slice(); if (ref && !cur.includes(ref)) cur.push(ref); s[bag] = { ...s[bag], [classId]: cur }; };
  const delRef = (s, bag, classId, ref) => { s[bag] = { ...s[bag], [classId]: (s[bag][classId] || []).filter((r) => r !== ref) }; };
  host.registerAction('learnCantrip', (cid, classId, ref) => { mutate(cid, (s) => { addRef(s, 'cantrips', classId, ref); return s; }); });
  host.registerAction('unlearnCantrip', (cid, classId, ref) => { mutate(cid, (s) => { delRef(s, 'cantrips', classId, ref); return s; }); });
  host.registerAction('prepSpell', (cid, classId, ref) => { mutate(cid, (s) => { addRef(s, 'preparedSpells', classId, ref); return s; }); });
  host.registerAction('unprepSpell', (cid, classId, ref) => { mutate(cid, (s) => { delRef(s, 'preparedSpells', classId, ref); return s; }); });
  // Wizard spellbook (SP-5): learn a spell into the book / remove it. Forgetting a
  // spell also unprepares it (you can't prepare a spell that's no longer in your book).
  host.registerAction('spellbookLearn', (cid, classId, ref) => { mutate(cid, (s) => { addRef(s, 'spellbook', classId, ref); return s; }); });
  host.registerAction('spellbookForget', (cid, classId, ref) => { mutate(cid, (s) => { delRef(s, 'spellbook', classId, ref); delRef(s, 'preparedSpells', classId, ref); return s; }); });
  // Spellbook management popup (unified add/remove) — a floating overlay to COPY a
  // spell into the book (scroll + gp; spellbook casters only) or add a CUSTOM
  // homebrew spell, and to remove either. Flag in localStorage like the swap modal.
  // The flag VALUE is the mode: 'copy' (scroll → book, spellbook casters) or
  // 'other' (a spell from a feat / item / homebrew). Two buttons, one modal.
  const spellMgrKey = (cid) => 'dse-spellmgr:' + cid;
  // The copy form's CURRENT spell pick, persisted so the scroll list can be
  // filtered to scrolls of THAT spell across the change→re-render cycle.
  const copySelKey = (cid) => 'dse-copysel:' + cid;
  host.registerAction('spellMgrOpen', (cid, mode) => { try { localStorage.setItem(spellMgrKey(cid), mode || 'other'); } catch (_) {} host.ui.rerender(); });
  host.registerAction('spellMgrClose', (cid) => { try { localStorage.removeItem(spellMgrKey(cid)); localStorage.removeItem(copySelKey(cid)); } catch (_) {} host.ui.rerender(); });
  host.registerAction('spellCopyPick', (cid, ref) => { try { localStorage.setItem(copySelKey(cid), String(ref || '')); } catch (_) {} host.ui.rerender(); });
  // Copy a spell into the book: read the picked spell (+ optional scroll) at click
  // time, charge 50 gp × spell level (2024 copying cost), consume the scroll if one
  // was chosen, and add the ref to s.spellbook[classId] (→ preparable via B4.2b).
  host.registerAction('spellCopy', (cid, classId) => {
    let ref = '', scrollId = '';
    try { const sp = document.getElementById('dse-copy-spell-' + cid); const sc = document.getElementById('dse-copy-scroll-' + cid); ref = sp && sp.value; scrollId = sc && sc.value; } catch (_) {}
    if (!ref) { host.ui.rerender(); return; }
    try { localStorage.removeItem(copySelKey(cid)); } catch (_) {}
    const engine = getRules();
    const rec = engine && engine.getItem ? engine.getItem('spell', ref) : null;
    const cost = scrollCopyCost(rec && rec.level);   // 50 gp × spell level (rules/engine.js)
    mutate(cid, (s) => {
      addRef(s, 'spellbook', classId, ref);
      s.currency = { ...s.currency, gp: Math.max(0, num(s.currency.gp, 0) - cost) };
      // Consume the scroll ONLY when it actually holds the copied spell (the
      // form already filters to matching scrolls; this guards a stale/forged
      // selection so a "Scroll of Healing Word" can never be burned copying
      // Fireball — the copy itself still happens, just without consumption).
      if (scrollId) {
        const it = (s.inventory || []).find((x) => x && x.id === scrollId);
        const matches = it && rec && String(it.name || '').toLowerCase().includes(String(rec.name || '').toLowerCase());
        if (matches) s.inventory = s.inventory
          .map((x) => (x.id === scrollId ? { ...x, qty: num(x.qty, 1) - 1 } : x))
          .filter((x) => !(x.id === scrollId && num(x.qty, 0) <= 0));
      }
      return s;
    });
  });
  // Add a spell "from another source" (feat / magic item / homebrew) — read the
  // form at click time; a name is required. `castWithSlots` (2024/SP-10): a
  // spellcaster can cast such a spell using their spell slots, so it joins the
  // castable repertoire rather than being a display-only note.
  host.registerAction('spellCustomAdd', (cid) => {
    let name = '', level = 0, school = '', note = '', slots = false;
    try {
      name = (document.getElementById('dse-custom-name-' + cid) || {}).value || '';
      level = (document.getElementById('dse-custom-level-' + cid) || {}).value || 0;
      school = (document.getElementById('dse-custom-school-' + cid) || {}).value || '';
      note = (document.getElementById('dse-custom-note-' + cid) || {}).value || '';
      slots = !!(document.getElementById('dse-custom-slots-' + cid) || {}).checked;
    } catch (_) {}
    if (!String(name).trim()) { host.ui.rerender(); return; }
    mutate(cid, (s) => { s.spells = s.spells.concat([{ id: uid('spell'), name: String(name).trim(), level: num(level, 0), school: String(school), prepared: false, origin: 'other', sourceNote: String(note), castWithSlots: slots }]); return s; });
  });
  // Level-up spell swap (FE-4): open/close the floating picker (the flag stores the
  // classId); apply reads the two <select>s at click time (like hpApply) → records
  // {level,classId,out,in}, swaps `out`→`in` in prepared, then closes. Forget drops a row.
  const swapKey = (cid) => 'dse-swap:' + cid;
  host.registerAction('spellSwapOpen', (cid, classId) => { try { localStorage.setItem(swapKey(cid), String(classId)); } catch (_) {} host.ui.rerender(); });
  host.registerAction('spellSwapClose', (cid) => { try { localStorage.removeItem(swapKey(cid)); } catch (_) {} host.ui.rerender(); });
  host.registerAction('spellSwapApply', (cid, classId) => {
    let out = '', inRef = '';
    try { const o = document.getElementById('dse-swap-out-' + cid); const i = document.getElementById('dse-swap-in-' + cid); out = o && o.value; inRef = i && i.value; } catch (_) {}
    try { localStorage.removeItem(swapKey(cid)); } catch (_) {}
    if (!out || !inRef || out === inRef) { host.ui.rerender(); return; }
    mutate(cid, (s) => {
      delRef(s, 'preparedSpells', classId, out);
      addRef(s, 'preparedSpells', classId, inRef);
      // Stamp BOTH the total level (legacy display) and the class level, so the Builder
      // spine can place the swap at the right class-tab row even when multiclassing (B4.5b).
      const cl = (s.classes || []).find((x) => x.classId === String(classId));
      const classLevel = cl ? num(cl.level, 1) : num(s.level, 1);
      s.spellSwaps = (s.spellSwaps || []).concat([{ level: num(s.level, 1), classLevel, classId: String(classId), out: String(out), in: String(inRef) }]);
      return s;
    });
  });
  host.registerAction('spellSwapForget', (cid, idx) => { mutate(cid, (s) => { s.spellSwaps = (s.spellSwaps || []).filter((_, i) => i !== num(idx)); return s; }); });
  // Drag-and-drop prep via the host drag seam.
  let _dragRef = null;
  host.registerAction('spellDragStart', (ev, ref) => {
    _dragRef = ref != null ? String(ref) : null;
    try { if (ev && ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'copy'; ev.dataTransfer.setData('text/plain', _dragRef || ''); } } catch (_) {}
  });
  host.registerAction('spellDrop', (cid, classId, kind) => {
    const ref = _dragRef; _dragRef = null;
    if (!ref) return;
    const bag = kind === 'cantrip' ? 'cantrips' : kind === 'spellbook' ? 'spellbook' : 'preparedSpells';
    const engine = getRules();
    mutate(cid, (s) => {
      // A drop can arrive from ANY group's pool card (unlike the click actions,
      // whose pools are pre-filtered), so validate it the same way those pools
      // are built: right class list, right level band for the target group,
      // capacity respected — an invalid drop is rejected, never silently
      // overfills (the over-limit chips exist only for legacy/level-down data).
      if (engine) {
        const comp = hydrateFor(s);
        const p = comp && comp.spellcasting && (comp.spellcasting.perClass || []).find((x) => x.classId === String(classId));
        const rec = engine.getItem ? engine.getItem('spell', ref) : null;
        const inClassList = engine.listSpells ? (engine.listSpells({ class: String(classId) }) || []).some((sp) => sp.id === ref) : true;
        if (!p || !rec || !inClassList) return s;
        const lvl = num(rec.level, 0);
        const chosen = (s[bag] && s[bag][classId]) || [];
        if (chosen.includes(ref)) return s;
        if (kind === 'cantrip') {
          if (lvl !== 0 || chosen.length >= num(p.cantripsKnown, 0)) return s;
        } else {
          if (lvl < 1 || lvl > Math.max(1, num(p.maxSpellLevel, 9))) return s;
          if (kind === 'spellbook') {
            if (p.prepares !== 'spellbook') return s;
          } else {
            if (chosen.length >= num(p.preparedLimit, 0)) return s;
            const alwaysSet = new Set((comp.spellcasting.granted || []).filter((g) => g.alwaysPrepared).map((g) => g.ref));
            if (alwaysSet.has(ref)) return s;
            // A spellbook caster prepares only from the LEARNED book (SP-5).
            if (p.prepares === 'spellbook' && !((s.spellbook && s.spellbook[classId]) || []).includes(ref)) return s;
          }
        }
      }
      addRef(s, bag, classId, ref);
      return s;
    });
  });
  // Choose-grant picks (Magic Initiate / Fey Touched / lineage cantrip).
  host.registerAction('grantPick', (cid, key, ref) => {
    if (!ref) return;
    mutate(cid, (s) => { const cur = (s.grantChoices[key] || []).slice(); if (!cur.includes(ref)) cur.push(ref); s.grantChoices = { ...s.grantChoices, [key]: cur }; return s; });
  });
  host.registerAction('grantUnpick', (cid, key, ref) => {
    mutate(cid, (s) => { s.grantChoices = { ...s.grantChoices, [key]: (s.grantChoices[key] || []).filter((r) => r !== ref) }; return s; });
  });
  host.registerAction('spellSet', (cid, sid, field, value) => {
    mutate(cid, (s) => {
      s.spells = s.spells.map((sp) => {
        if (sp.id !== sid) return sp;
        if (field === 'level') return { ...sp, level: Math.max(0, Math.min(9, num(value, 0))) };
        if (field === 'prepared') return { ...sp, prepared: value === '1' || value === true };
        return { ...sp, [field]: String(value) };
      });
      return s;
    });
  });

  // Backpack.
  host.registerAction('invAdd', (cid) => {
    mutate(cid, (s) => { s.inventory = s.inventory.concat([{ id: uid('item'), name: '', qty: 1, location: 'pack' }]); return s; });
  });
  host.registerAction('invDel', (cid, iid) => {
    mutate(cid, (s) => { s.inventory = s.inventory.filter((it) => it.id !== iid); return s; });
  });
  host.registerAction('invSet', (cid, iid, field, value) => {
    mutate(cid, (s) => {
      s.inventory = s.inventory.map((it) => {
        if (it.id !== iid) return it;
        if (field === 'qty') return { ...it, qty: Math.max(1, num(value, 1)) };
        return { ...it, [field]: String(value) };
      });
      return s;
    });
  });
  host.registerAction('invCycle', (cid, iid) => {
    mutate(cid, (s) => {
      s.inventory = s.inventory.map((it) => {
        if (it.id !== iid) return it;
        const i = LOCATIONS.indexOf(it.location || 'pack');
        return { ...it, location: LOCATIONS[(i + 1) % LOCATIONS.length] };
      });
      return s;
    });
  });
  host.registerAction('currencySet', (cid, coin, value) => {
    mutate(cid, (s) => { s.currency = { ...s.currency, [coin]: Math.max(0, num(value, 0)) }; return s; });
  });
  host.registerAction('invAddRef', (cid, kind, ref) => {
    if (!ref) return;
    const engine = getRules();
    const rec = engine && engine.getItem ? engine.getItem(kind, ref) : null;
    const location = kind === 'armor' ? 'equipped' : 'ready';
    // Store the compendium KIND we already know beside the ref, so lookups
    // never have to probe kinds (weapon→armor) and can't cross-kind misfire.
    mutate(cid, (s) => { s.inventory = s.inventory.concat([{ id: uid('item'), ref: String(ref), kind: String(kind), name: rec ? rec.name : String(ref), qty: 1, location, attuned: false }]); return s; });
  });
  host.registerAction('invAttune', (cid, iid) => {
    mutate(cid, (s) => { s.inventory = s.inventory.map((it) => (it.id === iid ? { ...it, attuned: !it.attuned } : it)); return s; });
  });

  // ── Band equipment slots (click-to-fill). Worn is free-form: the Armor/Shield
  //    anchor slots equip an item of their recommended type (bumping the previous
  //    occupant back to the pack — one item per anchor); the generic slot
  //    (type 'any') equips anything with no bumping. The Attunement slots attune
  //    an item (strict: attunement-requiring items only, enforced by the picker
  //    pool). ✕ on a filled slot clears it (unequip → back to the pack; unattune
  //    → stays put but leaves the Attunement group). These drive the band's
  //    paper-doll and, via the de-dup, what the backpack hides. ──
  host.registerAction('slotEquip', (cid, type, iid) => {
    if (!iid) return;
    mutate(cid, (s) => {
      const engine = getRules();
      const single = String(type) === 'armor' || String(type) === 'shield';
      const armorRec = (it) => (engine && engine.getItem ? (engine.getItem('armor', it.ref) || (it.name && engine.getItemByName ? engine.getItemByName('armor', it.name) : null)) : null);
      const isType = (it) => { const r = armorRec(it); if (!r) return false; return String(type) === 'shield' ? r.armorType === 'shield' : ['light', 'medium', 'heavy'].includes(r.armorType); };
      s.inventory = (s.inventory || []).map((it) => {
        if (it.id === iid) return { ...it, location: 'equipped' };
        // Anchor slots hold one item — bump the previous same-type occupant.
        if (single && (it.location || 'pack') === 'equipped' && !it.attuned && isType(it)) return { ...it, location: 'pack' };
        return it;
      });
      return s;
    });
  });
  host.registerAction('slotUnequip', (cid, iid) => {
    mutate(cid, (s) => { s.inventory = (s.inventory || []).map((it) => (it.id === iid ? { ...it, location: 'pack' } : it)); return s; });
  });
  host.registerAction('slotAttune', (cid, iid) => {
    if (!iid) return;
    mutate(cid, (s) => { s.inventory = (s.inventory || []).map((it) => (it.id === iid ? { ...it, attuned: true } : it)); return s; });
  });
  host.registerAction('slotUnattune', (cid, iid) => {
    mutate(cid, (s) => { s.inventory = (s.inventory || []).map((it) => (it.id === iid ? { ...it, attuned: false } : it)); return s; });
  });

  // ── Add-item wizard (floating overlay) — search + drill-down tree + batch tray.
  //    All state is in localStorage (the fragment re-renders on every action):
  //    open flag / current tree path / search query / the staged-items cart.
  //    Commit adds every staged item at once (quantity + a sensible location per
  //    kind), then closes. See panel.additem.js for the render. ──
  const aiwCartKey = (cid) => 'dse-additem-cart:' + cid;
  const aiwKeys = (cid) => ['dse-additem:' + cid, 'dse-additem-path:' + cid, 'dse-additem-q:' + cid, aiwCartKey(cid)];
  const aiwReadCart = (cid) => { try { return JSON.parse(localStorage.getItem(aiwCartKey(cid)) || '[]') || []; } catch (_) { return []; } };
  const aiwWriteCart = (cid, cart) => { try { localStorage.setItem(aiwCartKey(cid), JSON.stringify(cart)); } catch (_) {} };
  const aiwClear = (cid) => { try { aiwKeys(cid).forEach((k) => localStorage.removeItem(k)); } catch (_) {} };
  // Weapons ready to draw, armor worn, everything else stored in the pack.
  const aiwLocation = (kind) => (kind === 'armor' ? 'equipped' : kind === 'weapon' ? 'ready' : 'pack');
  const aiwStage = (cid, item) => {
    const cart = aiwReadCart(cid);
    const ex = cart.find((it) => it.key === item.key);
    if (ex) ex.qty = num(ex.qty, 1) + 1; else cart.push(item);
    aiwWriteCart(cid, cart);
    host.ui.rerender();
  };
  host.registerAction('addItemOpen', (cid) => { aiwClear(cid); try { localStorage.setItem('dse-additem:' + cid, 'open'); } catch (_) {} host.ui.rerender(); });
  host.registerAction('addItemClose', (cid) => { aiwClear(cid); host.ui.rerender(); });
  host.registerAction('addItemNav', (cid, path) => {
    try { localStorage.setItem('dse-additem-path:' + cid, String(path == null ? '' : path)); localStorage.removeItem('dse-additem-q:' + cid); } catch (_) {}
    host.ui.rerender();
  });
  host.registerAction('addItemSearch', (cid) => {
    let q = '';
    try { q = (document.getElementById('dse-additem-q-' + cid) || {}).value || ''; } catch (_) {}
    try { if (String(q).trim()) localStorage.setItem('dse-additem-q:' + cid, String(q)); else localStorage.removeItem('dse-additem-q:' + cid); } catch (_) {}
    host.ui.rerender();
  });
  host.registerAction('addItemStage', (cid, kind, ref) => {
    const engine = getRules();
    const rec = engine && engine.getItem ? engine.getItem(String(kind), String(ref)) : null;
    aiwStage(cid, { key: String(kind) + ':' + String(ref), kind: String(kind), ref: String(ref), name: rec ? rec.name : String(ref), qty: 1 });
  });
  host.registerAction('addItemStageCustom', (cid) => {
    let name = '';
    try { name = (document.getElementById('dse-additem-custom-' + cid) || {}).value || ''; } catch (_) {}
    name = String(name).trim();
    if (!name) { host.ui.rerender(); return; }
    aiwStage(cid, { key: 'custom:' + name.toLowerCase(), kind: '', ref: '', name, qty: 1, custom: true });
  });
  host.registerAction('addItemQty', (cid, key, value) => {
    const cart = aiwReadCart(cid);
    const it = cart.find((x) => x.key === key);
    if (it) it.qty = Math.max(1, num(value, 1));
    aiwWriteCart(cid, cart);
    host.ui.rerender();
  });
  host.registerAction('addItemUnstage', (cid, key) => { aiwWriteCart(cid, aiwReadCart(cid).filter((x) => x.key !== key)); host.ui.rerender(); });
  host.registerAction('addItemClear', (cid) => { aiwWriteCart(cid, []); host.ui.rerender(); });
  host.registerAction('addItemCommit', (cid) => {
    const cart = aiwReadCart(cid);
    if (cart.length) {
      mutate(cid, (s) => {
        const inv = Array.isArray(s.inventory) ? s.inventory.slice() : [];
        for (const it of cart) {
          const row = { id: uid('item'), name: it.name, qty: Math.max(1, num(it.qty, 1)), location: aiwLocation(it.kind), attuned: false };
          if (it.ref) row.ref = it.ref;
          if (it.kind) row.kind = it.kind;
          inv.push(row);
        }
        s.inventory = inv;
        return s;
      });
    }
    aiwClear(cid);
    host.ui.rerender();
  });

  // ── Resource trackers (Rage / Ki / slots / hit dice…). ± is a live-play action;
  //    naming/max/add/remove are edits. Clamp current into [0, max] when max>0. ──
  const clampRes = (cur, max) => (num(max, 0) > 0 ? Math.max(0, Math.min(num(max, 0), num(cur, 0))) : Math.max(0, num(cur, 0)));
  host.registerAction('resourceAdd', (cid) => {
    mutate(cid, (s) => { s.resources = s.resources.concat([{ id: uid('res'), name: '', current: 0, max: 0 }]); return s; });
  });
  host.registerAction('resourceDel', (cid, rid) => {
    mutate(cid, (s) => { s.resources = s.resources.filter((r) => r.id !== rid); return s; });
  });
  host.registerAction('resourceAdjust', (cid, rid, delta) => {
    mutate(cid, (s) => { s.resources = s.resources.map((r) => (r.id === rid ? { ...r, current: clampRes(num(r.current, 0) + Number(delta), r.max) } : r)); return s; });
  });
  host.registerAction('resourceSet', (cid, rid, field, value) => {
    mutate(cid, (s) => {
      s.resources = s.resources.map((r) => {
        if (r.id !== rid) return r;
        if (field === 'name') return { ...r, name: String(value) };
        if (field === 'max') { const max = Math.max(0, num(value, 0)); return { ...r, max, current: clampRes(r.current, max) }; }
        if (field === 'current') return { ...r, current: clampRes(value, r.max) };
        return r;
      });
      return s;
    });
  });

  // ── Engine-built trackers (comp.resources) — the engine owns name/max/recharge;
  //    we store only the current value per resource key (absent ⇒ full). ──
  host.registerAction('resourceUseAdjust', (cid, key, delta, max) => {
    mutate(cid, (s) => {
      const m = num(max, 0);
      const uses = { ...(s.resourceUses || {}) };
      const k = String(key);
      const cur = Object.prototype.hasOwnProperty.call(uses, k) ? num(uses[k], m) : m;
      uses[k] = m > 0 ? Math.max(0, Math.min(m, cur + Number(delta))) : Math.max(0, cur + Number(delta));
      s.resourceUses = uses;
      return s;
    });
  });
  host.registerAction('resourceUseReset', (cid, key) => {
    mutate(cid, (s) => { const uses = { ...(s.resourceUses || {}) }; delete uses[String(key)]; s.resourceUses = uses; return s; });
  });

  // ── Rest wizard (engine mode). Open/close is a UI flag (localStorage). Spending
  //    a hit die heals avg(die)+CON. A short/long rest regains each resource by its
  //    engine recharge rules for the triggered rest(s); a long rest also restores
  //    HP to full, clears temp HP, and regains half total level in hit dice. ──
  const restKey = (cid) => 'dse-rest:' + cid;
  const hydrateFor = (s) => { const engine = getRules(); const r = engine ? safeHydrate(engine, decisionsOf(s, engine)) : null; return r && r.sheet; };
  const resCur = (s, r) => (Object.prototype.hasOwnProperty.call(s.resourceUses || {}, r.key) ? num(s.resourceUses[r.key], r.max) : num(r.max, 0));

  host.registerAction('restOpen', (cid) => { try { localStorage.setItem(restKey(cid), 'open'); } catch (_) {} host.ui.rerender(); });
  host.registerAction('restClose', (cid) => { try { localStorage.removeItem(restKey(cid)); } catch (_) {} host.ui.rerender(); });

  host.registerAction('restSpendHitDie', (cid, dieKey) => {
    mutate(cid, (s) => {
      const comp = hydrateFor(s);
      const r = comp && (comp.resources || []).find((x) => x.key === dieKey && x.kind === 'hitdice');
      if (!r) return s;
      const cur = resCur(s, r);
      if (cur <= 0) return s;
      s.resourceUses = { ...(s.resourceUses || {}), [dieKey]: cur - 1 };
      const con = comp.abilities && comp.abilities.CON ? num(comp.abilities.CON.mod, 0) : 0;
      const heal = Math.max(1, hitDieAvg(r.die) + con);
      const maxHp = effectiveMaxHp(s, comp);   // override-aware max (ARCH-3)
      s.hp = maxHp > 0 ? Math.min(maxHp, num(s.hp, 0) + heal) : num(s.hp, 0) + heal;
      return s;
    });
  });

  host.registerAction('restApply', (cid, kind) => {
    const long = String(kind) === 'long';
    try { localStorage.removeItem(restKey(cid)); } catch (_) {}
    mutate(cid, (s) => {
      const comp = hydrateFor(s);
      const resources = (comp && comp.resources) || [];
      const totalLevel = comp ? num(comp.totalLevel, num(s.level, 1)) : num(s.level, 1);
      const maxHp = effectiveMaxHp(s, comp);   // override-aware max (ARCH-3)
      const abilMod = (a) => (comp && comp.abilities && comp.abilities[a] ? num(comp.abilities[a].mod, 0) : 0);
      const uses = { ...(s.resourceUses || {}) };
      const regain = (r, amount) => {
        const max = num(r.max, 0);
        const cur = Object.prototype.hasOwnProperty.call(uses, r.key) ? num(uses[r.key], max) : max;
        let next = cur;
        if (amount === 'full') next = max;
        else if (amount === 'halfLevel') next = Math.min(max, cur + Math.max(1, Math.floor(totalLevel / 2)));
        else if (amount && typeof amount === 'object' && amount.abilityMod) next = Math.min(max, cur + Math.max(1, abilMod(amount.abilityMod)));
        else next = Math.min(max, cur + num(amount, 0));
        if (next >= max) delete uses[r.key]; else uses[r.key] = next;
      };
      const triggers = long ? ['short', 'long'] : ['short'];
      for (const r of resources) for (const rc of r.recharge || []) if (triggers.includes(rc.on)) regain(r, rc.amount);
      s.resourceUses = uses;
      if (long) { s.hp = maxHp > 0 ? maxHp : num(s.hp, 0); s.tempHp = 0; }
      return s;
    });
  });

  // ── Builder (engine mode) — edit the rich decision model + materialize ────
  const { builderMutate, reconcile, builderModel } = ctx.engine;
  const parseAssign = (str) => { const a = {}; String(str || '').split(',').forEach((p) => { const [k, v] = p.split(':'); if (k && v) a[k.trim()] = num(v); }); return a; };
  const removeGrant = (s, id) => { s.abilityGrants = (s.abilityGrants || []).filter((g) => g.id !== id); };
  // `cap` (optional) is a RAISED per-ability max the grant carries (AB-4 —
  // 2024 Epic Boons: 30); absent → the engine's default 20 applies.
  const upsertGrant = (s, id, source, assign, cap) => { removeGrant(s, id); if (assign && Object.keys(assign).length) s.abilityGrants = (s.abilityGrants || []).concat([{ id, source, assign, ...(cap ? { cap: num(cap) } : {}) }]); };

  host.registerAction('builderField', (cid, field, value) => {
    builderMutate(cid, (s) => {
      s[field] = String(value);
      if (field === 'race') s.lineage = '';
      if (field === 'background') { delete s.featureChoices['bgasi']; removeGrant(s, 'bgasi'); }
    });
  });
  host.registerAction('builderAbility', (cid, ability, value) => {
    builderMutate(cid, (s) => { s.baseStats = { ...(s.baseStats || {}), [ability]: Math.max(1, Math.min(30, num(value, 10))) }; });
  });
  // Toggle point-buy ↔ manual base scores. Leaving manual (→ point buy) clamps
  // each base into the 8–15 point-buy range so the pool math stays valid.
  host.registerAction('builderToggleManual', (cid) => {
    builderMutate(cid, (s) => {
      const on = !s.manualScores;
      s.manualScores = on;
      if (!on) {
        const base = { ...(s.baseStats || {}) };
        for (const a of ABILITIES) base[a] = Math.max(POINT_BUY.min, Math.min(POINT_BUY.max, num(base[a], POINT_BUY.min)));
        s.baseStats = base;
      }
    });
  });
  // Point-buy SET (B5): the host `.codex-stepper` input fires change with the new
  // score; clamp to the point-buy floor/ceiling, then step down until within the
  // 27-point budget.
  host.registerAction('builderAbilitySet', (cid, ability, value) => {
    if (ABILITIES.indexOf(ability) < 0) return;
    let left = null;   // remaining point-buy budget, captured post-clamp
    builderMutate(cid, (s) => {
      const base = { ...(s.baseStats || {}) };
      const cur = num(base[ability], POINT_BUY.min);
      let next = Math.max(POINT_BUY.min, Math.min(POINT_BUY.max, num(value, POINT_BUY.min)));
      while (next > POINT_BUY.min && (pointsSpent(base) - pointCost(cur) + pointCost(next)) > POINT_BUY.budget) next--;
      base[ability] = next;
      s.baseStats = base;
      left = POINT_BUY.budget - pointsSpent(base);
    });
    // Announce the new remaining budget through the HOST's persistent live
    // region — the full-panel re-render destroys any in-page live region, so
    // this is what actually reaches screen readers. Feature-detected.
    if (left != null && typeof host.ui.announce === 'function') host.ui.announce(t('builder.pointsLeft', { n: left }));
  });
  // Structural edits (class/level/subclass/remove) can orphan level- or
  // owner-scoped decisions (ASI picks, pool picks) — reconcile prunes them so a
  // stale abilityGrant can't keep bumping scores (grants apply unconditionally).
  host.registerAction('builderClassSet', (cid, idx, classId) => {
    builderMutate(cid, (s, engine) => { if (s.classes[idx]) { s.classes[idx] = { ...s.classes[idx], classId: String(classId), subclass: '' }; } if (engine) reconcile(s, engine); });
  });
  // Set a class level (host `.codex-stepper` input change, B5). Reconciles orphaned
  // decisions, and — like the old +/- stepper — focuses (opens) the new top level
  // when the level grows so that level's choices are right there to resolve.
  host.registerAction('builderLevelSet', (cid, idx, value) => {
    let classId = '', newLevel = 1, grew = false;
    builderMutate(cid, (s, engine) => {
      const cl = s.classes[idx];
      if (cl) {
        const old = num(cl.level, 1);
        newLevel = Math.max(1, Math.min(20, num(value, 1)));
        grew = newLevel > old; classId = cl.classId;
        s.classes[idx] = { ...cl, level: newLevel };
      }
      if (engine) reconcile(s, engine);
    });
    if (grew && classId) { ctx.builderState[cid] = { ...(ctx.builderState[cid] || {}), tab: String(classId), open: classId + ':' + newLevel }; host.ui.rerender(); }
  });
  host.registerAction('builderSubclassSet', (cid, idx, subclass) => {
    builderMutate(cid, (s, engine) => { if (s.classes[idx]) s.classes[idx] = { ...s.classes[idx], subclass: String(subclass) }; if (engine) reconcile(s, engine); });
  });
  host.registerAction('builderAddClass', (cid) => {
    builderMutate(cid, (s) => { s.classes = s.classes.concat([{ classId: '', level: 1, subclass: '' }]); });
  });
  host.registerAction('builderRemoveClass', (cid, idx) => {
    builderMutate(cid, (s, engine) => { if (s.classes.length > 1) s.classes = s.classes.filter((_, i) => i !== idx); if (engine) reconcile(s, engine); });
  });
  // Builder sub-tab switch (Character | <classId>) — in-memory, clears any open level row.
  host.registerAction('builderTab', (cid, tab) => { ctx.builderState[cid] = { ...(ctx.builderState[cid] || {}), tab: String(tab), open: null }; host.ui.rerender(); });
  // Roving-tabindex keyboard nav across the Builder sub-tabs (Character + one per
  // class), mirroring the top tab bar's `tabKey`: Arrow keys move + focus follows.
  host.registerAction('builderTabKey', (ev, cid, tabId) => {
    const key = ev && ev.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    if (ev.preventDefault) ev.preventDefault();
    const engine = getRules();
    if (!engine) return;
    const s = sheetOf(host.store.getCharacters().find((x) => x && x.id === cid) || {});
    const classes = builderModel(s, engine).classes || [];
    const ids = ['character', ...classes.filter((cl) => cl.classId).map((cl) => cl.classId)];
    const cur = ids.indexOf(String(tabId));
    if (cur < 0) return;
    let next = cur;
    if (key === 'ArrowLeft') next = (cur - 1 + ids.length) % ids.length;
    else if (key === 'ArrowRight') next = (cur + 1) % ids.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = ids.length - 1;
    ctx.builderState[cid] = { ...(ctx.builderState[cid] || {}), tab: ids[next], open: null };
    host.ui.rerender();
    // Move focus to the newly-active tab after the re-render (DOM only — guarded so
    // the async callback never throws in a headless/test env).
    if (typeof document !== 'undefined') {
      const fid = 'dse-btab-' + cid + '-' + ids[next];
      setTimeout(() => { try { const el = document.getElementById(fid); if (el) el.focus(); } catch (_) {} }, 0);
    }
  });
  // Expand/collapse one level row (accordion — one open at a time; click again to close).
  host.registerAction('builderToggleLevel', (cid, key) => { const st = ctx.builderState[cid] || {}; ctx.builderState[cid] = { ...st, open: st.open === String(key) ? null : String(key) }; host.ui.rerender(); });
  // Level-independent extra feats (B4.5b) — read the picker + optional custom name +
  // note at click time. A compendium featId feeds the engine (mechanics apply); a
  // free-text name is tracked. builderMutate so a real feat re-materializes the sheet.
  host.registerAction('builderExtraFeatAdd', (cid) => {
    let featId = '', name = '', note = '';
    try {
      featId = (document.getElementById('dse-xfeat-id-' + cid) || {}).value || '';
      name = (document.getElementById('dse-xfeat-name-' + cid) || {}).value || '';
      note = (document.getElementById('dse-xfeat-note-' + cid) || {}).value || '';
    } catch (_) {}
    if (!featId && !String(name).trim()) { host.ui.rerender(); return; }
    builderMutate(cid, (s) => { s.extraFeats = (Array.isArray(s.extraFeats) ? s.extraFeats : []).concat([{ id: uid('xfeat'), featId: String(featId) || null, name: featId ? '' : String(name).trim(), sourceNote: String(note) }]); });
  });
  host.registerAction('builderExtraFeatRemove', (cid, id) => {
    builderMutate(cid, (s) => { s.extraFeats = (Array.isArray(s.extraFeats) ? s.extraFeats : []).filter((f) => f.id !== id); });
  });
  // Print / PDF (B4.6): build a self-contained sheet and open it in a new window,
  // which auto-opens the browser's print dialog (→ paper or Save as PDF). Isolated
  // from host chrome + theme. No-ops safely without a DOM (tests / headless).
  host.registerAction('printSheet', (cid) => {
    const ent = host.store.getCharacters().find((x) => x && x.id === cid) || { id: cid };
    const s = sheetOf(ent);
    const engine = getRules();
    const r = engine ? safeHydrate(engine, decisionsOf(s, engine)) : null;
    const html = buildPrintHtml(ent, s, r && r.sheet, engine);
    try {
      const w = window.open('', '_blank');
      if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print(); }
    } catch (_) {}
  });
  // Export (B4.6): download the character's sheet data as a JSON file (backup /
  // transfer). Serializes the normalized sheet; no-ops safely without a DOM.
  host.registerAction('exportSheet', (cid) => {
    const ent = host.store.getCharacters().find((x) => x && x.id === cid) || { id: cid };
    const json = JSON.stringify(sheetOf(ent), null, 2);
    const fname = String(ent.name || 'character').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'character';
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 1000);
    } catch (_) {}
  });
  // Import (B4.6): paste a previously-exported JSON to OVERWRITE this character.
  // The flag is a UI open-state; apply parses + normalizes (sheetOf) + replaces.
  const importKey = (cid) => 'dse-import:' + cid;
  host.registerAction('importOpen', (cid) => { try { localStorage.setItem(importKey(cid), 'open'); } catch (_) {} host.ui.rerender(); });
  host.registerAction('importClose', (cid) => { try { localStorage.removeItem(importKey(cid)); } catch (_) {} host.ui.rerender(); });
  host.registerAction('importApply', (cid) => {
    let raw = '';
    try { raw = (document.getElementById('dse-import-' + cid) || {}).value || ''; } catch (_) {}
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    try { localStorage.removeItem(importKey(cid)); } catch (_) {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { host.ui.rerender(); return; }
    // Replace the whole sheet with the imported data, normalized through sheetOf.
    mutate(cid, () => sheetOf({ addonData: { [NS]: parsed } }));
  });
  host.registerAction('builderBgAsi', (cid, value) => {
    builderMutate(cid, (s) => {
      if (!value) { delete s.featureChoices['bgasi']; removeGrant(s, 'bgasi'); return; }
      s.featureChoices['bgasi'] = String(value);
      upsertGrant(s, 'bgasi', { type: 'background' }, parseAssign(value));
    });
  });
  // Distribute-N-points ASI picker (B5): set one ability's delta (from the host
  // `.codex-stepper` input's change) in an ability grant (bg ASI 'bgasi' / class ASI
  // 'asi:<c>:<l>:ability' / half-feat '…:featability'), clamping to [0, perMax] and to
  // the shared `budget` server-side. The abilityGrants `assign` map is the source of
  // truth the engine hydrates; the grant's source type is derived from the key so
  // hydrate/reconcile treat it exactly as the old split-select did. Replaces
  // builderBgAsi + builderChoose(':ability') in the UI (both kept as programmatic entry points).
  host.registerAction('builderAsiSet', (cid, key, ability, value, budget, perMax) => {
    if (ABILITIES.indexOf(String(ability)) < 0) return;
    let left = null;   // remaining ASI budget, captured post-clamp
    builderMutate(cid, (s, engine) => {
      const k = String(key);
      const type = k === 'bgasi' ? 'background' : /:featability$/.test(k) ? 'feat' : 'asi';
      // A half-feat/boon ability pick inherits its feat's raised cap (Epic
      // Boons: max 30) so the engine can clamp past 20 for exactly this grant.
      let cap = null;
      if (type === 'feat' && engine) {
        const featId = s.featureChoices[k.replace(/:featability$/, ':feat')];
        cap = featAbilityCap(featId ? engine.getItem('feat', String(featId)) : null);
      }
      const g = (s.abilityGrants || []).find((x) => x.id === k);
      const assign = { ...((g && g.assign) || {}) };
      const pmax = Math.max(1, num(perMax, 2));
      const bud = Math.max(1, num(budget, 2));
      const others = ABILITIES.reduce((n, a) => n + (a === String(ability) ? 0 : num(assign[a], 0)), 0);
      let v = Math.max(0, Math.min(pmax, num(value, 0)));   // clamp 0..perMax
      v = Math.min(v, bud - others);                        // clamp to the remaining budget
      if (v <= 0) delete assign[ability]; else assign[ability] = v;
      left = bud - others - Math.max(0, v);
      upsertGrant(s, k, { type }, assign, cap);
    });
    // Same persistent-live-region announcement as point-buy (builderAbilitySet).
    if (left != null && typeof host.ui.announce === 'function') host.ui.announce(t('builder.pointsLeft', { n: left }));
  });
  host.registerAction('builderChoose', (cid, key, value) => {
    builderMutate(cid, (s, engine) => {
      const k = String(key);
      if (value === '' || value == null) delete s.featureChoices[k];
      else s.featureChoices[k] = String(value);
      if (/:featability$/.test(k)) {
        const featId = s.featureChoices[k.replace(/:featability$/, ':feat')];
        const cap = engine ? featAbilityCap(featId ? engine.getItem('feat', String(featId)) : null) : null;
        upsertGrant(s, k, { type: 'feat' }, value ? { [String(value)]: 1 } : null, cap);
      } else if (/:ability$/.test(k)) {
        upsertGrant(s, k, { type: 'asi' }, value ? { [String(value)]: 2 } : null);
      } else if (/:feat$/.test(k)) {
        const abilKey = k.replace(/:feat$/, '') + ':featability';
        removeGrant(s, abilKey); delete s.featureChoices[abilKey];
        const feat = value && engine ? engine.getItem('feat', String(value)) : null;
        const asi = feat && feat.grants && feat.grants.abilityScoreIncrease;
        // 'ANY' (Boon of Skill) expands to all six — never auto-applied; a
        // genuine single-option bump applies with its feat's cap (boons: 30).
        const from = featAsiFrom(asi);
        if (asi && from.length === 1) {
          upsertGrant(s, abilKey, { type: 'feat' }, { [from[0]]: num(asi.amount, 1) }, featAbilityCap(feat));
        }
      } else if (/^asi:[^:]+:\d+$/.test(k)) {
        if (value !== 'asi') { removeGrant(s, k + ':ability'); delete s.featureChoices[k + ':ability']; }
        if (value !== 'feat') { delete s.featureChoices[k + ':feat']; delete s.featureChoices[k + ':featability']; removeGrant(s, k + ':featability'); }
      }
    });
  });

  // ── Settings tab (Settings → Doplňky → 🎲 Character Sheets) ───────
  // UI options for the sheet (per-browser, each player picks their own) plus
  // the rules status: the engine is built in; the CONTENT comes from installed
  // book addons (Player's Handbook), so show whether one is connected.
  // The layout switch drives ctx.uiLayout() — see panel.rail.js /
  // panel.header.js for what 'compact' rearranges.
  host.registerAction('uiLayoutSet', (mode) => {
    try {
      if (String(mode) === 'compact') localStorage.setItem('dse-ui:layout', 'compact');
      else localStorage.removeItem('dse-ui:layout');
    } catch (_) {}
    host.ui.rerender();
  });
  host.registerSettingsTab({
    id: 'info', label: t('settings.label'), icon: '🎲',
    render: () => {
      const engine = getRules();
      const status = engine
        ? t('rules.connected', { count: engine.listClasses().length })
        : t('rules.disconnected');
      const layout = ctx.uiLayout();
      const opt = (mode, label, desc) => `
        <label style="display:flex;align-items:flex-start;gap:var(--space-2);padding:var(--space-2);border:1px solid ${layout === mode ? 'rgba(var(--accent-gold-rgb),.45)' : 'var(--border-subtle)'};border-radius:var(--radius);cursor:pointer">
          <input type="radio" name="dse-layout" value="${esc(mode)}" ${layout === mode ? 'checked' : ''} ${host.h.dataOn('change', host.action('uiLayoutSet'), mode)}>
          <span><strong style="color:var(--text-parchment)">${esc(label)}</strong>
            <span style="display:block;color:var(--text-muted);font-size:var(--text-sm)">${esc(desc)}</span></span>
        </label>`;
      return `
      <div class="settings-editor-head"><h2>🎲 ${esc(t('help.title'))}</h2></div>
      <div class="settings-panel">
        <h3 style="margin:0 0 var(--space-1)">${esc(t('settings.layoutTitle'))}</h3>
        <p class="settings-hint">${esc(t('settings.layoutHint'))}</p>
        <div style="display:flex;flex-direction:column;gap:var(--space-2);max-width:34rem">
          ${opt('classic', t('settings.layoutClassic'), t('settings.layoutClassicDesc'))}
          ${opt('compact', t('settings.layoutCompact'), t('settings.layoutCompactDesc'))}
        </div>
      </div>
      <div class="settings-panel">
        <p class="settings-hint">${esc(t('help.body', { count: host.store.getCharacters().length }))}</p>
        <p class="settings-hint" style="color:${engine ? 'var(--color-success)' : 'var(--text-muted)'}">${esc(status)}</p>
      </div>`;
    },
  });

  // ── Rules API for other addons ────────────────────────────────────
  // The same api the panels consume (rules/api.js over live book data). A
  // future addon (combat tools, NPC generators) declares this addon as a
  // dependency and host.use('dnd55e-sheets') to reach hydrate/derive/list*.
  // Provided unconditionally: without a book addon the passthroughs return
  // empty lists and hydrate degrades to universal math + warnings.
  host.provide(ctx.engine.rulesApi);
}

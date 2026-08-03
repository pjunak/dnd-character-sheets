// ═══════════════════════════════════════════════════════════════
//  dnd-sheets — a fully hand-fillable D&D character sheet.
//
//  Rides on the host's CORE `characters` entity (the sheet is NOT an addon
//  collection): all D&D data lives in `character.addonData['dnd-sheets']`,
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
//    • Builder         — guided progression; engine mode + editors only.
//    • Settings        — per-sheet layout switch + print/export/import, rightmost.
//  A slim vitals bar (HP / AC / Init / Speed / PB / Passive + spell DC/attack
//  + class-level line) sits under the tabs on the mechanical tabs (panel.header.js).
//
//  ── Editing: direct, role-gated, NO separate mode ──
//  The host already owns the one edit affordance — "✏ Upravit" rides the
//  side-card, which lands inside our Overview tab, so it appears exactly with
//  the identity/lore content it edits. We don't add a second button: editors
//  (`!isAnonymous()`) edit D&D directly in the tabs (and the Builder);
//  anonymous viewers see read-only. Live-play controls (HP, trackers, prep,
//  prof toggles) follow the same gate.
//
//  ── Module layout (decomposed; native ES modules, no build step) ──
//    rules/engine.js     the PURE D&D rules engine (host-free, tests/rules.mjs)
//    rules/api.js        │  — merged from the retired dnd55e-core-rules addon.
//                        └  makeRulesApi(getData): engine + live book data.
//    helpers.js          pure constants + helpers (re-exports the rules facts).
//    model.js            decision/derivation pipeline + viewModel + mutators.
//    ui.js               shared render primitives (section/heroTile/abilityTile/…).
//    actions.*.js        domain controllers: base, spells, inventory, resources,
//                        Builder, and print/export/import; each owns its cleanup.
//    panel.header.js     the slim D&D vitals bar.
//    panel.overview.js   ┐  one render module per tab (Character Sheet / Combat /
//    panel.sheet.js      │  Spellbook / Backpack / Builder). The Overview tab is
//    panel.spellbook.js  │  just the host lore, so it has no module.
//    panel.backpack.js   │
//    panel.builder.js    ┘
//
//  Style/safety contract: HTML only via host.h (esc/dataAction/dataOn), never
//  inline onclick; colours/spacing only via design tokens var(--…); every
//  display string flows through host.i18n.t() so locales layer on with no rewrite.
// ═══════════════════════════════════════════════════════════════

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
import { makeSettingsPanel } from './panel.settings.js';
import { makePrintPanel } from './panel.print.js';
import { registerBaseActions } from './actions.base.js';
import { registerSpellActions } from './actions.spells.js';
import { registerInventoryActions } from './actions.inventory.js';
import { registerResourceActions } from './actions.resources.js';
import { registerBuilderActions } from './actions.builder.js';
import { registerTransferActions } from './actions.transfer.js';
import { createUiState } from './ui-state.js';

export default function register(host) {
  const { esc } = host.h;
  const { t, plural } = host.i18n;
  const NS = host.id; // 'dnd-sheets'
  const { uid, sheetOf } = makeHelpers(host);

  // ── Shared context handed to every module. ──
  const ctx = {
    host, t, plural, NS,
    ABILITIES, COINS, LOCATIONS, SKILLS,
    num, abilityMod, signed, titleize, clampHp, blank, uid, sheetOf, compendiumHref, firstPara, featureRecordFor,
    POINT_BUY, pointCost, pointsSpent, hitDieAvg, scrollCopyCost, ASI_RULES, featAsiFrom, featAbilityCap,
  };
  ctx.uiState = createUiState();
  ctx.uiLayout = ctx.uiState.getLayout;
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
    ...makeSettingsPanel(ctx),
    ...makePrintPanel(ctx),
  };

  const {
    getRules,
    safeHydrate,
    decisionsOf,
    mutate,
    effectiveMaxHp,
    resolveProvider,
    prepareSheetExport,
  } = ctx.engine;
  const { vitalsBar, panelOverview, panelSheet, panelSpellbook, panelBuilder, panelSettings, restModal, spellSwapModal, spellbookMgrModal, buildPrintHtml, importModal, addItemModal } = ctx.panels;

  // ── Tab model ────────────────────────────────────────────────────
  //  Overview (lore) + the mechanical tabs. Spellbook only when the character
  //  has spells (UI-4); Builder only in engine mode and for editors; Settings
  //  (per-sheet layout + print/export/import) for everyone, rightmost.
  const visibleTabs = (engine, hasSpells, editable) => {
    const tabs = [
      { id: 'overview', icon: '🪪', label: t('tab.overview'), hint: t('tab.overviewHint') },
      { id: 'stats',    icon: '📋', label: t('tab.stats'),    hint: t('tab.statsHint') },
      { id: 'combat',   icon: '⚔️', label: t('tab.combat'),   hint: t('tab.combatHint') },
    ];
    // Backpack (inventory + currency) folded into the Character Sheet tab — no own tab.
    if (hasSpells) tabs.push({ id: 'spellbook', icon: '📖', label: t('tab.spellbook'), hint: t('tab.spellbookHint') });
    if (engine && editable) tabs.push({ id: 'builder', icon: '🛠️', label: t('tab.builder'), hint: t('tab.builderHint'), tool: true });
    tabs.push({ id: 'settings', icon: '⚙️', label: t('tab.settings'), hint: t('tab.settingsHint'), tool: true });
    return tabs;
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
      const engine = getRules(s);
      const result = engine ? safeHydrate(engine, decisionsOf(s, engine)) : null;
      const comp = result && result.sheet;
      const warnings = (result && result.warnings) || [];
      const tabs = visibleTabs(engine, hasSpellsOf(engine, comp, s), editable);
      const active = ctx.uiState.getTab(c.id, tabs);
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
      else if (active === 'settings') panel = panelSettings(c, s, editable, engine);
      // Spellbook keeps the vital strip as a full-width band on top. Character Sheet
      // & Combat place it themselves (in their right column), so entry doesn't add it.
      const vitals = (active === 'spellbook') ? vitalsBar(c, s, comp, editable, engine) : '';

      const restOpen = !!(engine && editable && restModal && ctx.uiState.get(c.id, 'restOpen', false));
      const restOverlay = restOpen ? restModal(c, s, comp) : '';
      const swapClass = engine && editable && spellSwapModal
        ? ctx.uiState.get(c.id, 'spellSwapClass')
        : null;
      const swapOverlay = swapClass ? spellSwapModal(c, s, comp, engine, swapClass) : '';
      const spellMgrMode = engine && editable && spellbookMgrModal
        ? ctx.uiState.get(c.id, 'spellManagerMode')
        : null;
      const spellMgrOverlay = (spellMgrMode === 'copy' || spellMgrMode === 'other') ? spellbookMgrModal(c, s, comp, engine, spellMgrMode) : '';

      // Print / Export / Import live on the ⚙ Settings tab (panel.settings.js)
      // — the old toolbar row above the tab strip is gone (vertical space).

      const importOpen = !!(editable && importModal && ctx.uiState.get(c.id, 'importOpen', false));
      const importOverlay = importOpen ? importModal(c) : '';

      const addItemOpen = !!(editable && addItemModal && ctx.uiState.get(c.id, 'addItem'));
      const addItemOverlay = addItemOpen ? addItemModal(c, s, engine) : '';

      return `<div class="addon-dnd-sheets codex-stack codex-stack-flush">${ctx.ui.styleTag}${tabBar}
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
      : `<div class="codex-muted">${esc(t('sheet.notesEmpty'))}</div>`;
    return `<div class="codex-reading-flow">${lore}</div>`;
  }


  const disposers = [
    registerBaseActions({ host, ABILITIES, SKILLS, num, clampHp, sheetOf, mutate, effectiveMaxHp, getRules, safeHydrate, decisionsOf, resolveProvider, visibleTabs, hasSpellsOf, tabBtnId, uiState: ctx.uiState }),
    registerSpellActions({ host, num, uid, mutate, getRules, safeHydrate, decisionsOf, scrollCopyCost, uiState: ctx.uiState }),
    registerInventoryActions({ host, num, uid, sheetOf, mutate, getRules, LOCATIONS, uiState: ctx.uiState }),
    registerResourceActions({ host, num, uid, mutate, getRules, safeHydrate, decisionsOf, effectiveMaxHp, hitDieAvg, uiState: ctx.uiState }),
    registerBuilderActions({ host, plural, num, uid, ABILITIES, POINT_BUY, pointCost, pointsSpent, featAsiFrom, featAbilityCap, uiState: ctx.uiState, sheetOf, getRules, engine: ctx.engine }),
    registerTransferActions({ host, NS, blank, sheetOf, getRules, safeHydrate, decisionsOf, buildPrintHtml, mutate, prepareSheetExport, uiState: ctx.uiState }),
  ].filter(Boolean);

  host.provide(ctx.engine.rulesApi);
  return () => {
    for (const dispose of disposers.slice().reverse()) dispose();
    ctx.uiState.clear();
  };
}

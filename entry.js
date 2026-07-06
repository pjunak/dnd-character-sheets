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
//    • Character Sheet — ability scores, saving throws, skills, notes.
//    • Combat          — attacks from equipped/ready weapons + resource trackers.
//    • Backpack        — inventory grouped by carry location + currency.
//    • Spellbook       — prepared/cantrip slots, granted/choose-grant (UI-4).
//    • Builder         — guided progression; engine mode + editors only, rightmost.
//  A slim vitals bar (HP ± / AC / Init / Speed / PB / Passive + class-level line)
//  sits under the tabs on the mechanical tabs (panel.header.js).
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
  POINT_BUY, pointCost, pointsSpent,
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
import { makeBuilderPanel } from './panel.builder.js';

export default function register(host) {
  const { esc } = host.h;
  const NS = host.id; // 'dnd55e-sheets'
  const { uid, sheetOf } = makeHelpers(host);

  // ── Shared context handed to every module. ──
  const ctx = {
    host, t, NS,
    ABILITIES, COINS, LOCATIONS, SKILLS,
    num, abilityMod, signed, titleize, clampHp, blank, uid, sheetOf, compendiumHref, firstPara, featureRecordFor,
    POINT_BUY, pointCost, pointsSpent,
  };
  // Builder UI state, per character id: { tab: 'character'|<classId>, open: '<classId>:<level>'|null }.
  // In-memory (shared via ctx → the Builder panel reads it; actions below mutate it) — deliberately
  // NOT persisted: the Builder is only opened to create/level a character, so it defaults to the
  // Character tab each load, and this saves any localStorage plumbing (B4.5b).
  ctx.builderState = {};
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
    ...makeBuilderPanel(ctx),
  };

  const { getRules, safeHydrate, decisionsOf, mutate } = ctx.engine;
  const { vitalsBar, panelOverview, panelSheet, panelSpellbook, panelBackpack, panelBuilder, restModal, spellSwapModal, spellbookMgrModal } = ctx.panels;

  // ── Tab model ────────────────────────────────────────────────────
  //  Overview (lore) + the mechanical tabs. Spellbook only when the character has
  //  spells (UI-4); Builder only in engine mode and for editors (rightmost).
  const visibleTabs = (engine, hasSpells, editable) => {
    const tabs = [
      { id: 'overview', icon: '🪪', label: t('tab.overview'), hint: t('tab.overviewHint') },
      { id: 'stats',    icon: '📋', label: t('tab.stats'),    hint: t('tab.statsHint') },
      { id: 'combat',   icon: '⚔️', label: t('tab.combat'),   hint: t('tab.combatHint') },
      { id: 'backpack', icon: '🎒', label: t('tab.backpack'), hint: t('tab.backpackHint') },
    ];
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
      else if (active === 'stats') panel = panelOverview(c, s, editable, comp, engine);
      else if (active === 'combat') panel = panelSheet(c, s, editable, comp, engine);
      else if (active === 'backpack') panel = panelBackpack(c, s, editable, comp, engine);
      else if (active === 'spellbook') panel = panelSpellbook(c, s, editable, comp, engine);
      else if (active === 'builder') panel = panelBuilder(c, s, editable, comp, warnings, engine);
      // Backpack & Spellbook keep the vital strip as a full-width band on top.
      // Character Sheet & Combat place it themselves (in their right column,
      // beside the ability cards), so entry doesn't add it there.
      const vitals = (active === 'backpack' || active === 'spellbook')
        ? vitalsBar(c, s, comp, editable, engine) : '';

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

      return `<div class="addon-dnd55e-sheets" style="display:flex;flex-direction:column">${ctx.ui.styleTag}${tabBar}
        <div role="tabpanel" id="${esc(pid)}" aria-labelledby="${esc(tabBtnId(c.id, active))}" tabindex="0">${vitals}${panel}</div>${restOverlay}${swapOverlay}${spellMgrOverlay}</div>`;
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
      if (field === 'maxHp') s.hp = clampHp(num(s.hp, 0), n);
      else if (field === 'hp') s.hp = clampHp(n, num(s.maxHp, 0));
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
    const maxHp = num(s.maxHp, 0);
    s.hp = clampHp(num(s.hp, maxHp) + d, maxHp);
    return s;
  };
  host.registerAction('hp', (id, delta) => { mutate(id, (s) => applyHp(s, delta)); });

  // Manual heal/damage by an arbitrary amount typed into the HP amount field
  // (id `dse-hp-amt-<cid>`) — dir +1 heals, −1 damages. Reads the DOM value at
  // click time (the field is cleared on the ensuing re-render).
  host.registerAction('hpApply', (cid, dir) => {
    let amt = 0;
    try { const el = document.getElementById('dse-hp-amt-' + cid); amt = Math.abs(num(el && el.value, 0)); if (el) el.value = ''; } catch (_) {}
    if (!amt) return;
    mutate(cid, (s) => applyHp(s, (Number(dir) || 0) * amt));
  });

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
  host.registerAction('spellMgrOpen', (cid, mode) => { try { localStorage.setItem(spellMgrKey(cid), mode || 'other'); } catch (_) {} host.ui.rerender(); });
  host.registerAction('spellMgrClose', (cid) => { try { localStorage.removeItem(spellMgrKey(cid)); } catch (_) {} host.ui.rerender(); });
  // Copy a spell into the book: read the picked spell (+ optional scroll) at click
  // time, charge 50 gp × spell level (2024 copying cost), consume the scroll if one
  // was chosen, and add the ref to s.spellbook[classId] (→ preparable via B4.2b).
  host.registerAction('spellCopy', (cid, classId) => {
    let ref = '', scrollId = '';
    try { const sp = document.getElementById('dse-copy-spell-' + cid); const sc = document.getElementById('dse-copy-scroll-' + cid); ref = sp && sp.value; scrollId = sc && sc.value; } catch (_) {}
    if (!ref) { host.ui.rerender(); return; }
    const engine = getRules();
    const rec = engine && engine.getItem ? engine.getItem('spell', ref) : null;
    const cost = 50 * Math.max(1, num(rec && rec.level, 1));
    mutate(cid, (s) => {
      addRef(s, 'spellbook', classId, ref);
      s.currency = { ...s.currency, gp: Math.max(0, num(s.currency.gp, 0) - cost) };
      if (scrollId) s.inventory = s.inventory
        .map((it) => (it.id === scrollId ? { ...it, qty: num(it.qty, 1) - 1 } : it))
        .filter((it) => !(it.id === scrollId && num(it.qty, 0) <= 0));
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
    mutate(cid, (s) => { addRef(s, bag, classId, ref); return s; });
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
    mutate(cid, (s) => { s.inventory = s.inventory.concat([{ id: uid('item'), ref: String(ref), name: rec ? rec.name : String(ref), qty: 1, location, attuned: false }]); return s; });
  });
  host.registerAction('invAttune', (cid, iid) => {
    mutate(cid, (s) => { s.inventory = s.inventory.map((it) => (it.id === iid ? { ...it, attuned: !it.attuned } : it)); return s; });
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
  const DIE_AVG = { d6: 4, d8: 5, d10: 6, d12: 7 };
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
      const heal = Math.max(1, (DIE_AVG[r.die] || 5) + con);
      const maxHp = comp.derived ? num(comp.derived.maxHp, 0) : num(s.maxHp, 0);
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
      const maxHp = comp && comp.derived ? num(comp.derived.maxHp, num(s.maxHp, 0)) : num(s.maxHp, 0);
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
  const { builderMutate, reconcile } = ctx.engine;
  const parseAssign = (str) => { const a = {}; String(str || '').split(',').forEach((p) => { const [k, v] = p.split(':'); if (k && v) a[k.trim()] = num(v); }); return a; };
  const removeGrant = (s, id) => { s.abilityGrants = (s.abilityGrants || []).filter((g) => g.id !== id); };
  const upsertGrant = (s, id, source, assign) => { removeGrant(s, id); if (assign && Object.keys(assign).length) s.abilityGrants = (s.abilityGrants || []).concat([{ id, source, assign }]); };

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
  // Point-buy ±1 on one ability — bounded to 8–15 and refused if an increase
  // would overspend the 27-point budget (decreases always allowed).
  host.registerAction('builderAbilityStep', (cid, ability, dir) => {
    if (ABILITIES.indexOf(ability) < 0) return;
    builderMutate(cid, (s) => {
      const base = { ...(s.baseStats || {}) };
      const cur = Math.max(POINT_BUY.min, Math.min(POINT_BUY.max, num(base[ability], POINT_BUY.min)));
      const next = cur + Number(dir);
      if (next < POINT_BUY.min || next > POINT_BUY.max) return;
      if (Number(dir) > 0 && (pointsSpent(base) - pointCost(cur) + pointCost(next)) > POINT_BUY.budget) return;
      base[ability] = next;
      s.baseStats = base;
    });
  });
  // Structural edits (class/level/subclass/remove) can orphan level- or
  // owner-scoped decisions (ASI picks, pool picks) — reconcile prunes them so a
  // stale abilityGrant can't keep bumping scores (grants apply unconditionally).
  host.registerAction('builderClassSet', (cid, idx, classId) => {
    builderMutate(cid, (s, engine) => { if (s.classes[idx]) { s.classes[idx] = { ...s.classes[idx], classId: String(classId), subclass: '' }; } if (engine) reconcile(s, engine); });
  });
  host.registerAction('builderLevelSet', (cid, idx, value) => {
    builderMutate(cid, (s, engine) => { if (s.classes[idx]) s.classes[idx] = { ...s.classes[idx], level: Math.max(1, Math.min(20, num(value, 1))) }; if (engine) reconcile(s, engine); });
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
  // Expand/collapse one level row (accordion — one open at a time; click again to close).
  host.registerAction('builderToggleLevel', (cid, key) => { const st = ctx.builderState[cid] || {}; ctx.builderState[cid] = { ...st, open: st.open === String(key) ? null : String(key) }; host.ui.rerender(); });
  // Level a class up/down by one (guided add-a-level). Adding a level focuses (opens)
  // the new top level so its choices are right there to resolve.
  host.registerAction('builderLevelStep', (cid, classId, dir) => {
    let newLevel = 1;
    builderMutate(cid, (s, engine) => {
      const cl = (s.classes || []).find((x) => x.classId === String(classId));
      if (cl) { cl.level = Math.max(1, Math.min(20, num(cl.level, 1) + num(dir, 0))); newLevel = cl.level; }
      if (engine) reconcile(s, engine);
    });
    if (num(dir, 0) > 0) { ctx.builderState[cid] = { ...(ctx.builderState[cid] || {}), tab: String(classId), open: classId + ':' + newLevel }; host.ui.rerender(); }
  });
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
  host.registerAction('builderBgAsi', (cid, value) => {
    builderMutate(cid, (s) => {
      if (!value) { delete s.featureChoices['bgasi']; removeGrant(s, 'bgasi'); return; }
      s.featureChoices['bgasi'] = String(value);
      upsertGrant(s, 'bgasi', { type: 'background' }, parseAssign(value));
    });
  });
  host.registerAction('builderChoose', (cid, key, value) => {
    builderMutate(cid, (s, engine) => {
      const k = String(key);
      if (value === '' || value == null) delete s.featureChoices[k];
      else s.featureChoices[k] = String(value);
      if (/:featability$/.test(k)) {
        upsertGrant(s, k, { type: 'feat' }, value ? { [String(value)]: 1 } : null);
      } else if (/:ability$/.test(k)) {
        upsertGrant(s, k, { type: 'asi' }, value ? { [String(value)]: 2 } : null);
      } else if (/:feat$/.test(k)) {
        const abilKey = k.replace(/:feat$/, '') + ':featability';
        removeGrant(s, abilKey); delete s.featureChoices[abilKey];
        const feat = value && engine ? engine.getItem('feat', String(value)) : null;
        const asi = feat && feat.grants && feat.grants.abilityScoreIncrease;
        if (asi && Array.isArray(asi.from) && asi.from.length === 1) {
          upsertGrant(s, abilKey, { type: 'feat' }, { [asi.from[0]]: num(asi.amount, 1) });
        }
      } else if (/^asi:[^:]+:\d+$/.test(k)) {
        if (value !== 'asi') { removeGrant(s, k + ':ability'); delete s.featureChoices[k + ':ability']; }
        if (value !== 'feat') { delete s.featureChoices[k + ':feat']; delete s.featureChoices[k + ':featability']; removeGrant(s, k + ':featability'); }
      }
    });
  });

  // ── Info tab (Settings → 🎲 Character Sheets) ─────────────────────
  // Also reports the rules status: the engine is built in; the CONTENT comes
  // from installed book addons (Player's Handbook), so show whether one is
  // connected and how many classes it currently serves.
  host.registerSettingsTab({
    id: 'info', label: t('settings.label'), icon: '🎲',
    render: () => {
      const engine = getRules();
      const status = engine
        ? t('rules.connected', { count: engine.listClasses().length })
        : t('rules.disconnected');
      return `
      <div class="settings-editor-head"><h2>🎲 ${esc(t('help.title'))}</h2></div>
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

import { registerActionMap } from './actions.shared.js';

export const BASE_ACTIONS = Object.freeze([
  'tab', 'tabKey', 'setField', 'setAbility', 'toggleSave', 'toggleSkill',
  'setOverrideValue', 'clearOverride', 'uiLayoutSet', 'providerResolve',
]);

export function registerBaseActions(deps) {
  const {
    host, ABILITIES, SKILLS, num, clampHp, sheetOf, mutate, effectiveMaxHp,
    getRules, safeHydrate, decisionsOf, resolveProvider, visibleTabs,
    hasSpellsOf, tabBtnId, uiState,
  } = deps;
  const timers = new Set();
  const later = (fn) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, 0);
    timers.add(id);
  };
  const stringFields = { player: 1, className: 1, subclass: 1, background: 1, alignment: 1, notes: 1 };
  const numberFields = { level: 1, maxHp: 1, hp: 1, tempHp: 1, ac: 1, initiative: 1, speed: 1, profBonus: 1 };
  const overrideFields = { maxHp: 1, ac: 1, initiative: 1, speed: 1 };
  const skillIds = new Set(SKILLS.map((skill) => skill.id));

  registerActionMap(host, {
    tab(cid, tabId) {
      uiState.setTab(cid, tabId);
      host.ui.rerender();
    },
    tabKey(ev, cid, tabId) {
      const key = ev && ev.key;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
      if (ev.preventDefault) ev.preventDefault();
      const sheet = sheetOf(host.store.getCharacters().find((item) => item && item.id === cid) || {});
      const engine = getRules(sheet);
      const result = engine ? safeHydrate(engine, decisionsOf(sheet, engine)) : null;
      const tabs = visibleTabs(engine, hasSpellsOf(engine, result && result.sheet, sheet), !host.role.isAnonymous());
      const ids = tabs.map((tab) => tab.id);
      const current = ids.indexOf(tabId);
      if (current < 0) return;
      const next = key === 'Home' ? 0 : key === 'End' ? ids.length - 1
        : key === 'ArrowLeft' ? (current - 1 + ids.length) % ids.length : (current + 1) % ids.length;
      uiState.setTab(cid, ids[next]);
      host.ui.rerender();
      if (typeof document !== 'undefined') {
        later(() => { const el = document.getElementById(tabBtnId(cid, ids[next])); if (el) el.focus(); });
      }
    },
    setField(cid, field, value) {
      if (!stringFields[field] && !numberFields[field]) return;
      mutate(cid, (sheet) => {
        if (stringFields[field]) { sheet[field] = String(value == null ? '' : value); return sheet; }
        let next = num(value, 0);
        if (field === 'level') next = Math.max(1, next);
        else if (field === 'maxHp' || field === 'tempHp' || field === 'speed') next = Math.max(0, next);
        sheet[field] = next;
        if (field === 'maxHp') sheet.hp = clampHp(num(sheet.hp, 0), effectiveMaxHp(sheet));
        else if (field === 'hp') sheet.hp = clampHp(next, effectiveMaxHp(sheet));
        return sheet;
      });
    },
    setAbility(cid, ability, value) {
      if (!ABILITIES.includes(ability)) return;
      mutate(cid, (sheet) => {
        sheet.abilities = { ...sheet.abilities, [ability]: Math.max(1, Math.min(30, num(value, 10))) };
        return sheet;
      });
    },
    toggleSave(cid, ability) {
      if (!ABILITIES.includes(ability)) return;
      mutate(cid, (sheet) => {
        const manual = { ...(sheet.manualSaveProf || {}) };
        manual[ability] = !manual[ability];
        sheet.manualSaveProf = manual;
        if (!getRules(sheet)) {
          sheet.saveProf = { ...(sheet.saveProf || {}), [ability]: manual[ability] };
        }
        return sheet;
      });
    },
    toggleSkill(cid, skillId) {
      if (!skillIds.has(skillId)) return;
      mutate(cid, (sheet) => {
        sheet.skillProf = { ...sheet.skillProf, [skillId]: !sheet.skillProf[skillId] };
        return sheet;
      });
    },
    setOverrideValue(cid, field, raw) {
      if (!overrideFields[field]) return;
      const value = String(raw == null ? '' : raw).trim();
      mutate(cid, (sheet) => {
        const overrides = { ...(sheet.overrides || {}) };
        if (value === '') delete overrides[field]; else overrides[field] = num(value, 0);
        sheet.overrides = overrides;
        return sheet;
      });
    },
    clearOverride(cid, field) {
      if (!overrideFields[field]) return;
      mutate(cid, (sheet) => {
        const overrides = { ...(sheet.overrides || {}) };
        delete overrides[field];
        sheet.overrides = overrides;
        return sheet;
      });
    },
    uiLayoutSet(cid, mode) {
      uiState.setLayout(cid, String(mode));
      host.ui.rerender();
    },
    providerResolve(cid, choice) {
      resolveProvider(cid, choice);
    },
  });

  return () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}

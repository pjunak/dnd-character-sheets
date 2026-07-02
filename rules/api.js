// ═══════════════════════════════════════════════════════════════
//  dnd55e-core-rules — the generic D&D 5.5e (2024) rules engine ("handler").
//
//  It encodes the SYSTEM rules (how proficiency bonus / ability modifiers / HP /
//  AC / saves / skills / spell slots are computed and how declarative
//  grants/formulas are interpreted) but NO content. All content comes from
//  dnd55e-compendium (a HARD dependency) via host.use — so adding a new
//  class/subclass/item/spell is a compendium data change and never touches this
//  engine.
//
//  It provide()s the rules API consumed by dnd55e-sheets:
//    • list*()/getItem()  — passthrough of compendium data for dropdowns
//    • hydrate(decisions) — decisions → computed sheet (NEVER throws; warnings[])
//    • derive.*           — granular stat helpers
//
//  The actual math lives in the pure, host-free engine.js (unit-testable). This
//  file just wires it to the compendium accessor + the host facade.
// ═══════════════════════════════════════════════════════════════

import { t } from './i18n.js';
import * as Engine from './engine.js';

export default function register(host) {
  const { esc } = host.h;

  // Lazy handle to the compendium data API. core-rules HARD-depends on it, so
  // load order guarantees it's present by the time anything runs — but we guard
  // so a transient absence degrades to empty/warnings instead of throwing.
  const data = () => { try { return host.use('dnd55e-compendium'); } catch (_) { return null; } };

  /** Decisions → computed sheet, via the pure engine + live compendium data. */
  const hydrate = (decisions) => Engine.hydrate(decisions, data());

  // ── Provide the rules API (consumed by dnd55e-sheets) ────────────
  host.provide({
    apiVersion: 1,
    // dropdown enumeration — passthrough of compendium data
    listClasses:     () => (data()?.listClasses?.() || []),
    listSubclasses:  (classId) => (data()?.listSubclasses?.(classId) || []),
    listSpecies:     () => (data()?.listSpecies?.() || []),
    listBackgrounds: () => (data()?.listBackgrounds?.() || []),
    listFeats:       (opts) => (data()?.listFeats?.(opts) || []),
    listSpells:      (q) => (data()?.listSpells?.(q) || []),
    listEquipment:   (q) => (data()?.listEquipment?.(q) || []),
    listArmor:       () => (data()?.listArmor?.() || []),
    listWeapons:     () => (data()?.listWeapons?.() || []),
    listSkills:      () => (data()?.listSkills?.() || []),
    getItem:         (kind, id) => (data()?.getItem?.(kind, id) || null),
    getItemByName:   (kind, name) => (data()?.getItemByName?.(kind, name) || null),
    getRecords:      (kind) => (data()?.getRecords?.(kind) || []),
    // computation
    hydrate,
    // PERF (M2): each granular helper below (initiative/maxHp/armorClass) runs a
    // FULL hydrate() per call, so a sheet reading several of them re-derives the
    // whole pipeline N times. If this shows up in a profile, memoize on a stable
    // (decisions, data()) reference — e.g. cache the last { cd, dataRef, result }
    // and reuse it when both are identity-equal. Left un-memoized for now: the
    // pipeline is cheap and correctness/clarity beats premature caching.
    derive: {
      abilityMod:       Engine.abilityMod,
      proficiencyBonus: Engine.proficiencyBonus,
      multiclassSlots:  Engine.multiclassSlots,
      // Delegate to the full pipeline (like maxHp/armorClass) so initiative
      // reflects ability grants (DEX bumps) + the Alert feat, and reads baseStats
      // with the same precedence as hydrate (baseStats || abilities), not the
      // reverse.
      initiative:       (cd) => hydrate(cd).sheet.derived.initiative,
      maxHp:            (cd) => hydrate(cd).sheet.derived.maxHp,
      armorClass:       (cd) => hydrate(cd).sheet.derived.armorClass,
      saveDC:           (abilityScore, totalLevel) => 8 + Engine.proficiencyBonus(totalLevel) + Engine.abilityMod(abilityScore),
    },
  });

  // ── Status tab (Settings → ⚙ Rules Engine) ───────────────────────
  host.registerSettingsTab({
    id: 'status', label: t('settings.label'), icon: '⚙',
    render: () => {
      const d = data();
      const status = d
        ? t('status.connected', { count: (d.listClasses?.() || []).length })
        : t('status.disconnected');
      return `
        <div class="settings-editor-head"><h2>⚙ ${esc(t('status.title'))}</h2></div>
        <div class="settings-panel">
          <p class="settings-hint">${esc(t('status.intro'))}</p>
          <p class="settings-hint" style="color:${d ? 'var(--color-success)' : 'var(--text-muted)'}">${esc(status)}</p>
        </div>`;
    },
  });
}

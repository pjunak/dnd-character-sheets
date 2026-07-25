// ═══════════════════════════════════════════════════════════════
//  rules/api.js — the rules API surface over a data provider.
//
//  `makeRulesApi(getData)` binds the pure engine (rules/engine.js) to a live
//  content accessor (the object the dnd55e-compendium addon provide()s —
//  or any future per-book data addon with the same shape) and returns the api
//  the sheet panels consume:
//    • list*()/getItem()  — passthrough of book data for dropdowns
//    • hydrate(decisions) — decisions → computed sheet (NEVER throws; warnings[])
//    • derive.*           — granular stat helpers
//
//  `getData()` is probed live on every call (never cached), so installing or
//  removing a book addon mid-session degrades to empty lists/warnings instead
//  of throwing. model.js builds one instance of this api and entry.js also
//  provide()s it, so a future addon (combat, NPC tools) can consume the same
//  rules surface without this addon changing.
// ═══════════════════════════════════════════════════════════════

import * as Engine from './engine.js';

export function makeRulesApi(getData) {
  const data = () => { try { return getData() || null; } catch (_) { return null; } };

  // The provider's raw `ruleset` record; null when the provider is
  // absent or predates getRuleset(). hydrate() resolves it per constant over
  // the 2024 defaults, so either null keeps today's behavior exactly.
  const rawRuleset = () => { try { return data()?.getRuleset?.() || null; } catch (_) { return null; } };

  /** Decisions → computed sheet, via the pure engine + live book data. */
  const hydrate = (decisions) => Engine.hydrate(decisions, data(), rawRuleset());

  return {
    apiVersion: 1,
    // dropdown enumeration — passthrough of book data
    listClasses:     () => (data()?.listClasses?.() || []),
    listSubclasses:  (classId) => (data()?.listSubclasses?.(classId) || []),
    listFeatures:    (q) => (data()?.listFeatures?.(q) || []),
    getFeature:      (id) => (data()?.getFeature?.(id) || null),
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
    // The resolved ruleset: the provider's record merged per constant
    // over the 2024 defaults — always a full object, never null, so panels can
    // read `getRuleset().capabilities.epicBoons` without guards.
    getRuleset:      () => Engine.resolveRuleset(rawRuleset()),
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
      multiclassSlots:  (casterLevel) => Engine.multiclassSlots(casterLevel, Engine.resolveRuleset(rawRuleset())),
      // Delegate to the full pipeline (like maxHp/armorClass) so initiative
      // reflects ability grants (DEX bumps) + the Alert feat, and reads baseStats
      // with the same precedence as hydrate (baseStats || abilities), not the
      // reverse.
      initiative:       (cd) => hydrate(cd).sheet.derived.initiative,
      maxHp:            (cd) => hydrate(cd).sheet.derived.maxHp,
      armorClass:       (cd) => hydrate(cd).sheet.derived.armorClass,
      saveDC:           (abilityScore, totalLevel) => 8 + Engine.proficiencyBonus(totalLevel) + Engine.abilityMod(abilityScore),
    },
  };
}

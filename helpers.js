// ═══════════════════════════════════════════════════════════════
//  helpers.js — domain constants + pure helpers, shared by every module.
//
//  The sheet owns its presentation vocabulary and hand-fillable arithmetic.
//  Ruleset-dependent values are requested from the discovered rules-engine
//  service; this addon carries no rules implementation of its own.
//
//  No host/DOM coupling except `uid`, which uses host.store.generateId for
//  stable ids (with a safe random fallback). `makeHelpers(host)` binds that one
//  dependency; everything else is a free pure function exported directly.
// ═══════════════════════════════════════════════════════════════

// ── Domain constants (UI-side) ───────────────────────────────────
export const ABILITIES = Object.freeze(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
const SKILL_ABILITY = Object.freeze({
  acrobatics: 'DEX', animalHandling: 'WIS', arcana: 'INT', athletics: 'STR',
  deception: 'CHA', history: 'INT', insight: 'WIS', intimidation: 'CHA',
  investigation: 'INT', medicine: 'WIS', nature: 'INT', perception: 'WIS',
  performance: 'CHA', persuasion: 'CHA', religion: 'INT', sleightOfHand: 'DEX',
  stealth: 'DEX', survival: 'WIS',
});
export const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];   // ascending value — cp leftmost in the coin line
export const LOCATIONS = ['equipped', 'ready', 'pack']; // carry state (EQ-1)
// Display vocabulary for the D&D 5e sheet schema. Edition-dependent mechanics
// remain engine-owned.
export const SKILLS = Object.entries(SKILL_ABILITY).map(([id, ability]) => ({ id, ability }));

// ── Pure helpers (formatting) ────────────────────────────────────
export const signed = (n) => (n >= 0 ? '+' + n : String(n));
export const titleize = (id) => String(id || '').replace(/[-_:]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
export const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const abilityMod = score => Math.floor((num(score, 10) - 10) / 2);
export const clampHp = (value, max) => Math.max(0, Math.min(Math.max(0, num(max, 0)), num(value, 0)));

export const pointBuyFor = engine => {
  const value = engine?.getBuilderPlan?.({})?.pointBuy;
  return value && typeof value === 'object'
    ? value
    : Object.freeze({ budget: 0, min: 1, max: 30, cost: Object.freeze({}) });
};
export const pointCost = (value, engine) => num(engine?.derive?.pointBuyCost?.(value), 0);
export const pointsSpent = (scores, engine) => num(engine?.derive?.pointsSpent?.(scores), 0);
export const hitDieAvg = (die, engine) => num(engine?.derive?.hitDieAverage?.(die), 0);
export const scrollCopyCost = (level, engine) => num(engine?.derive?.scrollCopyCost?.(level), 0);
export const featAsiFrom = (value, engine) => {
  const result = engine?.derive?.featAsiFrom?.(value);
  return Array.isArray(result) ? result.slice() : [];
};
export const featAbilityCap = (feat, engine) => {
  const value = engine?.derive?.featAbilityCap?.(feat);
  return value == null ? null : num(value, null);
};

export function referenceHref(engine, kind, id, mode = 'view') {
  const reference = engine?.resolveReference?.(kind, id, mode);
  const href = typeof reference === 'string' ? reference : reference?.href;
  return typeof href === 'string' && /^#\/[A-Za-z0-9/_:.-]+$/.test(href) ? href : '';
}

// First paragraph of a markdown body, flattened for a hover legend's `desc`
// (statTip renders desc as ESCAPED plain text): drop a leading heading + emphasis
// markers, collapse whitespace, cap the length so the card stays compact. Full
// prose stays on the provider-owned detail page.
export function firstPara(md) {
  const body = String(md || '').replace(/\r/g, '').replace(/^#{1,6}\s+[^\n]*\n+/, '').trim();
  const para = (body.split(/\n\s*\n/)[0] || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return para.length > 300 ? para.slice(0, 297) + '…' : para;
}

/** Resolve a shown feature (class OR subclass) → its `feature` record, for a link +
 *  hover. Subclass features resolve within the selected subclass (by name, then local
 *  id). Class features join by (classId, level, name) with a level-agnostic and a
 *  shared-generic (ASI / Epic Boon, classId null) fallback. `cl` supplies classId for
 *  class features. null when the data provider has no feature records. (Shared by the
 *  Builder log + the read-tab Features summary.) */
export function featureRecordFor(engine, cl, level, f) {
  if (!engine || !engine.listFeatures || !engine.getFeature) return null;
  const norm = (x) => String(x || '').trim().toLowerCase();
  const name = f.name || titleize(f.id);   // class features carry the name in `id` (no `name`)
  if (f.source && f.source.type === 'subclass') {
    const subs = engine.listFeatures({ subclassId: f.source.id });
    const hit = subs.find((x) => norm(x.name) === norm(name)) || subs.find((x) => x.localId === f.id);
    return hit ? engine.getFeature(hit.id) : null;
  }
  const owned = engine.listFeatures({ classId: cl && cl.classId });
  const hit = owned.find((x) => !x.subclassId && x.level === level && norm(x.name) === norm(name))
           || owned.find((x) => !x.subclassId && norm(x.name) === norm(name))
           || engine.listFeatures().find((x) => x.classId == null && norm(x.name) === norm(name));
  return hit ? engine.getFeature(hit.id) : null;
}

/** A blank sheet — the v2 shape stored under addonData[NS]. Only player
 *  decisions are stored; in standalone (no engine) the entered numbers ARE
 *  the decisions. The future engine layers computed values + overrides over
 *  this without reshaping it. New collections (spells/inventory/currency) are
 *  ADDED over the v1 shape — v1 blobs migrate forward losslessly (just gain
 *  the empty arrays). Multiclass `classes[]` arrives with the Builder. */
export const blank = () => ({
  v: 2,
  ruleset: '',   // edition used to materialize this character; restamped on every Builder save
  rulesMode: 'auto',
  rulesProvider: null,
  player: '', className: '', subclass: '', race: '', background: '', alignment: '',
  level: 1,
  abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  maxHp: 0, hp: 0, tempHp: 0, ac: 10, initiative: 0, speed: 30, profBonus: 2,
  saveProf: {}, manualSaveProf: {}, skillProf: {},
  skillExpertise: {},  // { <skillId>: true } — materialized so standalone mode retains expertise
  spells: [],      // manual/extra + copied spell entries [{id,name,level,school,origin}] (SP-1/SP-15)
  preparedSpells: {}, // engine mode: { <classId>: [spellRef,…] } prepared picks (SP-2)
  spellbook: {},      // engine mode: { <classId>: [spellRef,…] } the Wizard's LEARNED pool — prepared draws from this subset, not the whole class list (SP-5)
  spellSwaps: [],  // engine mode: [{level, classId, out, in}] recorded level-up spell swaps (FE-4)
  cantrips: {},       // engine mode: { <classId>: [spellRef,…] } cantrip picks (SP-7)
  grantChoices: {},   // engine mode: { '<src>:<id>:<grantId>': [spellRef,…] } resolved choose-grants (SP-10)
  grantCastingAbilities: {},
  inventory: [],   // [{id, name, qty, location, notes}]
  resources: [],   // [{id, name, current, max}] manual play trackers (standalone / homebrew)
  resourceUses: {}, // engine mode: { <resourceKey>: current } — spend state for build-derived trackers; max/name/recharge come from the engine
  activeFeatures: {}, // { '<sourceType>:<sourceId>:<activationId>': true } for eligible self-effect modes
  traitSnapshot: { languages: [], senses: {}, resistances: [], damageImmunities: [], conditionImmunities: [], armor: [], weapons: [], tools: [] },
  currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
  overrides: {},   // engine-mode manual overrides
  // ── Builder decision model (engine mode). The flat fields above are kept as
  //    the durable fallback: each Builder edit materializes the computed sheet
  //    INTO them, so removing the engine degrades to a hand-filled sheet. ──
  baseStats: null,        // {STR..CHA} base scores before ASIs; null → migrate from `abilities`
  manualScores: false,    // Builder: false → point buy (27 pts, 8–15); true → free manual entry
  classes: [],            // ordered [{classId, level, subclass}] (MC-1)
  lineage: '',            // species sub-choice id (SB-3)
  abilityGrants: [],      // [{id, source, assign:{STR:+2,…}}] background ASI / half-feats (AB-1)
  featureChoices: {},     // { <choiceId>: <value> } generic choice resolutions
  feats: [],              // [{featId, source}] chosen feats
  extraFeats: [],         // level-independent custom-source feats; compendium refs feed the engine
  notes: '',
});

/**
 * Bind the host-dependent helpers (just `uid` + `sheetOf`, which needs NS).
 * Returns `{ uid, sheetOf }`. `uid(seed)` makes a stable id via
 * host.store.generateId, falling back to a random suffix if that throws.
 */
export function makeHelpers(host) {
  const NS = host.id;

  const uid = (seed) => {
    try { return host.store.generateId(seed || 'row'); }
    catch (_) { return String(seed || 'row') + '_' + Math.random().toString(36).slice(2, 8); }
  };

  /** Read this addon's namespace off a character, merged over defaults so every
   *  field/sub-object is present (renderers/collect/actions never hit undefined).
   *  Acts as the forward migration: missing collections become empty. */
  const sheetOf = (c) => {
    const s = (c && c.addonData && c.addonData[NS]) || {};
    const b = blank();
    return {
      ...b, ...s,
      abilities: { ...b.abilities, ...(s.abilities || {}) },
      saveProf:  { ...(s.saveProf || {}) },
      manualSaveProf: {
        ...(Object.prototype.hasOwnProperty.call(s, 'manualSaveProf')
          ? (s.manualSaveProf || {})
          : (s.rulesProvider && s.rulesProvider.materialized ? {} : (s.saveProf || {}))),
      },
      skillProf: { ...(s.skillProf || {}) },
      skillExpertise: { ...(s.skillExpertise || {}) },
      currency:  { ...b.currency, ...(s.currency || {}) },
      overrides: { ...(s.overrides || {}) },
      rulesMode: s.rulesMode === 'manual' ? 'manual' : 'auto',
      rulesProvider: s.rulesProvider && typeof s.rulesProvider === 'object'
        ? {
          identity: s.rulesProvider.identity && typeof s.rulesProvider.identity === 'object'
            ? JSON.parse(JSON.stringify(s.rulesProvider.identity))
            : null,
          edition: String(s.rulesProvider.edition || ''),
          materialized: s.rulesProvider.materialized
            && typeof s.rulesProvider.materialized === 'object'
            ? JSON.parse(JSON.stringify(s.rulesProvider.materialized))
            : null,
        }
        : null,
      spells:    Array.isArray(s.spells) ? s.spells : [],
      preparedSpells: { ...(s.preparedSpells || {}) },
      spellbook: { ...(s.spellbook || {}) },
      spellSwaps: Array.isArray(s.spellSwaps) ? s.spellSwaps : [],
      cantrips:  { ...(s.cantrips || {}) },
      grantChoices: { ...(s.grantChoices || {}) },
      grantCastingAbilities: { ...(s.grantCastingAbilities || {}) },
      inventory: Array.isArray(s.inventory) ? s.inventory : [],
      resources: Array.isArray(s.resources) ? s.resources : [],
      resourceUses: { ...(s.resourceUses || {}) },
      activeFeatures: { ...(s.activeFeatures || {}) },
      traitSnapshot: {
        ...b.traitSnapshot,
        ...(s.traitSnapshot || {}),
        languages: Array.isArray(s.traitSnapshot && s.traitSnapshot.languages) ? s.traitSnapshot.languages : [],
        senses: { ...((s.traitSnapshot && s.traitSnapshot.senses) || {}) },
        resistances: Array.isArray(s.traitSnapshot && s.traitSnapshot.resistances) ? s.traitSnapshot.resistances : [],
        damageImmunities: Array.isArray(s.traitSnapshot && s.traitSnapshot.damageImmunities) ? s.traitSnapshot.damageImmunities : [],
        conditionImmunities: Array.isArray(s.traitSnapshot && s.traitSnapshot.conditionImmunities) ? s.traitSnapshot.conditionImmunities : [],
        armor: Array.isArray(s.traitSnapshot && s.traitSnapshot.armor) ? s.traitSnapshot.armor : [],
        weapons: Array.isArray(s.traitSnapshot && s.traitSnapshot.weapons) ? s.traitSnapshot.weapons : [],
        tools: Array.isArray(s.traitSnapshot && s.traitSnapshot.tools) ? s.traitSnapshot.tools : [],
      },
      baseStats: s.baseStats || null,
      classes:   Array.isArray(s.classes) ? s.classes : [],
      abilityGrants: Array.isArray(s.abilityGrants) ? s.abilityGrants : [],
      featureChoices: { ...(s.featureChoices || {}) },
      feats:     Array.isArray(s.feats) ? s.feats : [],
      extraFeats: Array.isArray(s.extraFeats) ? s.extraFeats : [],
    };
  };

  return { uid, sheetOf };
}

// ═══════════════════════════════════════════════════════════════
//  helpers.js — domain constants + pure helpers, shared by every module.
//
//  RULES facts (ability list, skill→ability map, point buy, HP clamp, the mod
//  math) live in rules/engine.js — the single source of D&D system knowledge —
//  and are re-exported here so panels keep one import site (ctx). This file
//  adds only UI-side constants + formatting.
//
//  No host/DOM coupling except `uid`, which uses host.store.generateId for
//  stable ids (with a safe random fallback). `makeHelpers(host)` binds that one
//  dependency; everything else is a free pure function exported directly.
// ═══════════════════════════════════════════════════════════════

import { ABILITIES, SKILL_ABILITY, num, abilityMod, POINT_BUY, pointCost, pointsSpent, clampHp } from './rules/engine.js';
export { ABILITIES, num, abilityMod, POINT_BUY, pointCost, pointsSpent, clampHp };

// ── Domain constants (UI-side) ───────────────────────────────────
export const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'];
export const LOCATIONS = ['equipped', 'ready', 'pack']; // carry state (EQ-1)
// Display-friendly skill list, derived from the engine's skill→ability map so
// the two encodings can never drift (D&D 2024).
export const SKILLS = Object.entries(SKILL_ABILITY).map(([id, ability]) => ({ id, ability }));

// ── Pure helpers (formatting) ────────────────────────────────────
export const signed = (n) => (n >= 0 ? '+' + n : String(n));
export const titleize = (id) => String(id || '').replace(/[-_:]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());

// Href into the Player's Handbook compendium (the handbook addon owns the
// `/compendium` route; addon routes are global hash routes, so a plain anchor
// reaches it). Callers gate on a resolved record id — without the book the name
// stays plain text (no dead link).
export const compendiumHref = (kind, id) => `#/compendium/${kind}:${id}`;

// First paragraph of a markdown body, flattened for a hover legend's `desc`
// (statTip renders desc as ESCAPED plain text): drop a leading heading + emphasis
// markers, collapse whitespace, cap the length so the card stays compact. Full
// prose stays on the compendium detail page.
export function firstPara(md) {
  const body = String(md || '').replace(/\r/g, '').replace(/^#{1,6}\s+[^\n]*\n+/, '').trim();
  const para = (body.split(/\n\s*\n/)[0] || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return para.length > 300 ? para.slice(0, 297) + '…' : para;
}

/** A blank sheet — the v2 shape stored under addonData[NS]. Only player
 *  decisions are stored; in standalone (no engine) the entered numbers ARE
 *  the decisions. The future engine layers computed values + overrides over
 *  this without reshaping it. New collections (spells/inventory/currency) are
 *  ADDED over the v1 shape — v1 blobs migrate forward losslessly (just gain
 *  the empty arrays). Multiclass `classes[]` arrives with the Builder. */
export const blank = () => ({
  v: 2,
  ruleset: '2024',
  player: '', className: '', subclass: '', race: '', background: '', alignment: '',
  level: 1,
  abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  maxHp: 0, hp: 0, tempHp: 0, ac: 10, initiative: 0, speed: 30, profBonus: 2,
  saveProf: {}, skillProf: {},
  spells: [],      // manual/extra + copied spell entries [{id,name,level,school,origin}] (SP-1/SP-15)
  preparedSpells: {}, // engine mode: { <classId>: [spellRef,…] } prepared picks (SP-2)
  cantrips: {},       // engine mode: { <classId>: [spellRef,…] } cantrip picks (SP-7)
  grantChoices: {},   // engine mode: { '<src>:<id>:<grantId>': [spellRef,…] } resolved choose-grants (SP-10)
  inventory: [],   // [{id, name, qty, location, notes}]
  resources: [],   // [{id, name, current, max}] manual play trackers (standalone / homebrew)
  resourceUses: {}, // engine mode: { <resourceKey>: current } — spend state for build-derived trackers; max/name/recharge come from the engine
  currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
  overrides: {},   // engine-mode manual overrides (ARCH-3)
  // ── Builder decision model (engine mode). The flat fields above are kept as
  //    the DEG-1 fallback: each Builder edit materializes the computed sheet
  //    INTO them, so removing the engine degrades to a hand-filled sheet. ──
  baseStats: null,        // {STR..CHA} base scores before ASIs; null → migrate from `abilities`
  manualScores: false,    // Builder: false → point buy (27 pts, 8–15); true → free manual entry
  classes: [],            // ordered [{classId, level, subclass}] (MC-1)
  lineage: '',            // species sub-choice id (SB-3)
  abilityGrants: [],      // [{id, source, assign:{STR:+2,…}}] background ASI / half-feats (AB-1)
  featureChoices: {},     // { <choiceId>: <value> } generic choice resolutions (ARCH-9/FE-1)
  feats: [],              // [{featId, source}] chosen feats
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
      skillProf: { ...(s.skillProf || {}) },
      currency:  { ...b.currency, ...(s.currency || {}) },
      overrides: { ...(s.overrides || {}) },
      spells:    Array.isArray(s.spells) ? s.spells : [],
      preparedSpells: { ...(s.preparedSpells || {}) },
      cantrips:  { ...(s.cantrips || {}) },
      grantChoices: { ...(s.grantChoices || {}) },
      inventory: Array.isArray(s.inventory) ? s.inventory : [],
      resources: Array.isArray(s.resources) ? s.resources : [],
      resourceUses: { ...(s.resourceUses || {}) },
      baseStats: s.baseStats || null,
      classes:   Array.isArray(s.classes) ? s.classes : [],
      abilityGrants: Array.isArray(s.abilityGrants) ? s.abilityGrants : [],
      featureChoices: { ...(s.featureChoices || {}) },
      feats:     Array.isArray(s.feats) ? s.feats : [],
    };
  };

  return { uid, sheetOf };
}

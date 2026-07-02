// ═══════════════════════════════════════════════════════════════
//  engine.js — the pure D&D 5.5e (2024) derivation engine.
//
//  No host, no DOM: every function takes plain decisions + a compendium data
//  accessor `api` (the object dnd55e-compendium provides), so it's unit-testable
//  in isolation (tests/smoke.mjs drives it with a fake api). entry.js wires
//  `hydrate(cd) = hydrate(cd, host.use('dnd55e-compendium'))`.
//
//  It encodes the SYSTEM (how PB / mods / HP / AC / saves / slots are computed)
//  and reads CONTENT (class/species/armor records) from `api` — so new content
//  is a compendium change and never touches this file. Each pipeline step is
//  error-isolated: a throw becomes a warning and the sheet is still returned
//  (mirrors Living-scroll's accumulate-don't-throw contract). See
//  ../dnd55e-sheets/docs/RULES_EDGE_CASES.md for the rule IDs referenced below.
// ═══════════════════════════════════════════════════════════════

export const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

// EQ-3: a character can attune to at most 3 magic items at once (2024 PHB).
const ATTUNE_LIMIT = 3;

// Skill → governing ability. SYSTEM knowledge (not content), so it lives here
// and the engine never needs the compendium just to total a skill.
export const SKILL_ABILITY = {
  acrobatics: 'DEX', animalHandling: 'WIS', arcana: 'INT', athletics: 'STR',
  deception: 'CHA', history: 'INT', insight: 'WIS', intimidation: 'CHA',
  investigation: 'INT', medicine: 'WIS', nature: 'INT', perception: 'WIS',
  performance: 'CHA', persuasion: 'CHA', religion: 'INT', sleightOfHand: 'DEX',
  stealth: 'DEX', survival: 'WIS',
};

export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const abilityMod = (score) => Math.floor((num(score, 10) - 10) / 2);
export const proficiencyBonus = (totalLevel) => 2 + Math.floor((Math.max(1, num(totalLevel, 1)) - 1) / 4);
export const dieSize = (hitDie) => num(String(hitDie || '').replace(/^d/i, ''), 8);

// Standard multiclass spell-slot table, indexed by combined CASTER LEVEL
// (MC-2). slots[i] = number of (i+1)-th-level slots. Single full casters land on
// their own table row; this also covers multiclass + half/third casters.
const MULTICLASS_SLOTS = {
  1: [2], 2: [3], 3: [4, 2], 4: [4, 3], 5: [4, 3, 2], 6: [4, 3, 3], 7: [4, 3, 3, 1],
  8: [4, 3, 3, 2], 9: [4, 3, 3, 3, 1], 10: [4, 3, 3, 3, 2], 11: [4, 3, 3, 3, 2, 1],
  12: [4, 3, 3, 3, 2, 1], 13: [4, 3, 3, 3, 2, 1, 1], 14: [4, 3, 3, 3, 2, 1, 1],
  15: [4, 3, 3, 3, 2, 1, 1, 1], 16: [4, 3, 3, 3, 2, 1, 1, 1], 17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1], 19: [4, 3, 3, 3, 3, 2, 1, 1, 1], 20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};
export const multiclassSlots = (casterLevel) => (MULTICLASS_SLOTS[Math.max(0, Math.min(20, num(casterLevel, 0)))] || []).slice();

/** A class's contribution to the combined caster level (MC-2): full = level,
 *  half (Paladin/Ranger) = ⌊level/2⌋, third (EK/AT subclass) = ⌊level/3⌋. Rounded
 *  DOWN so a half-caster level 1 contributes 0 (no spells until level 2). */
function casterContribution(type, level) {
  if (type === 'full') return level;
  if (type === 'half') return Math.floor(level / 2);
  if (type === 'third') return Math.floor(level / 3);
  return 0;
}

/** Pick the progression row at `level` (or the highest row ≤ level — handles the
 *  abbreviated seed tables that stop at ~level 5). */
function progressionAt(progression, level) {
  if (!Array.isArray(progression) || !progression.length) return null;
  let best = null;
  for (const row of progression) if (num(row.level) <= level && (!best || row.level > best.level)) best = row;
  return best || progression[0];
}

/** Normalize decisions into an ordered class list with resolved records.
 *  Accepts the rich `classes:[{classId,level,subclass}]` shape OR the current
 *  flat `{className, subclass, level}` sheet shape (MC-1 migration not done yet). */
export function resolveClasses(cd, api, warn) {
  const out = [];
  const lookup = (idOrName) => {
    if (!api) return null;
    return (api.getItem && api.getItem('class', idOrName)) || (api.getItemByName && api.getItemByName('class', idOrName)) || null;
  };
  if (Array.isArray(cd.classes) && cd.classes.length) {
    for (const c of cd.classes) {
      const rec = lookup(c.classId);
      if (!rec && api && c.classId) warn('Unknown class: ' + c.classId);
      out.push({ classId: c.classId, name: rec ? rec.name : c.classId, level: Math.max(1, num(c.level, 1)), subclass: c.subclass || '', record: rec });
    }
  } else if (cd.className) {
    const rec = lookup(cd.className);
    if (!rec && api) warn('Unknown class: ' + cd.className);
    out.push({ classId: rec ? rec.id : cd.className, name: rec ? rec.name : cd.className, level: Math.max(1, num(cd.level, 1)), subclass: cd.subclass || '', record: rec });
  }
  return out;
}

// ── derived computations (each pure, given resolved inputs) ─────────

/** HP-1: the character's first level gets the MAX of its hit die; every other
 *  level = average (round up) of that level's class die; + CON×totalLevel +
 *  per-level species bonuses (e.g. Dwarven Toughness, HP-3). The max die is
 *  awarded to the first level iterated — for the common single-class case that is
 *  simply the class's die; multiclass entry order beyond the first doesn't change
 *  the total, so no "origin class" is tracked. */
export function computeMaxHp(classes, conMod, hpPerLevel) {
  let hp = 0, charLevel = 0, maxDieAwarded = false;
  for (const c of classes) {
    const die = dieSize(c.record && c.record.hitDie);
    for (let i = 0; i < c.level; i++) {
      charLevel++;
      // Max hit die for the very first character level; average thereafter.
      if (!maxDieAwarded) { hp += die; maxDieAwarded = true; }
      else hp += Math.floor(die / 2) + 1;
    }
  }
  if (!charLevel) return 0;
  return hp + conMod * charLevel + num(hpPerLevel) * charLevel;
}

/** AC-1/AC-2/AC-3: collect every eligible base-AC formula (equipped armor with
 *  its dex cap, else each class Unarmored-Defense formula, else 10+DEX), take the
 *  BEST, then add a shield + any flat bonuses. Never stacks two bases. */
export function computeArmorClass(cd, mods, classes, api) {
  const dex = mods.DEX;
  const inv = Array.isArray(cd.inventory) ? cd.inventory : [];
  const armorRec = (it) => {
    if (!api) return null;
    return (it.ref && api.getItem && api.getItem('armor', it.ref)) || (it.name && api.getItemByName && api.getItemByName('armor', it.name)) || null;
  };
  let bodyArmor = null, shield = null;
  for (const it of inv) {
    if ((it.location || '') !== 'equipped') continue;
    const rec = armorRec(it);
    if (!rec) continue;
    if (rec.armorType === 'shield') shield = shield || rec;
    else if (['light', 'medium', 'heavy'].includes(rec.armorType)) bodyArmor = bodyArmor || rec;
  }
  const candidates = [];
  if (bodyArmor) {
    const dexPart = bodyArmor.dexCap === 0 ? 0 : bodyArmor.dexCap == null ? dex : Math.min(dex, num(bodyArmor.dexCap));
    candidates.push({ id: 'armor:' + bodyArmor.id, label: bodyArmor.name, value: num(bodyArmor.baseAC, 10) + dexPart });
  } else {
    for (const c of classes) {
      for (const f of (c.record && c.record.acFormulas) || []) {
        if (f.requires && f.requires.noShield && shield) continue;
        const add = (f.addAbilities || []).reduce((s, ab) => s + num(mods[ab]), 0);
        candidates.push({ id: f.id, label: f.id, value: num(f.base, 10) + add });
      }
    }
  }
  // ALWAYS offer the unarmored 10+DEX candidate so the reducer floors there: a
  // malformed body-armor record (e.g. a negative/garbage baseAC) can never drop
  // AC below the bare-minimum 10+DEX every creature has.
  candidates.push({ id: 'unarmored', label: 'Unarmored', value: 10 + dex });
  const best = candidates.reduce((a, b) => (b.value > a.value ? b : a), { value: -Infinity, label: '', id: '' });
  const shieldBonus = shield ? num(shield.acBonus, 2) : 0;
  return { value: best.value + shieldBonus, base: best.label, shield: shieldBonus, candidates };
}

// EQ-5: which ability a weapon uses — finesse takes the better of STR/DEX,
// ranged uses DEX, everything else STR.
export function weaponAbilityMod(rec, mods) {
  const str = num(mods.STR), dex = num(mods.DEX);
  const props = rec.properties || [];
  if (props.includes('finesse')) return Math.max(str, dex);
  if (rec.range === 'ranged') return dex;
  return str;
}

/** Union of class weapon proficiencies (PR-5). Tokens: 'simple', 'martial',
 *  'martial-finesse-or-light' (the 2024 Rogue subset). */
export function classWeaponProf(classes) {
  const p = { simple: false, martial: false, martialFinesseLight: false };
  for (const c of classes) {
    for (const tok of ((c.record && c.record.startingProficiencies && c.record.startingProficiencies.weapons) || [])) {
      if (tok === 'simple') p.simple = true;
      else if (tok === 'martial') p.martial = true;
      else if (tok === 'martial-finesse-or-light') { p.simple = true; p.martialFinesseLight = true; }
    }
  }
  return p;
}
function weaponProficient(rec, p) {
  if (rec.category === 'simple') return !!p.simple;
  if (rec.category === 'martial') {
    if (p.martial) return true;
    if (p.martialFinesseLight && ((rec.properties || []).includes('finesse') || (rec.properties || []).includes('light'))) return true;
  }
  return false;
}

/** EQ-5: attack bonus + damage for one weapon. attack = abilityMod +
 *  (proficient ? PB : 0); damage adds the ability modifier. Magic +N is 0 for
 *  now (no magic weapons in the seed). */
export function computeWeaponAttack(rec, mods, pb, profW, masterySet) {
  const abil = weaponAbilityMod(rec, mods);
  const prof = weaponProficient(rec, profW);
  const dmgSuffix = abil ? ' ' + (abil > 0 ? '+' : '') + abil : '';
  return {
    ref: rec.id, name: rec.name,
    attackBonus: abil + (prof ? pb : 0),
    damage: (rec.damage || '') + dmgSuffix,
    versatileDamage: rec.versatileDamage ? rec.versatileDamage + dmgSuffix : null,
    damageType: rec.damageType || '', properties: rec.properties || [],
    mastery: rec.mastery || '', masteryActive: !!(masterySet && masterySet.has(rec.id)),
    proficient: prof,
  };
}

// ── the pipeline ───────────────────────────────────────────────────

/**
 * Hydrate player DECISIONS into a computed sheet. NEVER throws — every step is
 * error-isolated and failures accumulate in `warnings`. Returns { sheet, warnings }.
 * The engine only PROPOSES; the sheet layer lets a stored override win (ARCH-3).
 */
export function hydrate(decisions, api) {
  const cd = decisions || {};
  const warnings = [];
  const warn = (m) => { if (m) warnings.push(String(m)); };
  const step = (fn) => { try { fn(); } catch (e) { warn('engine: ' + (e && e.message || e)); } };

  const sheet = { abilities: {}, derived: {}, proficiencies: { saves: {}, skills: {}, armor: [], weapons: [], tools: [] }, features: [] };
  const mods = {};

  // Abilities (AB-1/AB-2): final = base + Σ ability grants (background ASI,
  // half-feats, …), clamped to 20. `baseStats` is preferred; `abilities` is the
  // back-compat fallback (the flat sheet stores final scores directly). Each
  // grant is { source, assign: { STR:+2, … } }. Shape: abilities[a] =
  // {base, score, mod, bonus}.
  step(() => {
    const base = cd.baseStats || cd.abilities || {};
    const grants = Array.isArray(cd.abilityGrants) ? cd.abilityGrants : [];
    for (const a of ABILITIES) {
      let bonus = 0;
      for (const g of grants) { const v = g && g.assign && g.assign[a]; if (v) bonus += num(v); }
      const score = Math.min(20, num(base[a], 10) + bonus);   // cap 20 (cap-raisers AB-4 later)
      const m = abilityMod(score);
      mods[a] = m;
      sheet.abilities[a] = { base: num(base[a], 10), score, mod: m, bonus };
    }
  });

  // Classes + total level + proficiency bonus (PB from TOTAL level — PR-6).
  let classes = [];
  let totalLevel = 1;
  step(() => {
    classes = resolveClasses(cd, api, warn);
    totalLevel = classes.length ? classes.reduce((s, c) => s + c.level, 0) : Math.max(1, num(cd.level, 1));
    sheet.classes = classes.map((c) => ({ classId: c.classId, name: c.name, level: c.level, subclass: c.subclass, hitDie: c.record && c.record.hitDie }));
    sheet.totalLevel = totalLevel;
    sheet.derived.proficiencyBonus = proficiencyBonus(totalLevel);
    if (classes[0] && classes[0].record) sheet.class = classes[0].record;     // back-compat
    sheet.derived.hitDie = (classes[0] && classes[0].record && classes[0].record.hitDie) || null;
  });
  const pb = sheet.derived.proficiencyBonus;

  // Species (speed, senses take-highest, resistances, per-level HP bonus — SB-3/SB-4).
  let species = null, hpPerLevel = 0, lineage = null;
  step(() => {
    if (cd.race || cd.species) {
      species = (api && (api.getItemByName && api.getItemByName('species', cd.race || cd.species))) || null;
      if (!species && api) warn('Unknown species: ' + (cd.race || cd.species));
    }
    sheet.species = species || undefined;
    lineage = species && cd.lineage ? (species.lineages || []).find((l) => l.id === cd.lineage) : null;
    let darkvision = 0, speedBonus = 0;
    const resistances = new Set();
    if (species) {
      if (species.senses && species.senses.darkvision) darkvision = Math.max(darkvision, num(species.senses.darkvision));
      for (const r of species.resistances || []) resistances.add(r);
      if (species.grants && species.grants.hpPerLevel) hpPerLevel += num(species.grants.hpPerLevel);
    }
    // Selected lineage grants (SB-3): darkvision take-highest, speed bonus,
    // resistances, per-level HP (Dwarven Toughness). Lineage SPELLS are granted
    // in the spellcasting step (level-gated + provenance-tagged).
    const lg = lineage && lineage.grants;
    if (lg) {
      if (lg.senses && lg.senses.darkvision) darkvision = Math.max(darkvision, num(lg.senses.darkvision));
      for (const r of lg.resistances || []) resistances.add(r);
      if (lg.hpPerLevel) hpPerLevel += num(lg.hpPerLevel);
      if (lg.speedBonus) speedBonus += num(lg.speedBonus);
    }
    sheet.speed = (species && species.speeds && species.speeds.walk ? num(species.speeds.walk) : 30) + speedBonus;
    sheet.derived.speed = sheet.speed;
    sheet.senses = darkvision ? { darkvision } : {};
    sheet.resistances = [...resistances];
  });

  // Background (skill proficiencies it grants — AB-1's ability split needs the
  // Builder's choice, so only the deterministic grants are applied here).
  let background = null;
  step(() => {
    if (cd.background) {
      background = (api && api.getItemByName && api.getItemByName('background', cd.background)) || null;
      if (!background && api) warn('Unknown background: ' + cd.background);
    }
  });

  // HP (HP-1/HP-2/HP-3) — per-level bonuses from species/lineage plus feats
  // (Tough = +2/level; the data carries grants.hpPerLevel).
  step(() => {
    let featHp = 0;
    for (const f of Array.isArray(cd.feats) ? cd.feats : []) {
      const fid = f && (f.featId || f.id || f);
      const frec = fid && api && api.getItem ? api.getItem('feat', fid) : null;
      if (frec && frec.grants && frec.grants.hpPerLevel) featHp += num(frec.grants.hpPerLevel);
    }
    const conMod = mods.CON || 0;
    const perLevelMisc = hpPerLevel + featHp;   // species + lineage + feats, per level
    const maxHp = computeMaxHp(classes, conMod, perLevelMisc);
    // Breakdown for the sheet's HP legend (mirrors computeMaxHp's HP-1 rule): the
    // raw hit-dice subtotal (first level max die, others average), CON×level, and
    // the per-level misc bonuses. dice + conTotal + miscTotal === maxHp.
    let dice = 0, charLevel = 0, maxDieAwarded = false;
    for (const c of classes) {
      const die = dieSize(c.record && c.record.hitDie);
      for (let i = 0; i < c.level; i++) { charLevel++; if (!maxDieAwarded) { dice += die; maxDieAwarded = true; } else dice += Math.floor(die / 2) + 1; }
    }
    sheet.hp = { max: maxHp, breakdown: { dice, conMod, conTotal: conMod * charLevel, miscPerLevel: perLevelMisc, miscTotal: perLevelMisc * charLevel, level: charLevel } };
    sheet.derived.maxHp = maxHp;
  });

  // AC (AC-1).
  step(() => {
    const ac = computeArmorClass(cd, mods, classes, api);
    sheet.ac = ac;
    sheet.derived.armorClass = ac.value;
  });

  // Initiative (CX-2: DEX + Alert's PB in 2024).
  step(() => {
    let init = num(mods.DEX);
    const feats = Array.isArray(cd.feats) ? cd.feats.map((f) => (f && (f.featId || f.id || f))) : [];
    if (feats.includes('alert')) init += pb;
    sheet.derived.initiative = init;
  });

  // Saving throws (PR-4: proficiency only from the FIRST class; union with any
  // manual saveProf the sheet carries).
  step(() => {
    const firstSaves = (classes[0] && classes[0].record && classes[0].record.savingThrows) || [];
    const manual = cd.saveProf || {};
    sheet.saves = {};
    for (const a of ABILITIES) {
      const proficient = firstSaves.includes(a) || !!manual[a];
      sheet.proficiencies.saves[a] = proficient;
      sheet.saves[a] = { mod: num(mods[a]), proficient, total: num(mods[a]) + (proficient ? pb : 0) };
    }
  });

  // Skills (PR-1/PR-2): proficiency = resolved choices (class skill picks, via
  // `skillProficiencies[]`) ∪ background grants; standalone falls back to the
  // manual `skillProf{}` map. Expertise from `skillExpertise{}` (the Builder's
  // expertise picks), and only counts where the character is proficient.
  step(() => {
    const manual = cd.skillProf || {};
    const resolved = Array.isArray(cd.skillProficiencies)
      ? cd.skillProficiencies
      : Object.keys(manual).filter((k) => manual[k]);
    const bgSkills = (background && background.skillProficiencies) || [];
    const expertise = cd.skillExpertise || {};
    sheet.skills = {};
    for (const id of Object.keys(SKILL_ABILITY)) {
      const ab = SKILL_ABILITY[id];
      const proficient = resolved.includes(id) || bgSkills.includes(id);
      const exp = !!expertise[id] && proficient;
      sheet.proficiencies.skills[id] = exp ? 'expertise' : proficient ? 'proficient' : 'none';
      const bonus = (exp ? 2 : proficient ? 1 : 0) * pb;
      sheet.skills[id] = { ability: ab, mod: num(mods[ab]), proficient, expertise: exp, total: num(mods[ab]) + bonus };
    }
    sheet.passives = { perception: 10 + sheet.skills.perception.total };
    sheet.derived.passivePerception = sheet.passives.perception;
  });

  // Spellcasting (MC-2/MC-3/SP-2/SP-4): per-class prepared limit + DC/attack,
  // plus the combined multiclass slot pool.
  step(() => {
    const per = [];
    const casters = [];
    for (const c of classes) {
      const sc = c.record && c.record.spellcasting;
      // a third-caster subclass (e.g. Eldritch Knight) carries spellcasting on the SUBCLASS
      const subRec = c.subclass && api && api.getItem ? api.getItem('subclass', c.subclass) : null;
      const eff = sc || (subRec && subRec.spellcasting) || null;
      if (!eff) continue;
      const ability = eff.ability;
      const mod = num(mods[ability]);
      const prog = progressionAt((subRec && subRec.progression) || (c.record && c.record.progression), c.level);
      // Stash the resolved progression row on the caster so the single-class slot
      // path can read its authoritative per-level `spellSlots` directly.
      casters.push({ type: eff.type, level: c.level, prog });
      per.push({
        classId: c.classId, ability, type: eff.type, prepares: eff.prepares || 'list', ritual: !!eff.ritual,
        saveDC: 8 + pb + mod, spellAttack: pb + mod,
        preparedLimit: prog ? num(prog.preparedSpells, 0) : 0,
        cantripsKnown: prog ? num(prog.cantripsKnown, 0) : 0,
      });
    }

    // Slot pool (MC-2/MC-3). Two distinct rules:
    //  • SINGLE caster class → use the class's OWN printed per-level slot
    //    progression (`prog.spellSlots`) verbatim when the content provides it.
    //    The combined-caster-level heuristic diverges from the printed
    //    single-class table at high levels (e.g. Paladin L19 real = [4,3,3,1] but
    //    the heuristic gives [4,3,3,3,2]), so the authoritative table wins. When
    //    the (abbreviated/seed) content lacks `spellSlots`, fall back to the
    //    caster-level heuristic: ceil(level / fraction) rounded UP, so a 2024 L1
    //    half-caster (Paladin/Ranger gain Spellcasting at L1) still has slots and
    //    odd levels aren't undercounted. (Full casters: ceil(level/1) == level.)
    //  • MULTIPLE caster classes → the round-DOWN combined-caster-level rule
    //    (multiclassing is intentionally stingier) indexed into MULTICLASS_SLOTS.
    const slotDivisor = (t) => (t === 'full' ? 1 : t === 'half' ? 2 : t === 'third' ? 3 : 0);
    let combinedCasterLevel;
    let slots = null;        // set directly when the single class table is used
    if (casters.length === 1) {
      const only = casters[0];
      const ownSlots = only.prog && Array.isArray(only.prog.spellSlots) ? only.prog.spellSlots : null;
      const d = slotDivisor(only.type);
      // casterLevel reported for the UI/derive: the class's effective caster level.
      combinedCasterLevel = d ? Math.ceil(only.level / d) : 0;
      if (ownSlots) slots = ownSlots.slice();
    } else {
      combinedCasterLevel = casters.reduce((s, c) => s + casterContribution(c.type, c.level), 0);
    }
    if (!slots) slots = multiclassSlots(combinedCasterLevel);

    // Granted spells (SP-1/SP-2/SP-12): subclass always-prepared + feat grants +
    // species lineage. Each is provenance-tagged so the sheet can separate them
    // from the player's own picks and flag forced duplicates (SP-3). Names are
    // resolved from the compendium (falls back to the ref when names-only).
    const granted = [];
    const pendingChoices = [];
    const grantChoices = (cd && cd.grantChoices) || {};
    const addGrant = (ref, source, opts) => {
      if (!ref) return;
      const rec = api && api.getItem ? api.getItem('spell', ref) : null;
      granted.push({
        ref, name: rec ? rec.name : ref, level: rec ? num(rec.level) : null, school: rec ? rec.school : '',
        source, alwaysPrepared: !!(opts && opts.alwaysPrepared), free: (opts && opts.free) || null,
      });
    };
    // One grant entry: either FIXED (`ids`) or a CHOICE (`choose` + `from`). A
    // choice resolves the player's picks from cd.grantChoices[key] and exposes
    // the (possibly under-filled) choice on the sheet so the UI can render a
    // filtered picker (SP-10/SP-20 — Magic Initiate, Fey Touched's choose-1,
    // High Elf's wizard cantrip). `unlocked` gates by the source's level.
    const addGrantEntry = (sp, source, unlocked) => {
      if (!unlocked) return;
      if (Array.isArray(sp.ids) && sp.ids.length) {
        for (const ref of sp.ids) addGrant(ref, source, { alwaysPrepared: sp.alwaysPrepared, free: sp.free });
      } else if (num(sp.choose) > 0 && sp.id) {
        const key = source.type + ':' + source.id + ':' + sp.id;
        const picked = Array.isArray(grantChoices[key]) ? grantChoices[key].slice(0, num(sp.choose)) : [];
        for (const ref of picked) addGrant(ref, source, { alwaysPrepared: sp.alwaysPrepared, free: sp.free });
        pendingChoices.push({ key, source, choose: num(sp.choose), spellLevel: num(sp.spellLevel), from: sp.from || {}, alwaysPrepared: !!sp.alwaysPrepared, picked: picked.slice() });
      }
    };
    const unlockLevel = (sp) => num(sp.atLevel != null ? sp.atLevel : sp.level);
    for (const c of classes) {
      const subRec = c.subclass && api && api.getItem ? api.getItem('subclass', c.subclass) : null;
      for (const sp of (subRec && subRec.spells) || []) addGrantEntry(sp, { type: 'subclass', id: c.subclass }, unlockLevel(sp) <= c.level);
    }
    for (const f of Array.isArray(cd.feats) ? cd.feats : []) {
      const fid = f && (f.featId || f.id || f);
      const frec = fid && api && api.getItem ? api.getItem('feat', fid) : null;
      for (const sp of (frec && frec.grants && frec.grants.spells) || []) addGrantEntry(sp, { type: 'feat', id: fid }, true);
    }
    if (lineage && lineage.grants && lineage.grants.spells) {
      for (const sp of lineage.grants.spells) addGrantEntry(sp, { type: 'species', id: species.id }, unlockLevel(sp) <= totalLevel);
    }

    sheet.spellcasting = {
      perClass: per,
      casterLevel: combinedCasterLevel,
      slots,
      granted,
      pendingChoices,
    };
  });

  // Weapon Mastery slots (EQ-4): the best class count + Weapon Master feat.
  step(() => {
    let count = 0;
    for (const c of classes) count = Math.max(count, num(c.record && c.record.weaponMastery && c.record.weaponMastery.count));
    const feats = Array.isArray(cd.feats) ? cd.feats.map((f) => (f && (f.featId || f.id || f))) : [];
    if (feats.includes('weapon-master')) count += 1;
    sheet.weaponMastery = { slots: count, chosen: Array.isArray(cd.weaponMasteryChoices) ? cd.weaponMasteryChoices.slice() : [] };
  });

  // Weapons (EQ-5) + attunement (EQ-3): attack + damage for each equipped/ready
  // weapon (resolved from inventory refs/names), and the attunement tally.
  step(() => {
    const inv = Array.isArray(cd.inventory) ? cd.inventory : [];
    const profW = classWeaponProf(classes);
    const masterySet = new Set(cd.weaponMasteryChoices || []);
    const resolveW = (it) => (it.ref && api && api.getItem && api.getItem('weapon', it.ref)) || (it.name && api && api.getItemByName && api.getItemByName('weapon', it.name)) || null;
    const weapons = [];
    let attuned = 0;
    for (const it of inv) {
      if (it.attuned) attuned++;
      const loc = it.location || 'pack';
      if (loc !== 'equipped' && loc !== 'ready') continue;
      const rec = resolveW(it);
      if (rec) weapons.push(computeWeaponAttack(rec, mods, pb, profW, masterySet));
    }
    sheet.weapons = weapons;
    sheet.attunement = { count: attuned, limit: ATTUNE_LIMIT, over: attuned > ATTUNE_LIMIT };
    if (attuned > ATTUNE_LIMIT) warn('Attuned to more than ' + ATTUNE_LIMIT + ' magic items (limit ' + ATTUNE_LIMIT + ')');
  });

  // Collected features (provenance-tagged) — feeds the Builder's level log.
  step(() => {
    const feats = [];
    for (const c of classes) {
      const prog = (c.record && c.record.progression) || [];
      for (const row of prog) {
        if (num(row.level) > c.level) continue;
        for (const f of row.features || []) feats.push({ id: f, source: { type: 'class', id: c.classId, level: row.level } });
      }
      const subRec = c.subclass && api && api.getItem ? api.getItem('subclass', c.subclass) : null;
      for (const f of (subRec && subRec.features) || []) if (num(f.level) <= c.level) feats.push({ id: f.id, name: f.name, source: { type: 'subclass', id: c.subclass, level: f.level } });
    }
    sheet.features = feats;
  });

  // Resource pools with recharge (FE-2/FE-3) — the single tracker model the sheet
  // renders and the Rest wizard resets. Emits FOUR kinds, each carrying a
  // structured `recharge: [{ on:'short'|'long', amount:'full'|<int>|'halfLevel'|
  // {abilityMod} }]` so the wizard knows WHAT resets on which rest and by HOW MUCH:
  //   • pool    — class resources (Rage / Focus / Channel Divinity…), from
  //               each class's `classResources` (max = progression table / per-level
  //               multiple / ability modifier / fixed).
  //   • hitdice — one per die size across the build (max = summed class levels).
  //   • slot    — spell slots per level (from spellcasting.slots).
  //   • charge  — free/limited casts granted by feats/species/subclass features
  //               (from spellcasting.granted[].free, e.g. Fey Touched's 1/long).
  step(() => {
    const abilMod = (a) => (sheet.abilities && sheet.abilities[a] ? num(sheet.abilities[a].mod, 0) : 0);
    const resolveMax = (res, lvl) => {
      if (Array.isArray(res.progression) && res.progression.length) {
        let m = 0;
        for (const row of res.progression) if (num(row.level, 1) <= lvl) m = num(row.max, m);
        return m;
      }
      if (res.perLevel != null) return Math.max(0, Math.floor(num(res.perLevel) * lvl));
      if (res.abilityMod) return Math.max(num(res.min, 1), abilMod(res.abilityMod));
      if (res.fixed != null) return Math.max(0, num(res.fixed));
      return 0;
    };
    // Normalize recharge into [{on, amount}]. A bare string ('long') means
    // "resets to full on that rest"; an array is taken as-is (defaulting amount).
    const normRecharge = (r) => {
      if (typeof r === 'string') return [{ on: r, amount: 'full' }];
      if (Array.isArray(r)) return r.filter((x) => x && x.on).map((x) => ({ on: String(x.on), amount: x.amount == null ? 'full' : x.amount }));
      return [{ on: 'long', amount: 'full' }];
    };
    const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
    const resources = [];

    // 1. Class + subclass resource pools (both resolved at the class's level).
    for (const c of classes) {
      const subRec = c.subclass && api && api.getItem ? api.getItem('subclass', c.subclass) : null;
      const pools = []
        .concat(((c.record && c.record.classResources) || []).map((res) => [res, { type: 'class', id: c.classId, level: c.level }]))
        .concat(((subRec && subRec.classResources) || []).map((res) => [res, { type: 'subclass', id: c.subclass, level: c.level }]));
      for (const [res, source] of pools) {
        if (!res || !res.key) continue;
        if (num(res.minLevel, 1) > c.level) continue;
        const max = resolveMax(res, c.level);
        if (max <= 0) continue;
        resources.push({
          key: String(res.key), name: res.name || String(res.key), max, kind: 'pool',
          recharge: normRecharge(res.recharge), source,
        });
      }
    }
    // 2. Hit Dice — aggregate by die size; regain half total level on a long rest.
    const byDie = {};
    for (const c of classes) { const d = c.record && c.record.hitDie; if (d) byDie[d] = (byDie[d] || 0) + c.level; }
    for (const die of Object.keys(byDie)) {
      resources.push({
        key: 'hit-dice-' + die, name: 'Hit Dice (' + die + ')', max: byDie[die], kind: 'hitdice', die,
        recharge: [{ on: 'long', amount: 'halfLevel' }], source: { type: 'class' },
      });
    }
    // 3. Spell slots (leveled). Long rest → full.
    const slots = (sheet.spellcasting && sheet.spellcasting.slots) || [];
    slots.forEach((n, i) => {
      if (num(n) > 0) resources.push({
        key: 'slot-' + (i + 1), name: 'Spell Slots (' + (ORD[i] || (i + 1) + 'th') + ')', max: num(n), kind: 'slot',
        recharge: [{ on: 'long', amount: 'full' }], source: { type: 'spellcasting' },
      });
    });
    // 4. Granted free/limited casts (feat / species / subclass) → charges.
    const parseFreq = (f) => { const m = /(\d+)\s*\/\s*(short|long)/i.exec(String(f || '')); return m ? { max: num(m[1], 1), on: m[2].toLowerCase() } : { max: 1, on: 'long' }; };
    for (const g of (sheet.spellcasting && sheet.spellcasting.granted) || []) {
      if (!g.free) continue;
      const fq = parseFreq(g.free);
      resources.push({
        key: 'charge-' + (g.ref || g.name), name: (g.name || g.ref) + ' (free cast)', max: fq.max, kind: 'charge',
        recharge: [{ on: fq.on, amount: 'full' }], source: g.source || { type: 'spell' },
      });
    }
    sheet.resources = resources;
  });

  return { sheet, warnings };
}

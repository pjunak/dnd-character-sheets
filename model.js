// ═══════════════════════════════════════════════════════════════
//  model.js — the decision/derivation pipeline (engine-mode brains).
//
//  Builds the Builder's working model from the stored sheet, collects + resolves
//  the choice descriptors, hydrates the rules engine (error-isolated),
//  materializes the durable fallback, and exposes the single `viewModel` the read
//  tabs consume (computed-when-present, hand-filled otherwise; a stored override
//  always wins). Also owns `mutate` / `builderMutate` (persist + re-render
//  through patchAddonData → this NS only).
//
//  A compatible rules engine is discovered through the generic host service
//  registry. Without one, or without its rules-data provider, the sheet stays
//  fully hand-fillable from its durable materialized fields.
//
//  `makeEngine(ctx)` binds host + the shared helpers/constants; every function is
//  pure-ish (no module-level state) except the two mutators.
// ═══════════════════════════════════════════════════════════════

import {
  captureProviderState,
  resolveProviderState,
} from './provider-state.js';

export function makeEngine(ctx) {
  const { host, NS, ABILITIES, SKILLS, num, abilityMod, sheetOf } = ctx;
  const engineIdentities = new WeakMap();

  const identityFor = engine => engineIdentities.get(engine) || {
    ...(engine?.getContextIdentity?.() || {}),
  };

  const builderPlan = (sheet, engine) => engine.getBuilderPlan(sheet);
  const builderModel = (sheet, engine) => {
    const plan = builderPlan(sheet, engine);
    return { baseStats: plan.baseStats, classes: plan.classes };
  };
  const collectChoices = (classes, engine) => builderPlan({ classes }, engine).classChoices;
  const collectCreationChoices = (sheet, engine) => builderPlan(sheet, engine).creationChoices;

  /** Apply the engine-owned pruning result to the mutable sheet passed by the
   *  host store. The engine returns a detached copy; persistence stays here. */
  const reconcile = (sheet, engine) => {
    if (!engine || !sheet) return;
    const next = engine.reconcileBuilderDecisions(sheet);
    sheet.featureChoices = { ...(next.featureChoices || {}) };
    sheet.abilityGrants = Array.isArray(next.abilityGrants) ? next.abilityGrants : [];
  };

  /** Hydration accepts the stored decisions directly. The engine normalizes
   *  legacy flat fields, resolves every Builder descriptor, and applies rules. */
  const decisionsOf = (s, engine) => {
    const plan = builderPlan(s, engine);
    return {
      ...s,
      saveProf: { ...(s.manualSaveProf || {}) },
      classes: plan.classes,
      baseStats: plan.baseStats,
    };
  };

  /** Run the rules engine over the stored decisions (error-isolated). Returns
   *  the engine result { sheet, warnings } or null in standalone / on failure —
   *  so a broken engine never breaks the sheet. */
  const safeHydrate = (engine, s) => {
    try {
      const r = engine && engine.hydrate && engine.hydrate(s);
      if (!(r && r.sheet)) return null;
      // A character built under another edition still renders; the
      // installed provider's rules interpret the decisions — but says so
      // warning is advisory and never blocks editing.
      const ed = identityFor(engine).edition || null;
      if (ed && s && s.ruleset && s.ruleset !== ed) r.warnings.unshift('Character was built with the ' + s.ruleset + ' ruleset; the installed rules are ' + ed);
      return r;
    }
    catch (_) { return null; }
  };

  /** Write the engine-computed sheet into the flat fallback fields so
   *  removing the engine later degrades to this last-computed snapshot (a
   *  fully-functional hand-filled sheet) rather than blank/broken. Mutates `s`. */
  const materializeInto = (s, engine) => {
    const r = safeHydrate(engine, decisionsOf(s, engine));
    if (!r || !r.sheet) return;
    // Stamp which edition's rules computed this build for legacy display and
    // migration; full engine/data/ruleset identity is captured below.
    const edition = identityFor(engine).edition;
    if (edition) s.ruleset = edition;
    const cs = r.sheet, d = cs.derived || {};
    const m = builderModel(s, engine);
    // First REAL class (placeholder "＋ Add class" rows carry no classId).
    const named = m.classes.filter((cl) => cl && cl.classId);
    const first = named[0] || m.classes[0] || {};
    const firstRec = first.classId ? engine.getItem('class', first.classId) : null;
    const classNameOf = (cl) => { const rec2 = engine.getItem ? engine.getItem('class', cl.classId) : null; return (rec2 && rec2.name) || cl.classId; };
    // A multiclass build materializes the whole joined line ("Fighter 5 /
    // Wizard 5") — collapsing to the first class name alone lost the rest of
    // the build when the engine was removed. Single-class keeps the bare name
    // (the header template already prints the level).
    s.className = named.length > 1
      ? named.map((cl) => classNameOf(cl) + ' ' + Math.max(1, num(cl.level, 1))).join(' / ')
      : (firstRec ? firstRec.name : s.className);
    // The flat fallback stores resolved NAMES, not ids — `classes[]` keeps the
    // id; a slug like "life-domain" in the header (and after engine removal)
    // was the bug this closes.
    const subRec = first.subclass && engine.getItem ? engine.getItem('subclass', first.subclass) : null;
    s.subclass = subRec ? subRec.name : (first.subclass || '');
    s.level = num(cs.totalLevel, num(s.level, 1));
    for (const a of ABILITIES) if (cs.abilities && cs.abilities[a]) s.abilities[a] = num(cs.abilities[a].score, num(s.abilities[a], 10));
    s.maxHp = num(d.maxHp, s.maxHp);
    s.hp = ctx.clampHp(num(s.hp, 0), effectiveMaxHp(s, cs));   // override-aware
    s.ac = num(d.armorClass, s.ac);
    s.initiative = num(d.initiative, s.initiative);
    s.speed = num(d.speed, s.speed);
    s.profBonus = num(d.proficiencyBonus, s.profBonus);
    s.saveProf = {};
    for (const a of ABILITIES) s.saveProf[a] = !!(cs.saves && cs.saves[a] && cs.saves[a].proficient);
    s.skillProf = {};
    for (const id of Object.keys(cs.skills || {})) s.skillProf[id] = !!cs.skills[id].proficient;
    // Expertise is part of the computed truth; materialize the flat map
    // the standalone viewModel doubles PB from, so removing the engine keeps
    // the same skill totals (they used to silently drop by PB).
    s.skillExpertise = {};
    for (const id of Object.keys(cs.skills || {})) if (cs.skills[id].expertise) s.skillExpertise[id] = true;
    s.traitSnapshot = {
      languages: Array.isArray(cs.languages) ? cs.languages.slice() : [],
      senses: { ...(cs.senses || {}) },
      resistances: Array.isArray(cs.resistances) ? cs.resistances.slice() : [],
      damageImmunities: Array.isArray(cs.damageImmunities) ? cs.damageImmunities.slice() : [],
      conditionImmunities: Array.isArray(cs.conditionImmunities) ? cs.conditionImmunities.slice() : [],
      armor: Array.isArray(cs.proficiencies && cs.proficiencies.armor) ? cs.proficiencies.armor.slice() : [],
      weapons: Array.isArray(cs.proficiencies && cs.proficiencies.weapons) ? cs.proficiencies.weapons.slice() : [],
      tools: Array.isArray(cs.proficiencies && cs.proficiencies.tools) ? cs.proficiencies.tools.slice() : [],
    };
    // Keep a name-resolved snapshot of the whole spell loadout:
    // cantrips + prepared picks + granted/always-prepared — written into
    // s.spells with origin:'snapshot'. The standalone spellbook renders
    // s.spells, so removing the engine/book keeps the loadout visible as plain
    // editable entries (the raw refs in preparedSpells/cantrips would no longer
    // resolve). Replaced WHOLESALE on every materialize so stale snapshots
    // never accumulate; the user's own manual/copied/other entries are kept;
    // engine-mode renders filter snapshots out (the live prep UI owns them).
    const nice = (x) => (typeof ctx.titleize === 'function' ? ctx.titleize(x) : String(x || ''));
    const snap = [];
    const seen = new Set();
    const addSnap = (ref, note) => {
      if (!ref || seen.has(ref)) return;
      seen.add(ref);
      const rec2 = engine.getItem ? engine.getItem('spell', ref) : null;
      snap.push({
        id: 'snap:' + ref, ref, origin: 'snapshot', prepared: true, sourceNote: note || '',
        name: rec2 ? rec2.name : String(ref),
        level: rec2 ? num(rec2.level, 0) : 0,
        school: (rec2 && rec2.school) || '',
      });
    };
    for (const p of (cs.spellcasting && cs.spellcasting.perClass) || []) {
      const cn = ((engine.getItem && engine.getItem('class', p.classId)) || {}).name || nice(p.classId);
      for (const ref of (s.cantrips && s.cantrips[p.classId]) || []) addSnap(ref, cn);
      for (const ref of (s.preparedSpells && s.preparedSpells[p.classId]) || []) addSnap(ref, cn);
    }
    for (const g of (cs.spellcasting && cs.spellcasting.granted) || []) addSnap(g.ref, nice((g.source && (g.source.id || g.source.type)) || ''));
    s.spells = (Array.isArray(s.spells) ? s.spells : []).filter((sp) => sp && sp.origin !== 'snapshot').concat(snap);
    captureProviderState(s, identityFor(engine));
  };

  // ── Replaceable rules engine service ──────────────────────────
  // Resolve lazily on every render/action. The host owns provider selection,
  // lifecycle ordering, and reloads this addon when the selected engine or its
  // rules-data provider changes.
  const _probeEngine = () => {
    try {
      const handle = host.useService?.('dnd5e.rules-engine');
      const engine = handle?.api;
      if (!engine || engine.apiVersion !== 2
          || typeof engine.hydrate !== 'function'
          || typeof engine.getBuilderPlan !== 'function'
          || typeof engine.applyBuilderChoice !== 'function'
          || typeof engine.reconcileBuilderDecisions !== 'function') return null;
      const availability = engine.getAvailability?.();
      if (!availability?.available) return null;
      const identity = {
        engineAddonId: String(handle.provider?.addonId || ''),
        engineAddonVersion: String(handle.provider?.addonVersion || ''),
        engineContractVersion: String(handle.provider?.contractVersion || ''),
        ...(engine.getContextIdentity?.() || {}),
      };
      engineIdentities.set(engine, identity);
      return { engine, identity };
    } catch (_) {
      return null;
    }
  };
  const providerState = (sheet) => {
    const provider = _probeEngine();
    if (!provider) return { status: 'unavailable', engine: null };
    const state = resolveProviderState(sheet, provider.identity);
    return {
      ...state,
      identity: provider.identity,
      edition: provider.identity.edition,
      engine: state.status === 'active' ? provider.engine : null,
    };
  };
  const getRules = sheet => providerState(sheet).engine;

  /** The one max-HP value every clamp and heal respects (setField /
   *  applyHp / the Rest wizard / materialize all route through this, so a clamp
   *  can never disagree with the max the HP tile displays):
   *    • engine mode: a stored override BEATS the computed max ("the DM said
   *      so"), else the computed max (`comp`, when the caller already
   *      hydrated), else the flat s.maxHp, which materialization keeps
   *      equal to the computed max, so the cheap flat read stays correct.
   *    • standalone: the flat hand-filled s.maxHp (the viewModel ignores
   *      dormant overrides there, so the clamp does too). */
  const effectiveMaxHp = (s, comp) => {
    const ov = (s && s.overrides) || {};
    if (getRules(s) && ov.maxHp != null) return num(ov.maxHp, 0);
    if (comp && comp.derived && comp.derived.maxHp != null) return num(comp.derived.maxHp, 0);
    return num(s && s.maxHp, 0);
  };

  /** One value source for the read tabs: computed values from the engine when
   *  present (derive, do not store), else the hand-filled flat fields. A
   *  stored override always wins. The `auto` flag drives the badge.
   *  Passive perception routes through the resolved Perception skill total so
   *  expertise is reflected and the formula lives in exactly one place. */
  const viewModel = (s, comp) => {
    const flatPb = num(s.profBonus, 0);
    const ov = s.overrides || {};
    if (comp) {
      const d = comp.derived || {};
      const pick = (field, computed) => (ov[field] != null ? num(ov[field]) : num(computed));
      const vm = {
        auto: true,
        overridden: (f) => ov[f] != null,
        autoVal: { maxHp: num(d.maxHp), ac: num(d.armorClass), init: num(d.initiative), speed: num(d.speed) },
        pb: num(d.proficiencyBonus, flatPb),
        maxHp: pick('maxHp', d.maxHp),
        ac: pick('ac', d.armorClass),
        init: pick('initiative', d.initiative),
        speed: pick('speed', d.speed),
        save: (a) => { const x = (comp.saves && comp.saves[a]) || {}; return { prof: !!x.proficient, exp: false, total: num(x.total, abilityMod(s.abilities[a])) }; },
        skill: (id, ab) => { const x = (comp.skills && comp.skills[id]) || {}; return { prof: !!x.proficient, exp: !!x.expertise, total: num(x.total, abilityMod(s.abilities[ab])) }; },
      };
      // Passive perception = 10 + the resolved Perception skill total (engine
      // value preferred; recomputed from the same skill() resolver otherwise).
      const perc = vm.skill('perception', 'WIS');
      vm.passivePerc = (comp.derived && comp.derived.passivePerception != null)
        ? num(comp.derived.passivePerception, 10 + perc.total)
        : 10 + perc.total;
      return vm;
    }
    const vm = {
      auto: false,
      overridden: () => false,
      autoVal: {},
      pb: flatPb,
      maxHp: num(s.maxHp, 0),
      ac: num(s.ac, 10),
      init: num(s.initiative, 0),
      speed: num(s.speed, 30),
      save: (a) => { const prof = !!s.saveProf[a]; return { prof, exp: false, total: abilityMod(s.abilities[a]) + (prof ? flatPb : 0) }; },
      // Expertise survives engine removal through the materialized flat
      // skillExpertise map doubles PB exactly as the engine did — only where
      // the skill is also proficient (PR-2).
      skill: (id, ab) => {
        const prof = !!s.skillProf[id];
        const exp = prof && !!(s.skillExpertise && s.skillExpertise[id]);
        return { prof, exp, total: abilityMod(s.abilities[ab]) + (exp ? 2 : prof ? 1 : 0) * flatPb };
      },
    };
    // Same one-formula route in standalone: 10 + Perception skill total.
    vm.passivePerc = 10 + vm.skill('perception', 'WIS').total;
    return vm;
  };

  // ── Mutators (route through patchAddonData → this NS only) ────────
  const mutate = (cid, fn) => {
    host.store.patchAddonData('characters', cid, (raw) => {
      const s = sheetOf({ addonData: { [NS]: raw } });
      const before = providerState(s);
      const hasBuilderState = s.baseStats
        || s.classes.length
        || s.spells.some(spell => spell?.origin === 'snapshot');
      if (before.status === 'unavailable'
          && s.rulesMode !== 'manual'
          && !s.rulesProvider
          && hasBuilderState) {
        captureProviderState(s, s.ruleset);
      }
      const out = fn(s) || s;
      const state = providerState(out);
      if (state.status === 'active' && !out.rulesProvider) {
        captureProviderState(out, state.identity);
      }
      return out;
    });
    host.ui.rerender();
  };

  /** Builder mutation: seed the rich model (migration) if needed, apply `fn`,
   *  then materialize the durable fallback. Persists and rerenders via `mutate`. */
  const builderMutate = (cid, fn) => {
    mutate(cid, (s) => {
      const engine = getRules(s);
      const m = builderModel(s, engine);
      if (!Array.isArray(s.classes) || !s.classes.length) s.classes = m.classes;
      if (!s.baseStats || !Object.keys(s.baseStats).length) s.baseStats = m.baseStats;
      fn(s, engine);
      if (engine) materializeInto(s, engine);
      return s;
    });
  };

  const resolveProvider = (cid, choice) => {
    if (choice !== 'manual' && choice !== 'builder') return;
    mutate(cid, (sheet) => {
      if (choice === 'manual') {
        sheet.rulesMode = 'manual';
        return sheet;
      }
      const provider = _probeEngine();
      if (!provider) return sheet;
      sheet.rulesMode = 'auto';
      sheet.rulesProvider = null;
      materializeInto(sheet, provider.engine);
      return sheet;
    });
  };

  const prepareSheetExport = (sheet) => {
    const copy = JSON.parse(JSON.stringify(sheet));
    const state = providerState(copy);
    if (state.status === 'active' && !copy.rulesProvider) {
      captureProviderState(copy, state.identity);
    }
    return copy;
  };

  return {
    builderPlan, builderModel, collectChoices, collectCreationChoices, reconcile, decisionsOf,
    safeHydrate, materializeInto, getRules, viewModel, mutate, builderMutate,
    effectiveMaxHp, providerState, resolveProvider, prepareSheetExport,
  };
}

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
//  The rules ENGINE is built in (rules/engine.js + rules/api.js); what's
//  optional is the CONTENT: the
//  api activates only while a book data addon (dnd55e-compendium) is
//  installed, and the sheet stays fully hand-fillable without it.
//
//  `makeEngine(ctx)` binds host + the shared helpers/constants; every function is
//  pure-ish (no module-level state) except the two mutators.
// ═══════════════════════════════════════════════════════════════

import { makeRulesApi } from './rules/api.js';
import {
  captureProviderState,
  resolveProviderState,
} from './provider-state.js';

export function makeEngine(ctx) {
  const { host, NS, ABILITIES, SKILLS, num, abilityMod, sheetOf } = ctx;

  /** Normalize a stored sheet into the Builder's working model, deriving the
   *  rich shape from the flat fields on first use (MC-1 migration). `engine` is
   *  used to resolve a free-text className → a compendium class id. Returns
   *  { classes, baseStats } — does NOT mutate; the actions persist edits. */
  const builderModel = (s, engine) => {
    const baseStats = (s.baseStats && Object.keys(s.baseStats).length)
      ? { ...s.baseStats }
      : { ...s.abilities };               // first Builder open: current scores become the base
    let classes = Array.isArray(s.classes) && s.classes.length ? s.classes.map((c) => ({ ...c })) : null;
    if (!classes) {
      const cid = s.className && engine && engine.getItemByName ? (engine.getItemByName('class', s.className) || {}).id : '';
      classes = s.className
        ? [{ classId: cid || '', level: Math.max(1, num(s.level, 1)), subclass: s.subclass || '' }]
        : [{ classId: '', level: 1, subclass: '' }];
    }
    return { baseStats, classes };
  };

  // ASI-opportunity levels for a class. The base levels come from the ruleset
  // (2024: 4/8/12/16/19); some classes get extras (Fighter 6 & 14,
  // Rogue 10) declared in the class's `progression` (levels whose features
  // include an "Ability Score Improvement"). Union with the base so extras are
  // ADDED without dropping anything.
  const asiLevelsFor = (rec) => {
    const set = new Set(rulesApi.getRuleset().constants.asi.baseLevels);
    for (const p of (Array.isArray(rec && rec.progression) ? rec.progression : []))
      if ((p.features || []).some((f) => /ability score improvement/i.test(String(f)))) { const n = num(p.level); if (n > 0) set.add(n); }
    return [...set].sort((a, b) => a - b);
  };

  /** The choice descriptors for a build — the SINGLE source used by BOTH the
   *  Builder UI (to render pickers) and resolveChoices (to apply resolutions),
   *  so the two never drift. Background ASI is handled separately (its split UI).
   *  kind ∈ skills | expertise | weaponMastery | feat | enumerated | asiMode. */
  const collectChoices = (classes, engine) => {
    const out = [];
    // A ruleset without the weapon-mastery subsystem drops those
    // descriptors — the engine zeroes the slots too, this keeps the picker away.
    const noMastery = rulesApi.getRuleset().capabilities.weaponMastery === false;
    for (const [classIndex, cl] of classes.entries()) {
      const rec = cl.classId ? engine.getItem('class', cl.classId) : null;
      if (!rec) continue;
      const clvl = num(cl.level, 1);
      const starting = rec.startingProficiencies || {};
      const reduced = classIndex > 0 ? rec.multiclassProficiencies : null;
      const sk = (reduced && reduced.skills) || starting.skills;
      if (sk && sk.choose) out.push({ id: 'skills:' + cl.classId, kind: 'skills', count: num(sk.choose, 1), from: sk.from || [], source: { type: 'class', id: cl.classId, level: 1 } });
      for (const ch of (rec.grants && rec.grants.choices) || []) {
        const srcLevel = num(String(ch.source || '').split(':')[1], 1);
        if (srcLevel > clvl) continue;
        let kind = 'enumerated';
        if (ch.type === 'expertise') kind = 'expertise';
        else if (ch.type === 'toolProficiency') kind = 'tools';
        else if (ch.type === 'weaponMastery') { if (noMastery) continue; kind = 'weaponMastery'; }
        else if (!Array.isArray(ch.from) && (ch.type === 'feat' || ch.category)) kind = 'feat';
        out.push({ id: ch.id, kind, count: num(ch.count, 1), from: ch.from, category: ch.category, prompt: ch.prompt, source: { type: 'class', id: cl.classId, level: srcLevel } });
      }
      // Option-pool choices declared on the class's FEATURE records (Metamagic,
      // Battle Master maneuvers, …). Historically collectChoices read only the
      // class record's grants; feature records carry their own grants.choices,
      // usually with `fromCategory` — expand it to the ids of every feature in
      // that category (all Metamagic options, all maneuvers, …). Subclass-feature
      // grants apply only when that subclass is selected. (feature.grants rides
      // on the slim projection, so no per-feature full fetch here.)
      if (engine.listFeatures) {
        for (const fslim of engine.listFeatures({ classId: cl.classId })) {
          if (num(fslim.level) > clvl) continue;
          if (fslim.subclassId && fslim.subclassId !== cl.subclass) continue;
          for (const ch of (fslim.grants && fslim.grants.choices) || []) {
            const srcLevel = num(String(ch.source || '').split(':')[1], num(fslim.level, 1));
            if (srcLevel > clvl) continue;
            let from = Array.isArray(ch.from) ? ch.from : null;
            if (!from && ch.fromCategory) from = engine.listFeatures({ category: ch.fromCategory }).map((o) => o.id);
            let kind = 'enumerated';
            if (ch.type === 'expertise') kind = 'expertise';
            else if (ch.type === 'toolProficiency') kind = 'tools';
            else if (ch.type === 'weaponMastery') { if (noMastery) continue; kind = 'weaponMastery'; }
            else if (!Array.isArray(from) && (ch.type === 'feat' || ch.category)) kind = 'feat';
            // Pool size grows with level: `countByLevel` maps a level → total known;
            // take the highest entry at or below this class's level (falls back to the
            // flat `count`, so a handbook without the schedule still yields the base size).
            let count = num(ch.count, 1);
            if (ch.countByLevel) {
              let best = -1;
              for (const k of Object.keys(ch.countByLevel)) { const lv = num(k); if (lv <= clvl && lv > best) { best = lv; count = num(ch.countByLevel[k], count); } }
            }
            out.push({ id: ch.id, kind, count, from, category: ch.category, prompt: ch.prompt, source: { type: 'feature', id: fslim.id, level: srcLevel } });
          }
        }
      }
      for (const lvl of asiLevelsFor(rec)) if (lvl <= clvl) out.push({ id: 'asi:' + cl.classId + ':' + lvl, kind: 'asiMode', classId: cl.classId, level: lvl, source: { type: 'class', id: cl.classId, level: lvl } });
    }
    // Dedupe by descriptor id (keep-first). Class records declare the L1 skills
    // choice TWICE — canonically in startingProficiencies.skills (pushed first, WITH
    // its `from` pool) AND redundantly in grants.choices as a bare {type:'skills'}
    // (no `from`), which would otherwise surface as an empty `enumerated` picker
    // ("content pending"). featureChoices are keyed by descriptor id, so a duplicate
    // id already aliases the same stored resolution — keep-first both drops the
    // malformed dup and enforces that id-uniqueness invariant. (Entries lacking an
    // id can't be deduped — a separate data concern — so pass them through.)
    const seen = new Set();
    return out.filter((c) => (c.id ? (seen.has(c.id) ? false : (seen.add(c.id), true)) : true));
  };

  const collectCreationChoices = (s, engine) => {
    const out = [];
    const background = s.background
      ? (engine.getItemByName('background', s.background) || engine.getItem('background', s.background))
      : null;
    if (background && background.toolProficiencyChoice) {
      const choice = background.toolProficiencyChoice;
      out.push({
        id: `background:${background.id}:tool`,
        kind: 'tools',
        count: num(choice.count, 1),
        from: Array.isArray(choice.from) ? choice.from : [],
        prompt: choice.prompt,
        source: { type: 'background', id: background.id, level: 1 },
      });
    }
    const speciesId = s.species || s.race;
    const species = speciesId
      ? (engine.getItemByName('species', speciesId) || engine.getItem('species', speciesId))
      : null;
    for (const choice of (species && species.grants && species.grants.choices) || []) {
      let kind = 'enumerated';
      if (choice.type === 'skillProficiency') kind = 'skills';
      else if (choice.type === 'toolProficiency') kind = 'tools';
      else if (choice.type === 'proficiency') kind = 'proficiencies';
      out.push({
        id: `species:${species.id}:${choice.id}`,
        kind,
        count: num(choice.count, 1),
        from: Array.isArray(choice.from) ? choice.from : [],
        prompt: choice.prompt,
        source: { type: 'species', id: species.id, level: 1 },
      });
    }
    return out;
  };

  /** Map featureChoices resolutions → the canonical input fields the engine
   *  reads (skill proficiencies, expertise, feats, weapon-mastery picks). The
   *  background ASI is already an abilityGrant; ASI-level "+2" picks too. */
  const resolveChoices = (s, classes, engine) => {
    const fc = s.featureChoices || {};
    const skillProficiencies = [], toolProficiencies = [], feats = [], weaponMasteryChoices = [];
    const skillExpertise = {};
    const valsOf = (ch) => {
      // Dedup across boxes (FE-7): a value picked twice counts once, so duplicate
      // legacy data never double-applies (skills/expertise/weaponMastery/feats).
      if (num(ch.count, 1) > 1) { const a = []; for (let i = 0; i < ch.count; i++) { const v = fc[ch.id + '#' + i]; if (v && !a.includes(v)) a.push(v); } return a; }
      const v = fc[ch.id]; return v ? [v] : [];
    };
    const bgRec = s.background ? (engine.getItemByName('background', s.background) || engine.getItem('background', s.background)) : null;
    if (bgRec && bgRec.originFeat) feats.push(bgRec.originFeat);
    // Level-independent extra feats from a custom source: a compendium featId
    // applies its mechanics via the engine; free-text (no featId) is tracked only.
    for (const ef of (Array.isArray(s.extraFeats) ? s.extraFeats : [])) if (ef && ef.featId) feats.push(ef.featId);
    for (const ch of collectChoices(classes, engine).concat(collectCreationChoices(s, engine))) {
      const vals = valsOf(ch);
      if (ch.kind === 'skills') skillProficiencies.push(...vals);
      else if (ch.kind === 'tools') toolProficiencies.push(...vals);
      else if (ch.kind === 'proficiencies') {
        for (const value of vals) {
          if (value.startsWith('skill:')) skillProficiencies.push(value.slice(6));
          else if (value.startsWith('tool:')) toolProficiencies.push(value.slice(5));
        }
      }
      else if (ch.kind === 'expertise') vals.forEach((v) => { skillExpertise[v] = true; });
      else if (ch.kind === 'weaponMastery') weaponMasteryChoices.push(...vals);
      else if (ch.kind === 'feat') feats.push(...vals);
      else if (ch.kind === 'asiMode') { if (fc[ch.id] === 'feat' && fc[ch.id + ':feat']) feats.push(fc[ch.id + ':feat']); }
    }
    return {
      skillProficiencies: [...new Set(skillProficiencies)],
      toolProficiencies: [...new Set(toolProficiencies)],
      skillExpertise,
      feats: feats.map((f) => ({ featId: f })),
      weaponMasteryChoices,
    };
  };

  /** Prune orphaned decisions after a structural change (class/subclass/level/
   *  class-removal): featureChoices + abilityGrants whose owning choice no longer
   *  exists in the current build. CRITICAL because abilityGrants apply
   *  UNCONDITIONALLY in hydrate — a stale ASI / half-feat grant from a dropped
   *  class or lowered level would keep bumping ability scores otherwise. Mutates `s`.
   *  (Complements builderChoose's mode-switch cleanup, which handles ASI↔feat.) */
  const reconcile = (s, engine) => {
    if (!engine || !s) return;
    const classes = Array.isArray(s.classes) ? s.classes : [];
    const valid = new Set(
      collectChoices(classes, engine)
        .concat(collectCreationChoices(s, engine))
        .map((c) => c.id)
    );
    const bgRec = s.background ? (engine.getItemByName('background', s.background) || engine.getItem('background', s.background)) : null;
    if (bgRec && Array.isArray(bgRec.abilityScores) && bgRec.abilityScores.length) valid.add('bgasi');
    const baseOf = (k) => String(k).replace(/#\d+$/, '').replace(/:(ability|feat|featability)$/, '');
    const fc = s.featureChoices || {};
    for (const k of Object.keys(fc)) if (!valid.has(baseOf(k))) delete fc[k];
    if (Array.isArray(s.abilityGrants)) s.abilityGrants = s.abilityGrants.filter((g) => valid.has(baseOf(g.id)));
  };

  /** The decisions object the engine hydrates: the Builder's rich model + the
   *  resolved choices, merged over the stored sheet (so the engine sees
   *  classes[]/baseStats/grants AND the applied skill/expertise/feat picks). */
  const decisionsOf = (s, engine) => {
    const m = builderModel(s, engine);
    const resolved = engine ? resolveChoices(s, m.classes, engine) : {};
    return { ...s, classes: m.classes, baseStats: m.baseStats, ...resolved };
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
      const ed = engine.getRuleset ? engine.getRuleset().edition : null;
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
    // Stamp which edition's rules computed this build; the provider
    // selection key for campaigns with a non-2024 compendium (blank() seeds
    // '2024' for blobs that predate providers shipping a ruleset record).
    if (engine.getRuleset) { const ed = engine.getRuleset().edition; if (ed) s.ruleset = ed; }
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
    captureProviderState(
      s,
      engine.getRuleset ? engine.getRuleset().edition : s.ruleset,
    );
  };

  // ── The rules api — the built-in engine bound to live book data ──
  // The engine always ships with this addon now; what's optional is CONTENT.
  // `_probeData()` soft-probes the known data providers IN ORDER (each a
  // manifest `optionalDependencies` entry: the host permits host.use() for it
  // and load-orders it before us WHEN present, but never blocks us when it's
  // absent — then use() throws → skip → standalone). The probe is duck-typed
  // (`apiVersion >= 1`), so ANY addon providing the compendium's api shape
  // works; the first valid provider wins (one edition per campaign;
  // its `ruleset` record dictates the system rules; the character's stored
  // `ruleset` tag records which edition built it, and a mismatch surfaces as a
  // hydrate warning in safeHydrate). `getRules()` returns the api only while
  // book data is actually present, so every engine-mode branch (Builder tab,
  // computed vitals, the spellbook engine path) lights up exactly when there
  // is content to compute from, and the sheet degrades to the hand-filled
  // standalone paths otherwise. The probe is lazy, per render,
  // try/caught — installing/removing a book mid-session never breaks the sheet.
  const DATA_ADDONS = ['dnd55e-compendium', 'dnd5e-compendium'];   // 2024, 2014 (future repo)
  const _probeProvider = () => {
    for (const id of DATA_ADDONS) {
      try {
        const d = host.use && host.use(id);
        if (d && d.apiVersion >= 1) return { id, data: d };
      } catch (_) { /* not installed / not declared — try the next candidate */ }
    }
    return null;
  };
  const _probeData = () => _probeProvider()?.data || null;
  const rulesApi = makeRulesApi(_probeData);
  const providerState = (sheet) => {
    const provider = _probeProvider();
    if (!provider) return { status: 'unavailable', engine: null };
    const edition = rulesApi.getRuleset().edition;
    const state = resolveProviderState(sheet, edition);
    return {
      ...state,
      providerId: provider.id,
      edition,
      engine: state.status === 'active' ? rulesApi : null,
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
        captureProviderState(out, state.edition);
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
      const provider = _probeProvider();
      if (!provider) return sheet;
      sheet.rulesMode = 'auto';
      sheet.rulesProvider = null;
      materializeInto(sheet, rulesApi);
      return sheet;
    });
  };

  const prepareSheetExport = (sheet) => {
    const copy = JSON.parse(JSON.stringify(sheet));
    const state = providerState(copy);
    if (state.status === 'active' && !copy.rulesProvider) {
      captureProviderState(copy, state.edition);
    }
    return copy;
  };

  return {
    builderModel, collectChoices, collectCreationChoices, resolveChoices, reconcile, decisionsOf,
    safeHydrate, materializeInto, getRules, rulesApi, viewModel, mutate, builderMutate,
    effectiveMaxHp, providerState, resolveProvider, prepareSheetExport,
  };
}

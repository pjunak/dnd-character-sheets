# D&D 5.5e (2024) Character Sheet — Rules Edge-Case Catalog

> **Purpose.** Before reworking the character display into tabs (Overview / Sheet /
> Spellbook / Backpack / Leveling-or-Editor) we enumerate every tricky rule interaction
> the data model + engine + UI must survive, so we design the **data shape once** instead
> of reworking it three times. Each item has a stable ID (reference it in commits/issues),
> a description of *why it bites*, and a recommended solution split across the three addons.
>
> **Ownership tags** — which LAYER implements the fix:
> `[S]` the sheet UI / per-character storage (this repo's panels + model.js) ·
> `[R]` the rules engine (this repo's `rules/` module — merged in from the
> retired standalone `dnd55e-core-rules` addon) ·
> `[C]` the book data addon (`dnd55e-players-handbook`, formerly
> `dnd55e-compendium`; content record shape / declared grants).
> Older entries below still say "core-rules"/"compendium" — read those as the
> rules module / the Player's Handbook addon respectively.
>
> **Severity** — `★★★` must get right now (reworking it later is expensive) ·
> `★★` important, design the seam now even if implemented later ·
> `★` polish / can defer.
>
> **Edition.** Target is the **2024 PHB ("5.5e")** rules. Where 2014 content differs
> (species ASIs, known-vs-prepared, Variant Human), that's called out under `ED-*`.

---

## 0. Foundational architecture (the spine everything else hangs on)

These aren't D&D rules — they're the structural decisions that make the rules edge cases
*tractable*. Get these wrong and every section below becomes a rework.

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **ARCH-1** ★★★ `[S][R]` | **Store only decisions; compute everything else at render.** | If we persist computed numbers (maxHp, AC, save totals), a later rules fix or an ability-score change silently leaves stale values on every existing character. | `addonData` holds **decisions only** (choices, base scores, levels, equipped flags, prepared set). `rules.hydrate(decisions) → {sheet, warnings}` derives the rest each render. The current flat blob (persisted `maxHp/ac/profBonus/...`) becomes **overrides**, not source of truth. |
| **ARCH-2** ★★★ `[R][C][S]` | **Provenance on every granted thing.** | "Where did this spell / proficiency / +1 AC come from?" drives dedup detection, the colored forced-duplicate warning, removal when a source is removed, and the "auto vs manual" badges. Without it you cannot implement the user's spell-provenance requirement at all. | Every grant the engine emits carries `source: {type:'class'|'subclass'|'feat'|'species'|'background'|'item'|'manual'|'copied', id, label}`. Compendium records declare grants; engine stamps source while collecting; UI reads it. |
| **ARCH-3** ★★★ `[S]` | **Per-field manual override that always wins.** | Standalone (no rules) mode and "the DM said so" both need to beat the computed value, without losing the computed value underneath. | `overrides: { maxHp, ac, speed, initiative, saveDC:{}, skill:{}, ... }`. Render order: `override ?? computed ?? blank`. UI shows a `↺ auto` affordance to clear an override, and flags divergence (`manual 18 · auto 16`). |
| **ARCH-4** ★★★ `[S][R]` | **Graceful degradation when book data is absent.** | The user's hard requirement: sheet must be fully hand-fillable with no book addon installed, and installing/removing it must never break a sheet. | *(As shipped: the rules engine is BUILT-IN under `rules/`; what's probed is the DATA addon — `model.js` calls `host.use('dnd55e-players-handbook')` **lazily per render**, try/caught.)* Absent → every field falls back to its override or a free-text/manual input; spellbook becomes an unenforced editable list; no dropdowns. Present → dropdowns + computed values + `↺ auto`. |
| **ARCH-5** ★★ `[R]` | **Validation is advisory, never blocking.** | DMs allow homebrew and "illegal" builds constantly. Over-prepared, >3 attunement, failed multiclass prereqs, unknown spell — none may block saving. | `hydrate` returns `warnings[]` with `severity: 'illegal'|'soft'|'info'`. UI surfaces them as dismissible chips, never as save-blockers. |
| **ARCH-6** ★★★ `[S]` | **Schema versioning + migration of the *existing* filled sheet.** | The user already created and filled a character on the current flat blob (`className` string, flat `maxHp`). The redesign changes the shape; that data must migrate, not vanish. | Bump `v`. Write idempotent migrators: `className` string → `classes:[{classId|manualName, level}]`; flat `maxHp/ac/...` → `overrides`; flat `skillProf{}` → decision set. Run on read (mirror the host's `_migrate*` pattern). |
| **ARCH-7** ★★ `[R][C]` | **Edition coexistence (2014 vs 2024).** | 2014 species grant ASIs, classes are known-vs-prepared, backgrounds differ. Mixing silently double-applies or mis-applies. | Tag every compendium record `edition: '2024'|'2014'`. Engine targets 2024 semantics; treat 2014 records via per-record rule flags or simply exclude them from the v1 pickers. Recommend **2024-only** content for v1. |
| **ARCH-8** ★★ `[R]` | **Recompute cost / render storms.** | `hydrate` runs on every render and the host re-renders on every data change (SSE + local). A heavy pipeline × many sheets can lag. | Keep pipeline pure + cheap; memoize `hydrate` on a hash of the decisions blob; only the active tab hydrates the parts it shows. |
| **ARCH-9** ★★ `[S][R]` | **Choice model is generic & first-class.** | Fighting styles, expertise picks, invocations, metamagic, maneuvers, subclass spells-you-choose, ASI-vs-feat, background ASI split — all are "pick N from a set, maybe swappable, maybe with prereqs." Modeling each ad-hoc explodes. | One shape: `choice = {id, source, prompt, type, count, from[], chosen[], swappableOn:'levelup'|'longrest'|null, prereq?}`. Stored in `featureChoices`. Leveling panel renders unresolved choices; engine validates count + prereqs. |

---

## 1. Spells — the heaviest section (the user's primary concern)

> **2024 baseline (confirmed):** *all* spellcasting classes now **prepare** spells. There is
> no "known caster" vs "prepared caster" split anymore — only **how many** you prepare (a
> fixed number from each class's table, *not* ability-mod-based) and **how often** you may
> swap (Wizard: all on a long rest, from spellbook; Ranger: 1 per long rest; Sorcerer/Bard/
> etc.: 1 on level-up). Warlock keeps **Pact Magic** (separate slots). Subclass/feat/species
> spells are **"always prepared"** and do **not** count against the limit and **cannot** be
> swapped.

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **SP-1** ★★★ `[S]` | **Spell provenance / origin tagging.** Every spell has a source: class grant, subclass (always-prepared), feat (Magic Initiate / Fey Touched…), species (Elf cantrip, Tiefling/Aasimar legacy), background, magic item, **copied into spellbook** (Wizard), or **manually added** homebrew. | The user explicitly wants extra/manual spells *visually separated* from granted ones, and copied-from-another-spellbook spells *marked as such*. Impossible without per-spell origin. | Each spell is a record: `{ ref, origin:'class'|'subclass'|'feat'|'species'|'background'|'item'|'copied'|'manual', source:{id,label}, ... }`. Granted entries are **derived from decisions** (engine emits them); `copied`/`manual` are **stored decisions** the user added. UI groups by origin; copied gets a 📖 badge, manual gets an "extra" group. |
| **SP-2** ★★★ `[R][S]` | **Known vs Prepared vs Always-Prepared.** Prepared limit is a fixed per-class number; always-prepared (subclass/feat) are excluded from it and locked. | Mixing them double-counts the limit or lets users un-prepare a domain spell. The "boxes" UI needs to know exactly how many free prepared slots exist. | Engine computes `preparedLimit[class]` from class table. `alwaysPrepared:true` entries render **pinned/locked** outside the boxes. The drag-into-boxes target count = `preparedLimit`; only `origin:'class'` + chosen spellbook spells are draggable. |
| **SP-3** ★★★ `[S]` | **Forced duplicate / already-known.** Normally you can't learn a spell twice; but subclass/species/feat/origin interactions *can* force a duplicate (e.g., a subclass grants a spell you already prepared as a class spell). | The user's exact requirement: prevent normal re-learning, **allow** forced duplicates, **color** them in edit mode. Also the legitimate "two ways to cast" case (innate 1/day **[USE]** + slot **[CAST]**) — D&D Beyond literally renders both. | Dedupe by `ref` **for casting/display** but keep separate provenance entries. When a grant collides with an existing entry, set `duplicate:true` + keep both; editor renders the dup in a warning color with a tooltip naming both sources. If the granting feature says "if you already know it, choose another," surface a **substitution choice** (ARCH-9) instead of a silent dup. |
| **SP-4** ★★★ `[R][S]` | **Casting ability is per-granting-class.** A spell prepared via Cleric uses WIS; the *same spell* via Wizard uses INT — different save DC and attack bonus. | Multiclass casters have multiple DCs simultaneously; a single `castingAbility` field is wrong. | Each prepared/known entry carries `castingClass`. Engine computes `saveDC`/`attack` **per class** (`8 + PB + abilityMod[class]`). Spell cards show the DC of the class they're prepared under. |
| **SP-5** ★★★ `[S][R]` | **Wizard spellbook ≠ prepared list.** The spellbook is the *learned pool* (large, grows via leveling **and** copying from scrolls/other books at gp+time cost); prepared is the daily subset chosen from it. | Conflating them breaks the whole Wizard fantasy and the "copied" marking. Spellbook capacity is effectively unbounded; prepared is capped. | Wizard gets a distinct `spellbook[]` decision list (entries with `origin:'class'` free-on-levelup or `origin:'copied'`). Prepared set is chosen *from* spellbook. Spellbook tab shows the book; the prep boxes draw from it. Non-wizard prepared casters prepare directly from the class list (no book). |
| **SP-6** ★★ `[R][S]` | **Ritual casting.** Wizards cast ritual-tagged spells from the **spellbook without preparing**; other classes only if the ritual is prepared; some need a Ritual Caster feat. | A ritual-castable spell shouldn't consume a prepared slot for a wizard, but should be castable. | Spell metadata `ritual:true`. Engine exposes `canCastAsRitual(entry, class)`. UI shows a 🕮 ritual affordance; ritual-only access doesn't occupy a box. |
| **SP-7** ★★ `[S][R]` | **Cantrips are a separate track.** Always known, never prepared, don't count against the limit; count grows by class table; some classes/species can **swap one on level-up**. | Folding cantrips into the prepared list miscounts boxes and breaks scaling. Cantrip damage scales by **character level** (5/11/17), *not* class level — a classic trap. | Separate `cantrips[]` with `cantripsKnown[class]` limit from the engine. Cantrip damage tier uses **total level**. Swap modeled via the choice model with `swappableOn:'levelup'`. |
| **SP-8** ★★ `[R]` | **Half/third casters & "no spells yet."** Paladin/Ranger get spells at L2; Eldritch Knight/Arcane Trickster at L3; their prepared count and slots come from half/third progressions. | A fresh Paladin 1 has spell slots = none and prepared = 0; the spellbook tab must handle the empty/early state without looking broken. | Engine per-class spell progression tables (full/half/third). `preparedLimit` and slots may be 0 → spellbook tab shows "no spells at this level yet" rather than empty boxes. |
| **SP-9** ★★ `[R][S]` | **Warlock Pact Magic.** Separate slot pool (few slots, all the same level, **short-rest** refresh); **Mystic Arcanum** (fixed 6th–9th spells, 1/long rest) at high levels; multiclass interplay lets Pact slots cast other classes' prepared spells and vice-versa. | Pact slots are *not* on the multiclass combined-slot table; modeling them as normal slots is wrong. | Engine emits `pactSlots:{level, count}` separately from `spellSlots[]`. Mystic Arcanum = `alwaysPrepared` entries with `uses:{freq:'1/long'}`. Spell card shows which slot pool can fuel it. |
| **SP-10** ★★ `[S][R]` | **Innate / at-will / X-per-day spells without slots.** Species (Tiefling/Aasimar legacy) and feats (Fey Touched, Magic Initiate's free cast) grant spells castable a fixed number of times **without** slots, often **plus** with slots, with a **chosen casting ability** fixed at selection. | These coexist with the same spell prepared normally → the **[USE] vs [CAST]** duplicate (SP-3). They don't touch the prepared limit. | Entry `uses:{type:'innate', freq:'1/long'|'atwill', castWithSlots:bool}`, `castingAbility` stored on the entry (chosen when the feat was taken). Always-prepared, off-limit. |
| **SP-11** ★★ `[S]` | **Spell-swap cadence on level-up / long rest.** Replace one class spell on level-up (most classes), Wizard adds 2 free to spellbook per level, Ranger swaps 1/long rest. | Letting users freely edit the granted set hides the rules and loses the "what changed this level" story the leveling panel wants to tell. | The leveling panel presents swap as an explicit action gated by `swappableOn`. Granted-by-class spells are swappable; always-prepared are not. Keep an optional `swaps[]` log for the level history. |
| **SP-12** ★★ `[R][C]` | **"Added to your list" vs "always prepared."** Some features *add spells to the list you may choose from* (you still prepare them, costing a slot of prep); others make them *always prepared* (free). 2024 subclass spells are the latter; some feats/2014 subclasses the former. | Treating "expands your options" as "always prepared" gives free preparation the player didn't earn. | Compendium grant distinguishes `grant:'alwaysPrepared'` vs `grant:'addToList'`. `addToList` spells appear as *eligible* in the picker (tagged with their source) but still occupy a prepared box if chosen. |
| **SP-13** ★ `[R][S]` | **Feature-modifies-cantrip.** Agonizing Blast adds CHA to each Eldritch Blast beam; other invocations/feats buff specific spells. | The damage shown on a spell card depends on an *unrelated* choice (an invocation). | Engine applies spell-targeted modifiers (provenance-tagged) when assembling the card. Low priority until automation; design the modifier target to allow `spell:<id>`. |
| **SP-14** ★★ `[S]` | **Prune dangling prepared refs.** Removing a level/feat/subclass removes its granted spells; a prepared selection that pointed at a now-absent spell must not crash or silently persist. | De-leveling or swapping subclass is common during build; stale refs throw in render. | Prepared set stored as refs; on hydrate, intersect with the currently-available pool; drop missing with an `info` warning. Manual/copied spells survive (they're independent decisions). |
| **SP-15** ★ `[S]` | **Homebrew / names-only spells.** v1 ships spells as **names + minimal metadata only**. The user must be able to add a spell by name with no compendium entry. | If the UI gates on prose/level existing, half the system is unusable in v1. | `manual` origin spells store a free-text `name` (+ optional level/school). Everything (prep, provenance, dedup) keys on a `ref` that is either a compendium id or a normalized name. Never block on missing data. |
| **SP-16** ★★ `[S][R]` | **Concentration & one-at-a-time / spell save DC display.** Sheet should surface concentration, components (V/S/M), ritual, and the correct DC per class. | Players track concentration constantly; wrong DC on multiclass is a silent error. | Card metadata flags; DC from SP-4. Concentration is display-only in v1 (no live tracking), but the field should exist on the card model. |

---

## 2. Ability scores

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **AB-1** ★★★ `[R][C]` | **2024: backgrounds grant the ASI, species grant none.** Background lists three abilities; you take **+2/+1** or **+1/+1/+1** among them. | The single biggest 2014→2024 trap. Applying species ASIs (muscle memory / 2014 data) double-buffs; not applying the background ASI under-buffs. | Background record declares `abilityOptions:[...]` + the +2/+1-or-+1/+1/+1 rule; stored as a **choice** with provenance. Species records carry **no** ASI in 2024. Engine refuses to apply species ASI when `edition:'2024'`. |
| **AB-2** ★★★ `[R]` | **Bonus sources stack with provenance, cap at 20.** Base + background ASI + ASI-feats + half-feats (+1). Normal max 20. | Need to sum *and* know each contributor for the "where from" tooltip and for cap logic. | Engine sums provenance-tagged `+N` bonuses then clamps to `cap` (default 20). Each contributor retained for display. |
| **AB-3** ★★ `[R][C]` | **Items that *set* a score (override, not add).** Gauntlets of Ogre Power → STR 19; Headband of Intellect → INT 19; Belt of Giant Strength → 21–29. | A *set* is `max(current, value)` semantics (RAW it sets; tools treat as "no effect if already higher"), applied **after** additive bonuses and **outside** the 20 cap. Mixing it into the additive sum is wrong. | Modifier op `setScore` resolved last; final = `max(additiveResult, setValue)`. Only when the item is **worn (+attuned if required)** (links to EQ-3). |
| **AB-4** ★★ `[R]` | **Cap-raising effects.** Epic Boons (L19+) and Manuals/Tomes raise the max **above 20** (often to 22+ / specific). | Hard-coding cap=20 blocks legal high-level scores. | `cap` is itself a modifiable value per ability (default 20, raised by tagged effects). Clamp uses the per-ability cap. |
| **AB-5** ★ `[S]` | **Entry method (point-buy / standard array / rolled / manual).** | Standalone players want any of these; validation (e.g., point-buy legality) is optional and must not block. | Store `baseStats` raw + `method` metadata. Offer optional point-buy helper in the editor; never enforce. |
| **AB-6** ★★ `[R]` | **Order of operations.** base → background ASI → feats/ASIs → cap → set-items → cap-raisers. | Apply cap before set-items and you wrongly clamp a Belt; apply set before additive and a +1 feat is lost. | Pin the pipeline order in the engine and document it next to the code. |

---

## 3. Proficiencies, skills, expertise, saves

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **PR-1** ★★★ `[R][S]` | **Duplicate proficiency → substitute.** RAW: if two sources grant the same skill/tool prof, you may take a **different one of the same kind** instead. (Confirmed; D&D Beyond implements this *inconsistently*.) | Silently dropping the dup wastes a pick the player is owed; silently keeping both is a no-op that hides the wasted choice. | Engine detects overlap among provenance-tagged prof grants; emits a **substitution choice** (ARCH-9) for the later source ("Stealth already covered — pick another"). Until resolved, flag with an `info` warning. |
| **PR-2** ★★★ `[R][S]` | **Expertise (double proficiency).** Rogue/Bard + feats; requires being proficient first; some features grant prof **and** expertise together. | Expertise applied to a non-proficient skill, or stacked twice, computes wrong. Expertise ≠ "proficient twice"; it doubles **PB**. | Skill state enum `none|proficient|expertise`; `expertise` implies `proficient`. Total = `mod + (expertise ? 2 : proficient ? 1 : 0) × PB`. Track sources; a second expertise on the same skill is wasted → substitution choice. |
| **PR-3** ★★ `[R]` | **Jack of All Trades (Bard).** Half PB (round down) to ability checks you're **not** proficient in (and to initiative). | It's a global modifier to *non-proficient* checks — interacts with PR-2 boundaries and with initiative (IN-?). | Engine flag `halfProfToNonProficient`. Applied to skill/ability checks where state is `none`, and to initiative. |
| **PR-4** ★★★ `[R]` | **Multiclass saving throws — first class only.** When you multiclass, you gain **saving-throw** proficiencies only from your **first** class, not the new one. | A naive "union of class saves" gives illegal save proficiencies. | Engine applies save profs only from `classes[0]`. (Skill/tool/armor/weapon profs from multiclass use a *reduced* list — PR-5.) |
| **PR-5** ★★ `[R][C]` | **Reduced multiclass starting proficiencies.** Multiclassing into a class grants a **subset** of its starting proficiencies (e.g., only some armor/weapons), distinct from creating at level 1 in it. | Granting full starting proficiencies on multiclass is a common over-grant. | Class record carries both `startingProficiencies` and `multiclassProficiencies`; engine picks based on whether the class is `classes[0]`. |
| **PR-6** ★★ `[R]` | **Proficiency bonus from total level.** PB scales with **character (total) level**, not per-class level. | Multiclass PB computed per-class is wrong (e.g., Wizard 3 / Rogue 2 = PB +2 at level 5, not +2 and +2). | `PB = 2 + floor((totalLevel-1)/4)` using summed levels. |
| **PR-7** ★ `[R][S]` | **Half-proficiency rounding & tool/skill split.** | Round-down surprises; tools vs skills are different kinds for PR-1 substitution. | Centralize rounding in the engine; keep `skills`, `tools`, `weapons`, `armor`, `languages`, `saves` as distinct proficiency kinds. |

---

## 4. Armor Class & defenses

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **AC-1** ★★★ `[R][C]` | **Competing base-AC formulas — take the best, don't stack.** Worn armor (`baseAC + cappedDex`), Unarmored Defense Barbarian (`10+DEX+CON`), Monk (`10+DEX+WIS`), Draconic Sorcerer (`13+DEX`), Mage Armor (`13+DEX`), natural armor. You use **one** base; everything else adds on top. | Summing two bases (the #1 AC bug) inflates AC. Each formula also has **prerequisites** (Barb UD: no armor; Monk UD: no armor **and no shield**). | Engine collects all *eligible* base formulas (prereqs checked vs equipped items), computes each, picks `max` (or lets the user pick when tied). Compendium declares each as `acFormula:{base, addAbilities:[], dexCap?, requires:{noArmor?, noShield?}}`. |
| **AC-2** ★★★ `[C][R]` | **Dex cap by armor type.** Light = full DEX; Medium = +DEX max 2 (Medium Armor Master → 3); Heavy = no DEX. | Forgetting the cap over-counts AC for medium/heavy. | Armor record `dexCap` (null/2/0); feat can raise it. Engine applies cap to the DEX term of the chosen formula only. |
| **AC-3** ★★ `[R]` | **Stacking bonuses on top of base.** Shield (+2, one only), Fighting Style: Defense (+1 in armor), Ring/Cloak of Protection (+1, needs attunement), cover, **Shield spell (+5 reaction, conditional)**. | Conditional ones (Shield spell, cover, rage) shouldn't be baked into the resting AC but should be togglable. | `AC = chosenBase + shield + Σ(flat, provenance-tagged)`. Mark conditional bonuses `conditional:true`; combat tab shows them as toggles (links to CX-1). |
| **AC-4** ★★ `[R]` | **Unarmored Defense voided by armor/shield.** Barb UD off if wearing armor; Monk UD off if armor **or** shield. | If the user equips armor, the UD formula must drop out of the AC-1 candidate set automatically. | Prereq evaluation in AC-1 reads the live equipped set; equipping body armor removes the UD candidate. |
| **AC-5** ★ `[R][C]` | **Heavy-armor STR requirement & stealth disadvantage.** Below `strReq` → speed −10; many heavy/medium armors impose stealth disadvantage. | Silent if not surfaced; affects speed (HP-adjacent) and skill rolls. | Armor `strReq`, `stealthDisadvantage`. Engine emits a speed modifier + a display flag + a `soft` warning. |
| **AC-6** ★★ `[S]` | **Manual AC override (standalone).** | No-rules mode must let users just type their AC. | `overrides.ac` wins (ARCH-3); `↺ auto` clears to the computed value when rules return. |

---

## 5. Hit points

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **HP-1** ★★★ `[R]` | **CON-mod change is retroactive across all levels.** Raising CON at L4 adds HP to **every** level; lowering removes it. | Persisting maxHp (ARCH-1 violation) freezes the wrong number; recomputing naively per-level off the *current* CON only is actually correct *if* you always recompute. | `maxHp = Σ_levels(perLevelBase) + CONmod × totalLevel + Σ(perLevelBonuses)`. Always recompute from decisions; never store maxHp except as an override. |
| **HP-2** ★★★ `[R][C]` | **Per-class hit dice & the special first level.** L1 of the build = **max** hit die of the **first** class + CON; every other level (including the first level of a *second* class) = average (round up, d10→6) or rolled, + CON. | Multiclass HP miscomputes if you take max die for each class's first level, or use the wrong die. | Track `hitDie` per class (from compendium). Engine: first character level special-cases `classes[0]`; all others use avg/rolled by that level's class die. |
| **HP-3** ★★ `[R][C]` | **Per-level HP bonuses.** Tough feat (+2 × total level, retroactive & future); 2014 Hill Dwarf / Draconic Sorcerer (+1/level). | These are `× level`, so they must be in the per-level sum, not a flat add. | Feat/species grant `hpPerLevel:+N`; engine multiplies by total level inside the HP-1 sum. |
| **HP-4** ★★ `[S]` | **Average vs rolled vs manual.** | Players choose a method; rolled needs per-level storage; manual for hand-fill. | `hp:{ mode:'average'|'rolled'|'manual', rollsByClassLevel:{}, current, temp, deathSaves }`. `mode:'manual'` ⇒ `overrides.maxHp`. |
| **HP-5** ★ `[S]` | **Temp HP doesn't stack (take highest); current ≤ max; death saves.** | Temp HP added to max is a classic error; current must clamp. | Temp HP is a separate field, never added to max. Current clamps `[0, maxHp]` (existing `hp` action already does this — extend it). |

---

## 6. Multiclassing

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **MC-1** ★★★ `[S][R]` | **Classes are a list, not a string.** Current blob has `className` (string). Multiclass needs ordered `[{classId, level, subclass, choices}]`. | The single most structural change. First-class order matters (saves, HP, UD). | `classes:[{classId, level, subclass, featureChoices, asiChoices, hitDieRolls}]`. `classes[0]` is the origin class. Migrate the old string in (ARCH-6). |
| **MC-2** ★★★ `[R]` | **Combined caster level → spell slots.** Sum full-caster levels + ⌈half⌉ Paladin/Ranger + ⌊third⌋ EK/AT, index the multiclass slot table. **Pact Magic is separate** (not on the table). | Per-class slot tables summed give wrong slots; Pact slots wrongly merged. (Confirmed via rules research.) | Engine `multiclassCasterLevel()` → slot table lookup → `spellSlots[]`; `pactSlots` computed separately and exposed alongside. |
| **MC-3** ★★ `[R]` | **Prepared spells per class, independently.** Each class's prepared count & list computed as if single-classed; max *preparable* spell level capped by that class's level even when higher slots exist. | A Wizard 3 / Cleric 1 can't prepare 2nd-level cleric spells even with a 2nd-level slot from the combined table. | `preparedLimit` and `maxPreparedLevel` per class; slots are shared, prep is siloed. Spell cards note which class a spell is prepared under (SP-4). |
| **MC-4** ★★ `[R][C]` | **"Max, not sum" features.** Extra Attack does **not** stack across classes (Fighter 5 / Ranger 5 ≠ 4 attacks); Unarmored Defense from two classes doesn't stack; similar "you already have this" features. | Summing duplicated features is a real rules bug that inflates power. | Compendium flags such features `nonStacking:true` / `stackRule:'max'`; engine dedupes by feature key keeping the best. |
| **MC-5** ★ `[R]` | **Multiclass prerequisites.** Minimum ability scores to enter/leave a class. | Should warn, never block (DM override). | Engine emits a `soft`/`illegal` warning if prereqs unmet; leveling panel shows it. |
| **MC-6** ★★ `[R]` | **ASIs are per-class progression.** Each class grants ASIs at its own 4/8/12/16/19; a multiclass char hits them at different total levels. | Counting ASIs off total level mis-grants them. | ASI availability derived per class from its level; the leveling panel offers each ASI/feat at the right class level. |

---

## 7. Equipment, weapon mastery, attunement (Combat + Backpack tabs)

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **EQ-1** ★★★ `[S]` | **Item location: equipped / ready / pack.** The user's tab split is exactly this: Combat tab = equipped armor+weapons + "on-ready" gadgets (potions); Backpack = everything else. | The split *is* a data field; bolting it on later means re-tagging every item. | Each inventory entry: `location:'equipped'|'ready'|'pack'`, optional `equippedSlot`. Combat tab renders `equipped`+`ready`; Backpack renders all (or `pack`). One source of truth, filtered per tab. |
| **EQ-2** ★★★ `[R][S]` | **Only equipped items affect derived stats.** Armor in the pack shouldn't change AC; an unattuned ring grants nothing. | Computing AC/attacks off the whole inventory double-counts and leaks pack items into stats. | Engine reads only `location:'equipped'` (and `attuned` where required) when deriving AC/attack/score-set items. |
| **EQ-3** ★★ `[S][R]` | **Attunement (limit 3, required by some items).** Many magic items grant their bonus **only when attuned**; you can attune to at most 3. | Over-attunement and "bonus without attunement" are both common errors. | Entry `attuned:bool`, item `requiresAttunement:bool`. Engine: ignore the magic bonus unless attuned; emit `illegal` warning if `attunedCount > 3`. |
| **EQ-4** ★★★ `[R][C][S]` | **Weapon Mastery (2024).** Each weapon has one of 8 mastery properties (Cleave/Graze/Nick/Push/Sap/Slow/Topple/Vex). A character can *use* mastery only on a chosen set of weapons (Fighter 3, Barb/Pal/Ranger/Rogue 2, growing; Weapon Master feat +1), swap one per long rest. | New 2024 system with no 2014 equivalent — easy to omit entirely. Combat tab must show it. | Compendium weapon record carries `mastery`. Engine computes `masterySlots` per build. `weaponMastery:[weaponTypeId]` decision list (size ≤ slots). Combat tab: weapon card shows its mastery and whether it's *active* (chosen). Swap = a choice. |
| **EQ-5** ★★ `[R][C]` | **Weapon attack/damage assembly.** Ability (STR melee / DEX ranged / **finesse = better of the two**), proficiency, magic +N, fighting style (Archery +2 hit, Dueling +2 dmg, TWF adds mod to offhand), versatile/thrown, ammo. | A weapon card's numbers depend on several unrelated choices; hand-rolling per weapon is error-prone. | Engine `weaponAttack(entry)` reads weapon properties + relevant choices, returns `{toHit, damage[], notes}` with provenance. Finesse picks `max(STRmod, DEXmod)`. |
| **EQ-6** ★ `[S]` | **Containers, quantity, consumables, charges, currency.** Bag of Holding nesting; 50 arrows as one stack; potions decrement; wands with charges; cp/sp/ep/gp/pp. | Backpack realism; consumable count is a live-play need. | Entry `qty`, `container` (parent entry id), `charges:{cur,max,recharge}`, plus a `currency` block on the sheet. Encumbrance is an **optional** variant — compute weight, don't enforce. |
| **EQ-7** ★ `[S]` | **Worn-slot soft validation.** One body armor, one shield, two rings, etc. | Equipping two suits of armor should warn, not corrupt AC (AC-1 already takes the best). | Soft `info` warnings only; never block. AC-1's max-of-bases already tolerates nonsense. |
| **EQ-8** ★★ `[S]` | **Manual / homebrew items (standalone).** | No-compendium mode must allow free-text items with hand-typed AC/damage. | `manual` items store free-text name + optional `acFormula`/`damage`/`mastery`; engine consumes structured fields when present, ignores when absent. |

---

## 8. Class features, resources, choices, leveling

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **FE-1** ★★★ `[S][R][C]` | **Level-up choices are pervasive & varied.** Subclass (L3), fighting style (no duplicates), expertise picks, ASI-vs-feat, Metamagic, Eldritch Invocations (prereqs + swap), Battle Master maneuvers, Pact Boon, spell/cantrip picks. | Each is "choose N from a set, maybe with prereqs, maybe swappable." Bespoke handling per feature is unmaintainable and is the core of the leveling panel. | The generic **choice model** (ARCH-9). Compendium feature declares `choices:[{type, count, from, prereq, swappableOn}]`; engine validates; leveling panel renders unresolved ones. "No duplicate fighting style" etc. = a `unique:true` flag. |
| **FE-2** ★★ `[R][C]` | **Scaling features.** Sneak Attack dice, Rage count/damage, Martial Arts die, Bardic Inspiration die, Channel Divinity uses, Sorcery/Ki points, Superiority dice, Lay on Hands pool, Wild Shape uses. | These are level-indexed numbers the sheet should show and the resource tracker needs maxes for. | Compendium progression tables per class/subclass; engine resolves the value at the current level. |
| **FE-3** ★★ `[S][R]` | **Resource pools with recharge.** Most of FE-2 are spendable pools (max + short/long-rest recharge). | The combat/overview tab wants live "3/5 Rage" counters; need max from engine + current as a decision. | `resources:{<key>:{current}}` stored; `max` + `recharge` from engine. Generic pool widget. |
| **FE-4** ★★ `[S]` | **Swappable choices on level-up.** Swap a maneuver/invocation/metamagic/cantrip/spell or fighting style (via feat). | Same surface as FE-1 but the action is "replace," and the level history should record it. | `swappableOn` drives a swap action in the leveling panel; optional `history[]` for the level log. |
| **FE-5** ★ `[R][C]` | **Subclass timing & subclass-changes-everything.** All 2024 subclasses chosen at L3; switching subclass mid-build invalidates dependent choices/spells. | Offering subclass features before L3, or leaving orphaned thief-only picks after switching to assassin. | Gate the subclass choice at the class's subclass level; on subclass change, re-run choice validation and prune/flag orphans (mirrors SP-14). |
| **FE-6** ★ `[R]` | **Features that grant feats / Epic Boons.** Some L19 features grant an Epic Boon (a feat category with its own prereqs). | A feat granted by a feature shouldn't consume an ASI slot. | Feat grants carry provenance `source:'feature'` vs the ASI-slot feats; engine doesn't bill them against ASI count. |

---

## 9. Species, background, feats

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **SB-1** ★★★ `[R][C]` | **2024 Background = ASI + Origin feat + skills + tool + equipment.** | Backgrounds carry a *lot* of mechanics now (AB-1) including a granted **feat**. Modeling them as flavor text loses all of it. | Background record: `abilityOptions`, `originFeat`, `skillProfs`, `toolProf`, `equipment`. All emitted as provenance-tagged grants/choices. |
| **SB-2** ★★ `[C][R]` | **Feat categories & prerequisites.** Origin / General / Fighting Style / Epic Boon, each with prereqs (level, ability, proficiency, a prior feature). | A General feat offered at L1, or an Epic Boon before L19, is illegal. Repeatable feats (Weapon Master; Resilient once per ability; Elemental Adept once per damage type) need uniqueness tracking. | Feat record `category`, `prerequisites`, `repeatable:{by:'ability'|'damageType'|null}`. Engine validates category-vs-source and prereqs; repeatable tracks the discriminator. |
| **SB-3** ★★ `[C][R]` | **Species traits with choices & scaling.** 2024 Elf lineage (Drow/High/Wood) grants senses + spells that scale and a swappable cantrip; sizes; multiple speeds (walk/fly/swim/climb). | Lineage choice changes grants; multiple movement modes don't fit a single `speed:int`. | Species `lineages:[...]` (a choice); `speeds:{walk,fly,swim,climb}`; spell grants via the spell pipeline with `swappable` where noted. |
| **SB-4** ★★ `[R]` | **Senses & resistances from multiple sources — take highest / dedupe.** Darkvision 60 + 120 → 120 (not 180); two sources of poison resistance → still just resistance (never auto-immunity). | Summing darkvision or stacking resistance to immunity are classic errors. | Engine `max` for ranged senses; resistance/immunity as a **set** keyed by damage type (presence, not count). |
| **SB-5** ★ `[R][C]` | **Size effects.** Small creatures have disadvantage with Heavy weapons; size affects carrying/grapple. | Minor but real; affects EQ-5 for Small species. | Species `size`; engine applies the Heavy-weapon-disadvantage flag for Small. |
| **SB-6** ★ `[R][C]` | **ED — 2014 carryovers.** Variant Human / Custom Lineage grant a L1 feat + ASIs; 2014 species grant ASIs. | If 2014 content is ever loaded, these conflict with the 2024 no-species-ASI rule (ARCH-7). | Keep 2014 content out of v1 pickers, or gate its grants behind `edition:'2014'` engine branches. |

---

## 10. The tab UI & dynamic behavior (mapping your spec to the rules above)

> Your described tabs and their dynamic visibility, made precise. Tab set adapts to
> (a) whether **core-rules + compendium** are installed and (b) the character's content.

| ID | Item | Decision / behavior |
|---|---|---|
| **UI-1** ★★★ `[S]` | **Tab set.** | `Overview` (always) · `Sheet/Combat` (always) · `Spellbook` (conditional, UI-4) · `Backpack` (always) · `Leveling` **or** `Editor` (mutually exclusive, UI-3). |
| **UI-2** ★★★ `[S]` | **No-rules mode = everything editable inline.** | With no engine: every tab renders in *modification mode* (free-text class/race, manual numbers, manual skill toggles, unenforced spell list, manual items). There is **no** separate Editor tab needed because the tabs themselves are editable — but keep one consolidated **Editor** tab too for bulk entry. |
| **UI-3** ★★ `[S]` | **Sheet ↔ Leveling swap when rules present.** | With the engine, the manual *Sheet* editing affordances are replaced by a guided **Leveling** panel (add a level → engine presents that level's choices/grants → user picks). The read-only combat *view* stays on the Sheet/Combat tab; the *building* moves to Leveling. **Name suggestions:** "Level Up", "Advancement", "Progression", "Builder", "Class & Levels". (Recommend **"Level Up"** — it's the verb players use.) |
| **UI-4** ★★★ `[S][R]` | **Spellbook visibility predicate.** | Show the Spellbook tab iff **any** of: the build has a spellcasting class/subclass (preparedLimit or cantrips > 0), **or** a feat/species/item grants any spell/cantrip, **or** the user has added a manual/copied spell. Pure non-caster with zero spell grants → no tab. |
| **UI-5** ★★ `[S][R]` | **Preparation UI gating.** | Since all 2024 casters prepare: show the **drag-into-boxes** prep UI when `preparedLimit > 0`. A character whose only spells are innate/at-will (feat/species, no prepared casting) → show a simple **card list, no boxes**. Always-prepared spells render pinned outside the boxes (SP-2). |
| **UI-6** ★★ `[S]` | **Spell cards + DnD prep.** | Spells render as small cards (name, level, school, C/ritual/components badges, DC per class). Preparation = drag a card from the available pool into one of `preparedLimit` boxes; backspace/drag-out unprepares. Cards grouped by origin (SP-1); copied 📖 and manual "extra" groups visually separated; forced duplicates colored (SP-3). |
| **UI-7** ★★ `[S]` | **Edit vs view mode per tab.** | Reuse the host's per-page edit affordance pattern (the host retired global edit mode for per-page toggles). Each tab has a view render and an edit render; the Spellbook's "add extra spell / copy into spellbook / mark forced duplicate color" lives only in edit mode. |
| **UI-8** ★ `[S]` | **Anonymous / role gating.** | Honor the host's auth: editing affordances visible but click → login modal for anonymous (the host already does this). Sheet view is readable per the character's visibility. |

---

## 11. Implied `CharacterData` v2 shape (the actionable payoff)

This is what the edge cases above force the persisted blob to become. **Decisions only** —
everything derived is computed by `hydrate`. (Compare to today's flat blob in
`entry.js blank()`.)

```jsonc
{
  "v": 2,
  "ruleset": "2024",

  "identity": {
    "ancestry": "", "ancestrySubtype": "", "background": "",
    "alignment": "", "playerName": "", "size": "Medium"
  },

  "baseStats": { "STR":10,"DEX":10,"CON":10,"INT":10,"WIS":10,"CHA":10,
                 "method": "manual" },                 // pointbuy|array|rolled|manual

  // every ability bonus/set, provenance-tagged (AB-1..AB-4)
  "abilityGrants": [ { "source":{"type":"background","id":"sage"},
                       "op":"add", "assign":{"INT":2,"WIS":1} } ],

  "classes": [                                          // ORDERED; [0] = origin (MC-1)
    { "classId":"wizard", "level":3, "subclass":"evoker",
      "hitDieRolls": {}, "featureChoices": {}, "asiChoices": [] }
  ],

  "feats": [ { "featId":"fey-touched", "source":{"type":"asi"},
               "choices": { "ability":"INT", "spell":"misty-step",
                            "castingAbility":"INT" } } ],

  // ⚠ DESIGN-TIME PROPOSAL — the SHIPPED blob differs: `preparedSpells` and
  // `cantrips` (both keyed by classId) live at the TOP level of the blob, and
  // manual/copied entries live in a top-level `spells[]` with an `origin`
  // field. `model.js` + entry.js are the truth for stored field names.
  "spells": {                                           // §1
    "entries": [                                        // granted entries are DERIVED;
      // only copied/manual are stored here as decisions:
      { "ref":"fireball", "origin":"copied",
        "source":{"type":"scroll"}, "inSpellbook":true }
    ],
    "spellbook": ["fireball","magic-missile"],          // Wizard learned pool (SP-5)
    "prepared": { "wizard": ["fireball","mage-armor"] },// per class (MC-3)
    "cantrips": { "wizard": ["fire-bolt","prestidigitation"] }, // (SP-7)
    "swaps": []                                         // optional level-log (SP-11)
  },

  "inventory": [
    { "id":"inv1", "ref":"breastplate", "qty":1,
      "location":"equipped", "attuned":false },          // EQ-1..EQ-3
    { "id":"inv2", "name":"Potion of Healing", "qty":2,
      "location":"ready" },
    { "id":"inv3", "ref":"longsword", "qty":1, "location":"pack" }
  ],
  "weaponMastery": ["longsword","dagger"],               // EQ-4 (size ≤ engine slots)
  "currency": { "cp":0,"sp":0,"ep":0,"gp":0,"pp":0 },

  "hp": { "mode":"average", "current":0, "temp":0,
          "rollsByClassLevel": {}, "deathSaves":{"s":0,"f":0} },  // §5

  "resources": { "rage": { "current": 0 } },             // FE-3 (current only; max derived)

  "conditions": [],                                      // active toggles (CX-1)
  "overrides": { "maxHp":null, "ac":null, "speed":null,  // ARCH-3
                 "initiative":null, "skills":{}, "saveDC":{} },
  "manual": { "className":"", "raceName":"" }            // ARCH-4 standalone free-text
}
```

`featureChoices` / `asiChoices` / each `choice` follow the generic ARCH-9 shape.

---

## 12. Cross-cutting: conditional & combat-time modifiers

| ID | Item | Why it bites | Solution |
|---|---|---|---|
| **CX-1** ★★ `[S][R]` | **Conditional modifiers (raging, Shield spell, Bless, cover, Reckless, Dueling-while-1H).** | Baking them into resting stats is wrong; ignoring them means the combat tab can't show "AC while Shield is up". | `conditions:[...]` toggles on the Combat tab; engine exposes both resting and "with active conditions" values. Provenance-tagged so toggling explains the delta. |
| **CX-2** ★ `[R]` | **Initiative modifiers.** DEX + Jack of All Trades (½PB) + feats (Alert in 2024 adds PB) + Bless etc. | Initiative isn't just DEXmod. | Engine `initiative()` composes DEXmod + flags (PR-3) + feat bonuses. |
| **CX-3** ★ `[S][R]` | **Attached creatures (familiar / companion / wildshape / summons).** | Beast Master pet, Wildshape forms, Find Familiar, Drakewarden, summons each need a mini stat block. Out of v1 scope (bestiary stubs) but the model shouldn't preclude it. | Reserve an optional `companions:[]` on the sheet; defer rendering to a later bestiary-backed phase. Don't paint into a corner. |

---

## 13. Resolved decisions (locked 2026-06-28)

1. **Edition scope** — **2024-only.** 2014 rules/compendium will be *separate* addons for a different campaign (so no edition-coexistence work in these three; `ARCH-7`/`SB-6` are dropped from scope, but keep the `ruleset:'2024'` tag as a forward marker).
2. **Leveling tab name** — **"Builder."** (`UI-3`.)
3. **Sequence** — **tabbed *manual* sheet first** (standalone, no engine), behind the v2 data shape; engine/automation layers in afterward without reshaping data.
4. **Edit model** — **inline-editable tabs when standalone; when core-rules + compendium are present, inline editing is DISABLED and all editing flows through the Builder tab** (which tracks the full progression — what was chosen at which level). See `DEG-1` for the removal edge case.

   > **Amended 2026-06-30 (host integration).** After researching the host, the UI was reworked to fit it instead of duplicating it: the addon no longer adds a standalone section + its own "edit mode" button. It **replaces the host's `characters:body` fragment** (`registerFragmentOp` · replace) with a tab strip — the host's lore becomes the **Overview** tab, and the host's side-card (name/portrait/species) + relationship sections stay native above. There is **no separate modification mode and no second edit button**: the host's own "✏ Upravit" owns identity/lore, and D&D editing is **direct and role-gated** (editors edit in the tabs / Builder; anonymous = read-only). The addon stops storing host-owned fields (`race`→`c.species`, lore→`c.description`) and dropped `registerEditorFields`. Engine-mode structural building still flows through the **Builder** tab (rightmost, editors only). Open follow-up: the Builder's mechanical species pick is still distinct from the host's free-text `c.species` (the addon can only write `addonData`).

Still open / deferred: encumbrance (info-only vs variant toggle) and resource trackers (Rage/Ki) — both cheap later, not v1-blocking.

---

## 14. Engine-removal degradation — the "perfect solution" (DEG-1)

> **Scenario.** With core-rules + compendium installed, the player builds a character through
> the Builder; the stored decisions are *references* into the compendium (`classId`, `subclass`,
> choice ids, spell/item ids) that only the engine can interpret. Remove the two addons and the
> raw decisions can't be resolved or computed — the sheet would look broken. The user asked
> whether there's something better than "discard" or "dump to plain text."

**There is, and it's strictly better than both: a materialized fallback snapshot.**

**DEG-1** ★★★ `[S][R]` — **Materialize a human-readable projection of the computed sheet on every Builder save.**

- While the engine is present, decisions remain the **source of truth** and are re-hydrated each
  render (ARCH-1). *Additionally*, each save writes a denormalized, fully-**resolved** snapshot of
  the computed sheet into a clearly-marked `fallback` block on the blob — final numbers (HP/AC/
  saves/skills), **resolved labels not ids** (class *names*, spell *names*, item *names*, prepared
  list, equipped set), and the notes. This block is **never read while the engine is present**.
- **Remove the engine →** `sheets` detects "no engine," stops hydrating, and renders from the
  `fallback` snapshot. The Builder tab disappears; inline editing re-enables; the character is now
  a **fully-functional hand-filled sheet, pre-populated with everything the engine last computed.**
  Zero data loss, no plain-text dump — it degrades into exactly the manual sheet it would have been.
- **Re-add the engine →** the dormant decisions are still there, so offer a one-time choice:
  *“Re-run the rules (discard manual edits)”* or *“Keep the manual sheet (ignore stored
  decisions).”* This makes the round-trip lossless in both directions.

This is the standard "materialized view for resilience" pattern: the cache is an explicit,
labelled fallback (`fallback`/`_materialized`), not a second source of truth, so it doesn't
violate ARCH-1. Cost is a little extra stored JSON per character — cheap, bounded, and the price
of lossless degradation. **Recommendation: adopt this; drop the discard/plain-text options.**

---

## 15. Host limitation found while wiring — RESOLVED (HOST-1)

**HOST-1** ★★★ — **`host.use()` originally only worked for a *declared hard dependency*** (the host
threw otherwise), but declaring one makes it **hard** (the host blocks the addon when the dep is
missing) — which would break the requirement that `dnd55e-sheets` installs and runs **standalone**.

**Fixed (2026-06-28):** added an **`optionalDependencies`** manifest field to the host (its own
codebase). Semantics: **ordering-only** — when the optional provider is present + compatible it's
load-ordered first so `host.use()` works; when it's absent / blocked / version-incompatible the
host doesn't load it and **never blocks** the dependent (an optional-edge cycle is broken, not
blocked). `host.use()` now accepts a dep declared as hard **or** optional. Wired through every seam:
`addon-deps.js planLoadOrder` (ordering edges), `addons.js use()`, `server/addons.cjs
validateManifest`, the registry + `_publicAddonList` + `versions[]` snapshot + rollback restore +
preview echo, and `scripts/dev-install-addon.cjs`. Covered by new tests in `test/addon-deps.test.mjs`
+ `test/addons.test.cjs` (full host suite green). `dnd55e-sheets/addon.json` now declares
`optionalDependencies: { "dnd55e-core-rules": ">=0.1.0" }`, so its lazy `getRules()` probe lights up
(and the Builder tab appears) automatically once `core-rules` ships.
```

> **2026-07-02 update:** the standalone `dnd55e-core-rules` addon was MERGED into this
> repo as the `rules/` module (the engine always ships with the sheet now). The
> optional dependency — and the `getRules()` probe — retarget to the book DATA addon:
> `optionalDependencies: { "dnd55e-players-handbook": ">=0.1.0" }`. The Builder tab and
> every engine-mode branch light up exactly when book data is installed; the host
> `optionalDependencies` mechanism described above is unchanged and still what makes
> the soft seam work.

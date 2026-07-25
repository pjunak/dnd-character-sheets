export const SPELL_ACTIONS = Object.freeze(['spellAdd','spellDel','learnCantrip','unlearnCantrip','prepSpell','unprepSpell','spellbookLearn','spellbookForget','spellMgrOpen','spellMgrClose','spellCopyPick','spellCopy','spellCustomAdd','spellSwapOpen','spellSwapClose','spellSwapApply','spellSwapForget','spellDragStart','spellDrop','grantPick','grantUnpick','spellSet']);

export function registerSpellActions(deps) {
  const { host, num, uid, mutate, getRules, safeHydrate, decisionsOf, scrollCopyCost, uiState } = deps;
  const register = (name, fn) => host.registerAction(name, fn);
  const hydrateFor = (sheet) => { const engine = getRules(); const result = engine ? safeHydrate(engine, decisionsOf(sheet, engine)) : null; return result && result.sheet; };
  // Spellbook — manual/extra entries (s.spells).
  register('spellAdd', (cid) => {
    mutate(cid, (s) => { s.spells = s.spells.concat([{ id: uid('spell'), name: '', level: 0, school: '', prepared: false, origin: 'manual' }]); return s; });
  });
  register('spellDel', (cid, sid) => {
    mutate(cid, (s) => { s.spells = s.spells.filter((sp) => sp.id !== sid); return s; });
  });
  // Engine-mode preparation (per class): cantrips + prepared picks.
  const addRef = (s, bag, classId, ref) => { const cur = (s[bag][classId] || []).slice(); if (ref && !cur.includes(ref)) cur.push(ref); s[bag] = { ...s[bag], [classId]: cur }; };
  const delRef = (s, bag, classId, ref) => { s[bag] = { ...s[bag], [classId]: (s[bag][classId] || []).filter((r) => r !== ref) }; };
  register('learnCantrip', (cid, classId, ref) => { mutate(cid, (s) => { addRef(s, 'cantrips', classId, ref); return s; }); });
  register('unlearnCantrip', (cid, classId, ref) => { mutate(cid, (s) => { delRef(s, 'cantrips', classId, ref); return s; }); });
  register('prepSpell', (cid, classId, ref) => { mutate(cid, (s) => { addRef(s, 'preparedSpells', classId, ref); return s; }); });
  register('unprepSpell', (cid, classId, ref) => { mutate(cid, (s) => { delRef(s, 'preparedSpells', classId, ref); return s; }); });
  // Wizard spellbook (SP-5): learn a spell into the book / remove it. Forgetting a
  // spell also unprepares it (you can't prepare a spell that's no longer in your book).
  register('spellbookLearn', (cid, classId, ref) => { mutate(cid, (s) => { addRef(s, 'spellbook', classId, ref); return s; }); });
  register('spellbookForget', (cid, classId, ref) => { mutate(cid, (s) => { delRef(s, 'spellbook', classId, ref); delRef(s, 'preparedSpells', classId, ref); return s; }); });
  register('spellMgrOpen', (cid, mode) => {
    uiState.set(cid, 'spellManagerMode', mode || 'other');
    host.ui.rerender();
  });
  register('spellMgrClose', (cid) => {
    uiState.remove(cid, 'spellManagerMode');
    uiState.remove(cid, 'spellCopySelection');
    host.ui.rerender();
  });
  register('spellCopyPick', (cid, ref) => {
    uiState.set(cid, 'spellCopySelection', String(ref || ''));
    host.ui.rerender();
  });
  // Copy a spell into the book: read the picked spell (+ optional scroll) at click
  // time, charge 50 gp × spell level (2024 copying cost), consume the scroll if one
  // was chosen, and add the ref to s.spellbook[classId] (→ preparable via B4.2b).
  register('spellCopy', (cid, classId) => {
    let ref = '', scrollId = '';
    try { const sp = document.getElementById('dse-copy-spell-' + cid); const sc = document.getElementById('dse-copy-scroll-' + cid); ref = sp && sp.value; scrollId = sc && sc.value; } catch (_) {}
    if (!ref) { host.ui.rerender(); return; }
    uiState.remove(cid, 'spellCopySelection');
    const engine = getRules();
    const rec = engine && engine.getItem ? engine.getItem('spell', ref) : null;
    const cost = scrollCopyCost(rec && rec.level);   // 50 gp × spell level (rules/engine.js)
    mutate(cid, (s) => {
      addRef(s, 'spellbook', classId, ref);
      s.currency = { ...s.currency, gp: Math.max(0, num(s.currency.gp, 0) - cost) };
      // Consume the scroll ONLY when it actually holds the copied spell (the
      // form already filters to matching scrolls; this guards a stale/forged
      // selection so a "Scroll of Healing Word" can never be burned copying
      // Fireball — the copy itself still happens, just without consumption).
      if (scrollId) {
        const it = (s.inventory || []).find((x) => x && x.id === scrollId);
        const matches = it && rec && String(it.name || '').toLowerCase().includes(String(rec.name || '').toLowerCase());
        if (matches) s.inventory = s.inventory
          .map((x) => (x.id === scrollId ? { ...x, qty: num(x.qty, 1) - 1 } : x))
          .filter((x) => !(x.id === scrollId && num(x.qty, 0) <= 0));
      }
      return s;
    });
  });
  // Add a spell "from another source" (feat / magic item / homebrew) — read the
  // form at click time; a name is required. `castWithSlots` (2024/SP-10): a
  // spellcaster can cast such a spell using their spell slots, so it joins the
  // castable repertoire rather than being a display-only note.
  register('spellCustomAdd', (cid) => {
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
  register('spellSwapOpen', (cid, classId) => {
    uiState.set(cid, 'spellSwapClass', String(classId));
    host.ui.rerender();
  });
  register('spellSwapClose', (cid) => {
    uiState.remove(cid, 'spellSwapClass');
    host.ui.rerender();
  });
  register('spellSwapApply', (cid, classId) => {
    let out = '', inRef = '';
    try { const o = document.getElementById('dse-swap-out-' + cid); const i = document.getElementById('dse-swap-in-' + cid); out = o && o.value; inRef = i && i.value; } catch (_) {}
    uiState.remove(cid, 'spellSwapClass');
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
  register('spellSwapForget', (cid, idx) => { mutate(cid, (s) => { s.spellSwaps = (s.spellSwaps || []).filter((_, i) => i !== num(idx)); return s; }); });
  // Drag-and-drop prep via the host drag seam.
  let _dragRef = null;
  register('spellDragStart', (ev, ref) => {
    _dragRef = ref != null ? String(ref) : null;
    try { if (ev && ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'copy'; ev.dataTransfer.setData('text/plain', _dragRef || ''); } } catch (_) {}
  });
  register('spellDrop', (cid, classId, kind) => {
    const ref = _dragRef; _dragRef = null;
    if (!ref) return;
    const bag = kind === 'cantrip' ? 'cantrips' : kind === 'spellbook' ? 'spellbook' : 'preparedSpells';
    const engine = getRules();
    mutate(cid, (s) => {
      // A drop can arrive from ANY group's pool card (unlike the click actions,
      // whose pools are pre-filtered), so validate it the same way those pools
      // are built: right class list, right level band for the target group,
      // capacity respected — an invalid drop is rejected, never silently
      // overfills (the over-limit chips exist only for legacy/level-down data).
      if (engine) {
        const comp = hydrateFor(s);
        const p = comp && comp.spellcasting && (comp.spellcasting.perClass || []).find((x) => x.classId === String(classId));
        const rec = engine.getItem ? engine.getItem('spell', ref) : null;
        const inClassList = engine.listSpells ? (engine.listSpells({ class: String(classId) }) || []).some((sp) => sp.id === ref) : true;
        if (!p || !rec || !inClassList) return s;
        const lvl = num(rec.level, 0);
        const chosen = (s[bag] && s[bag][classId]) || [];
        if (chosen.includes(ref)) return s;
        if (kind === 'cantrip') {
          if (lvl !== 0 || chosen.length >= num(p.cantripsKnown, 0)) return s;
        } else {
          if (lvl < 1 || lvl > Math.max(1, num(p.maxSpellLevel, 9))) return s;
          if (kind === 'spellbook') {
            if (p.prepares !== 'spellbook') return s;
          } else {
            if (chosen.length >= num(p.preparedLimit, 0)) return s;
            const alwaysSet = new Set((comp.spellcasting.granted || []).filter((g) => g.alwaysPrepared).map((g) => g.ref));
            if (alwaysSet.has(ref)) return s;
            // A spellbook caster prepares only from the LEARNED book (SP-5).
            if (p.prepares === 'spellbook' && !((s.spellbook && s.spellbook[classId]) || []).includes(ref)) return s;
          }
        }
      }
      addRef(s, bag, classId, ref);
      return s;
    });
  });
  // Choose-grant picks (Magic Initiate / Fey Touched / lineage cantrip).
  register('grantPick', (cid, key, ref) => {
    if (!ref) return;
    mutate(cid, (s) => { const cur = (s.grantChoices[key] || []).slice(); if (!cur.includes(ref)) cur.push(ref); s.grantChoices = { ...s.grantChoices, [key]: cur }; return s; });
  });
  register('grantUnpick', (cid, key, ref) => {
    mutate(cid, (s) => { s.grantChoices = { ...s.grantChoices, [key]: (s.grantChoices[key] || []).filter((r) => r !== ref) }; return s; });
  });
  register('spellSet', (cid, sid, field, value) => {
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

  return () => { _dragRef = null; };
}

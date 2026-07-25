// ═══════════════════════════════════════════════════════════════
//  panel.spellbook.js — the Spellbook tab.
//
//  Standalone → a simple spell-card list (editable in modification mode). Engine
//  mode → a casting summary (DC/attack/prepared/slots), per-class cantrip +
//  prepared SLOTS with a draggable available pool (edit only), choose-grant
//  pickers (Magic Initiate / Fey Touched / lineage cantrip), the always-prepared
//  granted set, and an Extra/Copied group with forced-duplicate colouring
//  (SP-1..SP-12 / UI-4..6). The `edit` flag (modification mode) gates every
//  mutation: read view shows the prepared loadout without slots/pools/pickers.
// ═══════════════════════════════════════════════════════════════

export function makeSpellbookPanel(ctx) {
  const { host, t, num, signed, titleize, scrollCopyCost, ui, uiState } = ctx;
  const { esc, dataAction, dataOn } = host.h;
  const { section, card, subLabel, spellChip, spellInfo, spellLegend, numField, entityRef } = ui;

  function lvlLabel(level) { return level === 0 ? t('spellbook.cantrip') : level == null ? '' : t('spellbook.lvlN', { n: level }); }

  function panelSpellbook(c, s, edit, comp, engine) {
    const sc = comp && comp.spellcasting;
    if (!sc || !engine) return panelSpellbookManual(c, s, edit);

    const granted = sc.granted || [];
    const alwaysSet = new Set(granted.filter((g) => g.alwaysPrepared).map((g) => g.ref));
    const blocks = [spellcastingSummary(s, comp)];
    for (const p of (sc.perClass || [])) blocks.push(classSpellSection(c, s, p, comp, engine, edit, alwaysSet));
    const pending = sc.pendingChoices || [];
    if (pending.length) blocks.push(grantChoicesSection(c, s, pending, engine, edit));
    if (granted.length) blocks.push(grantedSection(granted, engine));
    blocks.push(extraSection(c, s, edit, granted, comp));

    return `<div style="display:flex;flex-direction:column;gap:var(--space-5)">${blocks.filter(Boolean).join('')}</div>`;
  }

  function panelSpellbookManual(c, s, edit) {
    const spells = s.spells.slice().sort((a, b) => num(a.level) - num(b.level) || String(a.name || '').localeCompare(String(b.name || '')));
    const cards = spells.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:var(--space-2)">${spells.map((sp) => spellCard(c, sp, edit, false)).join('')}</div>`
      : `<div style="color:var(--text-muted);font-size:var(--text-sm)">${esc(t('spellbook.empty'))}</div>`;
    const adder = edit ? `<button class="inline-create-btn"${dataAction(host.action('spellAdd'), c.id)}>＋ ${esc(t('spellbook.add'))}</button>` : '';
    return section(t('tab.spellbook'), cards, { icon: '📖', right: adder });
  }

  // Engine-reported per-class save DC / attack / prepared count + slot pool.
  function spellcastingSummary(s, comp) {
    const sc = comp && comp.spellcasting;
    if (!sc || !Array.isArray(sc.perClass) || !sc.perClass.length) return '';
    const rows = sc.perClass.map((p) => {
      const prep = ((s.preparedSpells || {})[p.classId] || []).length;
      const stat = (label, val) => `<span style="display:inline-flex;gap:var(--space-1);align-items:baseline"><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.03em">${esc(label)}</span><strong style="color:var(--text-parchment)">${esc(String(val))}</strong></span>`;
      const bits = [
        stat(t('spell.saveDC'), num(p.saveDC)),
        stat(t('spell.attack'), signed(num(p.spellAttack))),
        stat(t('spellbook.prepared'), `${prep}/${num(p.preparedLimit)}`),
      ];
      if (p.ritual) bits.push(`<span style="color:var(--accent-gold);font-size:var(--text-xs)">${esc(t('spell.ritual'))}</span>`);
      if (p.pact) bits.push(stat(t('spell.pact'), num(p.pact.slots) + '×L' + num(p.pact.level)));
      return `<div style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:baseline">
        <strong style="color:var(--text-parchment)">${esc(titleize(p.classId))}</strong>${bits.join('')}</div>`;
    }).join('');
    const slots = (sc.slots || []).map((n, i) => n > 0
      ? `<span style="background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0 var(--space-2);font-size:var(--text-xs)"><span style="color:var(--text-muted)">${esc(t('spell.slotN', { lvl: i + 1 }))}</span> <strong style="color:var(--text-light)">×${esc(String(n))}</strong></span>`
      : '').filter(Boolean).join(' ');
    const slotsRow = slots ? `<div style="display:flex;flex-wrap:wrap;gap:var(--space-1);margin-top:var(--space-2);align-items:center"><span style="color:var(--text-muted);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.03em">${esc(t('spell.slots'))}</span> ${slots}</div>` : '';
    return card(`<div style="display:flex;flex-direction:column;gap:var(--space-1)">${rows}${slotsRow}</div>`, { accent: true });
  }

  // Per-class cantrip + prepared SLOTS: drag a spell from the available pool into
  // a slot (or click it — pointer-free fallback); ✕ removes (SP-2/SP-7).
  function classSpellSection(c, s, p, comp, engine, edit, alwaysSet) {
    const cid = p.classId;
    const clsName = (engine.getItem('class', cid) || {}).name || titleize(cid);
    const pool = engine.listSpells ? (engine.listSpells({ class: cid }) || []) : [];
    // Per-class cap: the highest spell level THIS class can prepare — a multiclass
    // low-level caster can't prepare high-level spells off the combined slot pool.
    const maxLvl = num(p.maxSpellLevel, (comp.spellcasting.slots || []).length);
    const inCap = (sp) => num(sp.level) >= 1 && num(sp.level) <= Math.max(1, maxLvl);
    // Wizard spellbook (SP-5): prepared is chosen from the LEARNED pool, not the
    // whole class list. Non-spellbook casters prepare directly from the class list.
    const bookMode = p.prepares === 'spellbook';
    const book = bookMode ? ((s.spellbook && s.spellbook[cid]) || []) : null;
    const bookSet = bookMode ? new Set(book) : null;
    const parts = [];

    if (num(p.cantripsKnown) > 0) {
      const chosen = (s.cantrips && s.cantrips[cid]) || [];
      // Granted cantrips (lineage/feat) are excluded from the learnable pool and
      // colour an already-picked duplicate, same as the prepared group (SP-3).
      const avail = pool.filter((sp) => num(sp.level) === 0 && !chosen.includes(sp.id) && !alwaysSet.has(sp.id));
      parts.push(spellSlotGroup(c, cid, 'cantrip', t('spell.cantripsN', { n: chosen.length, known: num(p.cantripsKnown) }), chosen, num(p.cantripsKnown), avail, engine, edit, alwaysSet, false));
    }
    // The spellbook itself — the learned pool prepared spells are drawn from.
    if (bookMode) {
      const learnAvail = pool.filter((sp) => inCap(sp) && !bookSet.has(sp.id));
      parts.push(spellbookGroup(c, cid, p, book, learnAvail, engine, edit));
    }
    if (num(p.preparedLimit) > 0) {
      const chosen = (s.preparedSpells && s.preparedSpells[cid]) || [];
      const source = bookMode ? pool.filter((sp) => bookSet.has(sp.id)) : pool;
      const avail = source.filter((sp) => inCap(sp) && !chosen.includes(sp.id) && !alwaysSet.has(sp.id));
      parts.push(spellSlotGroup(c, cid, 'prepared', t('spell.preparedN', { n: chosen.length, limit: num(p.preparedLimit) }), chosen, num(p.preparedLimit), avail, engine, edit, alwaysSet, !!p.ritual));
    }
    if (!parts.length) return '';
    // Level-up spell swap (FE-4): a deliberate, RECORDED swap — the button opens a
    // floating picker; confirmed swaps show below as a history (out → in @ level)
    // with hover + compendium links. (Free re-prep stays available via the slots.)
    const swapRows = (s.spellSwaps || []).map((sw, gi) => ({ sw, gi })).filter((x) => x.sw.classId === cid);
    const swapBtn = edit ? `<button class="inline-create-btn" style="margin-top:var(--space-2)"${dataAction(host.action('spellSwapOpen'), c.id, cid)}>🔄 ${esc(t('spell.swap'))}</button>` : '';
    const swapHist = swapRows.length ? `<div style="margin-top:var(--space-2)">${subLabel(t('spell.swaps'))}<div style="display:flex;flex-direction:column;gap:2px">${swapRows.map(({ sw, gi }) => `<div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-xs)">
          <span style="color:var(--text-muted);min-width:2.2rem">L${esc(String(sw.level))}</span>
          <span style="flex:1">${entityRef('spell', sw.out, spellInfo(engine, sw.out).name, spellLegend(engine, sw.out))} → ${entityRef('spell', sw.in, spellInfo(engine, sw.in).name, spellLegend(engine, sw.in))}</span>
          ${edit ? `<button class="inline-create-btn" title="${esc(t('action.remove'))}"${dataAction(host.action('spellSwapForget'), c.id, gi)}>✕</button>` : ''}</div>`).join('')}</div></div>` : '';
    const head = `<div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2)"><span style="width:3px;height:.9rem;border-radius:var(--radius-pill);background:var(--accent-gold)"></span><span style="color:var(--text-parchment);font-weight:600">${esc(clsName)}</span></div>`;
    return card(`${head}<div style="display:flex;flex-direction:column;gap:var(--space-3)">${parts.join('')}</div>${swapBtn}${swapHist}`);
  }

  // One slot group: a drop-zone of filled chips + empty slots, plus the
  // draggable available pool below it (edit only).
  function spellSlotGroup(c, cid, kind, label, chosen, limit, avail, engine, edit, alwaysSet, canRitual) {
    const removeAct = kind === 'cantrip' ? 'unlearnCantrip' : 'unprepSpell';
    const slots = [];
    // Render EVERY chosen entry, not just the first `limit`: a level-down (or
    // legacy over-full data) can leave more picks than slots, and a hidden chip
    // could never be unprepared. Chips past the cap keep their ✕ and get the
    // warning treatment instead of silently vanishing.
    for (let i = 0; i < Math.max(limit, chosen.length); i++) {
      const ref = chosen[i];
      if (ref) {
        const info = spellInfo(engine, ref);
        const dup = alwaysSet && alwaysSet.has(ref);
        const over = i >= limit;   // beyond the prepared/known cap
        // Ritual affordance: mark a prepared spell that has the Ritual tag when the
        // class can ritual-cast (⟳), so you know it can be cast without a slot.
        const rit = canRitual && info.ritual;
        const sub = lvlLabel(info.level) + (rit ? ' ⟳' : '') + (over ? ' ⚠' : '');
        slots.push(spellChip(info.name, sub, { danger: dup || over, title: over ? t('spell.overLimit') : dup ? t('spell.forcedDup') : (rit ? t('spell.ritual') : ''), link: { kind: 'spell', id: ref }, legend: spellLegend(engine, ref), removeAttr: edit ? dataAction(host.action(removeAct), c.id, cid, ref) : null }));
      } else if (edit && i < limit) {
        slots.push(`<div style="border:1px dashed rgba(var(--gold-muted),.35);border-radius:var(--radius-sm);min-width:8.5rem;min-height:2.4rem;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:var(--text-xs)">${esc(t('spell.emptySlot'))}</div>`);
      }
    }
    const dropAttr = edit ? dataOn('drop', host.action('spellDrop'), c.id, cid, kind) : '';
    const zone = `<div ${dropAttr} style="display:flex;flex-wrap:wrap;gap:var(--space-1);min-height:2.4rem">${slots.join('') || `<span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('misc.notSet'))}</span>`}</div>`;
    let poolHtml = '';
    if (edit && chosen.length < limit && avail.length) {
      poolHtml = `<div style="margin-top:var(--space-1)">
        <div style="color:var(--text-muted);font-size:var(--text-xs);margin-bottom:var(--space-1)">${esc(t('spell.available'))}</div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">${avail.map((sp) => spellPoolCard(c, cid, kind, sp)).join('')}</div></div>`;
    }
    return `<div>${subLabel(label)}${zone}${poolHtml}</div>`;
  }

  // The Wizard's spellbook (SP-5): the LEARNED pool prepared spells are chosen
  // from. Unbounded (grows by leveling + copying), so no fixed slots — learned
  // chips (✕ forgets, which also unprepares) over a "learn from the class list"
  // pool. A count + the free-by-level allotment (2024, non-binding) label it.
  function spellbookGroup(c, cid, p, book, learnAvail, engine, edit) {
    const chips = book.map((ref) => {
      const info = spellInfo(engine, ref);
      return spellChip(info.name, lvlLabel(info.level), { link: { kind: 'spell', id: ref }, legend: spellLegend(engine, ref), removeAttr: edit ? dataAction(host.action('spellbookForget'), c.id, cid, ref) : null });
    }).join('');
    const dropAttr = edit ? dataOn('drop', host.action('spellDrop'), c.id, cid, 'spellbook') : '';
    const zone = `<div ${dropAttr} style="display:flex;flex-wrap:wrap;gap:var(--space-1);min-height:2.4rem">${chips || `<span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('spell.spellbookEmpty'))}</span>`}</div>`;
    let poolHtml = '';
    if (edit && learnAvail.length) {
      poolHtml = `<div style="margin-top:var(--space-1)">
        <div style="color:var(--text-muted);font-size:var(--text-xs);margin-bottom:var(--space-1)">${esc(t('spell.learnAvail'))}</div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">${learnAvail.map((sp) => spellPoolCard(c, cid, 'spellbook', sp)).join('')}</div></div>`;
    }
    const free = num(p.spellbookKnown);
    const hint = (edit && free) ? ' · ' + t('spell.spellbookFree', { n: free, lvl: num(p.level) }) : '';
    return `<div>${subLabel('📖 ' + t('spell.spellbookN', { n: book.length }) + hint)}${zone}${poolHtml}</div>`;
  }

  // A draggable + clickable available-spell card (drag into a slot, or click to add).
  function spellPoolCard(c, cid, kind, sp) {
    const addAct = kind === 'cantrip' ? 'learnCantrip' : kind === 'spellbook' ? 'spellbookLearn' : 'prepSpell';
    return `<div draggable="true" title="${esc(t('spell.dragHint'))}"
      ${dataOn('dragstart', host.action('spellDragStart'), '$ev', sp.id)}
      ${dataAction(host.action(addAct), c.id, cid, sp.id)}
      style="cursor:grab;background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:var(--space-1) var(--space-2);font-size:var(--text-sm);color:var(--text-light)">
      ${esc(sp.name)}${sp.level ? ` <span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(String(sp.level))}</span>` : ''}</div>`;
  }

  // Always-prepared / granted spells, grouped visually by provenance (SP-2/SP-12).
  function grantedSection(granted, engine) {
    const BADGE = { subclass: '✦', feat: '⚝', species: '◈', class: '🎓', item: '⚙' };
    const chips = granted.map((g) => {
      const src = (g.source && g.source.type) || '';
      const sub = [lvlLabel(g.level), g.free ? t('spell.free') : ''].filter(Boolean).join(' · ');
      return spellChip(g.name, sub, { locked: g.alwaysPrepared, badge: BADGE[src] || '•', badgeTitle: titleize((g.source && g.source.id) || src), title: t('spell.grantedBy', { src: titleize((g.source && g.source.id) || src) }), link: { kind: 'spell', id: g.ref }, legend: spellLegend(engine, g.ref) });
    }).join('');
    return section(t('spell.alwaysPreparedHdr'), `<div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">${chips}</div>`, { icon: '🔒' });
  }

  // Choose-grants (SP-10/SP-20): a feat/lineage that grants "pick N spells matching
  // a filter" (Magic Initiate, Fey Touched's choose-1, High Elf's wizard cantrip).
  function grantChoicesSection(c, s, pending, engine, edit) {
    const blocks = pending.map((pc) => {
      const picked = (s.grantChoices && s.grantChoices[pc.key]) || [];
      const chips = picked.map((ref) => {
        const info = spellInfo(engine, ref);
        return spellChip(info.name, lvlLabel(info.level), { link: { kind: 'spell', id: ref }, legend: spellLegend(engine, ref), removeAttr: edit ? dataAction(host.action('grantUnpick'), c.id, pc.key, ref) : null });
      }).join('');
      let adder = '';
      if (edit && picked.length < pc.choose) {
        const pool = (engine.listSpells ? (engine.listSpells({ level: pc.spellLevel }) || []) : []).filter((sp) => {
          if (num(sp.level) !== num(pc.spellLevel)) return false;   // re-assert the level filter ourselves
          if (picked.includes(sp.id)) return false;
          if (pc.from.class && pc.from.class.length) return (sp.classes || []).some((cl) => pc.from.class.includes(cl));
          if (pc.from.school && pc.from.school.length) return pc.from.school.map((x) => String(x).toLowerCase()).includes(String(sp.school || '').toLowerCase());
          return true;
        });
        adder = pool.length
          ? `<select class="edit-input" style="max-width:13rem"${dataOn('change', host.action('grantPick'), c.id, pc.key, '$value')}><option value="">${esc(t('builder.choose'))}</option>${pool.map((sp) => `<option value="${esc(sp.id)}">${esc(sp.name)}</option>`).join('')}</select>`
          : `<span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('builder.contentPending'))}</span>`;
      }
      const fromLabel = (pc.from.class || pc.from.school || []).map(titleize).join('/');
      const what = (pc.spellLevel === 0 ? t('spellbook.cantrip') : t('spellbook.lvlN', { n: pc.spellLevel })) + (fromLabel ? ' · ' + fromLabel : '');
      const label = t('spell.chooseGrant', { src: titleize((pc.source && pc.source.id) || ''), n: pc.choose, what });
      return `<div>${subLabel(label)}<div style="display:flex;flex-wrap:wrap;gap:var(--space-1);align-items:center">${chips}${adder}</div></div>`;
    }).join('');
    return card(`${subLabel(t('spell.grantChoicesHdr'))}<div style="display:flex;flex-direction:column;gap:var(--space-3)">${blocks}</div>`);
  }

  // Extra (manual) + copied + other-source spells, separate from the granted set
  // (SP-1/SP-15). Two add buttons (B4.2c): 📜 copy-from-scroll (spellbook casters
  // only) and ✎ add-from-another-source (any class).
  function extraSection(c, s, edit, granted, comp) {
    const gnames = new Set((granted || []).map((g) => String(g.name || '').toLowerCase()));
    // DEG-1 snapshot entries are the ENGINE loadout's fallback copy — the live
    // prep UI above already shows those spells, so the Extra group hides them.
    const spells = (s.spells || []).filter((sp) => sp.origin !== 'snapshot').slice().sort((a, b) => num(a.level) - num(b.level) || String(a.name || '').localeCompare(String(b.name || '')));
    if (!spells.length && !edit) return '';
    const cards = spells.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:flex-start">${spells.map((sp) => spellCard(c, sp, edit, gnames.has(String(sp.name || '').toLowerCase()))).join('')}</div>`
      : `<div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('spellbook.empty'))}</div>`;
    const canCopy = (((comp && comp.spellcasting && comp.spellcasting.perClass) || [])).some((p) => p.prepares === 'spellbook');
    const adders = edit
      ? `<div style="display:flex;gap:var(--space-1)">${canCopy ? `<button class="inline-create-btn"${dataAction(host.action('spellMgrOpen'), c.id, 'copy')}>📜 ${esc(t('spell.copyBtn'))}</button>` : ''}<button class="inline-create-btn"${dataAction(host.action('spellMgrOpen'), c.id, 'other')}>✎ ${esc(t('spell.otherBtn'))}</button></div>`
      : '';
    return section(t('spell.extraSpells'), cards, { right: adders });
  }

  function spellCard(c, sp, edit, dup) {
    const prepared = !!sp.prepared;
    const lvl = num(sp.level, 0);
    const lvlTxt = lvl === 0 ? t('spellbook.cantrip') : t('spellbook.lvlN', { n: lvl });
    const originBadge = sp.origin === 'copied' ? `<span title="${esc(t('spell.copied'))}">📖</span> `
      : (sp.origin === 'other' || sp.origin === 'custom') ? `<span title="${esc(t('spell.fromOther'))}">✎</span> `
      : sp.origin === 'snapshot' ? `<span title="${esc(t('spell.snapshot'))}">📌</span> ` : '';
    // A spell from another source that a spellcaster can cast with slots (B4.2c/SP-10).
    const slotTag = sp.castWithSlots ? `<span title="${esc(t('spell.castWithSlotsHint'))}" style="color:var(--accent-gold);font-size:var(--text-xs)">◈ ${esc(t('spell.castWithSlots'))}</span>` : '';
    const noteLine = sp.sourceNote ? `<div style="color:var(--text-muted);font-size:var(--text-xs);font-style:italic">${esc(sp.sourceNote)}</div>` : '';
    const dupBd = dup ? 'var(--color-danger)' : 'var(--border-subtle)';
    const star = `<span title="${esc(t('spellbook.prepared'))}" style="color:${prepared ? 'var(--accent-gold)' : 'var(--text-muted)'}">${prepared ? '★' : '☆'}</span>`;
    if (!edit) {
      return `<div title="${dup ? esc(t('spell.forcedDup')) : ''}" style="background:var(--bg-raised);border:1px solid ${dupBd};border-radius:var(--radius);padding:var(--space-2) var(--space-3);min-width:9rem">
        <div style="display:flex;align-items:center;gap:var(--space-2)">${star}<strong style="color:${dup ? 'var(--color-danger)' : 'var(--text-parchment)'}">${originBadge}${esc(sp.name || t('misc.unnamed'))}</strong></div>
        <div style="color:var(--text-muted);font-size:var(--text-xs);margin-top:var(--space-1)">${esc(lvlTxt)}${sp.school ? ' · ' + esc(sp.school) : ''}</div>${slotTag ? `<div style="margin-top:2px">${slotTag}</div>` : ''}${noteLine}
      </div>`;
    }
    return `<div title="${dup ? esc(t('spell.forcedDup')) : ''}" style="background:var(--bg-raised);border:1px solid ${dupBd};border-radius:var(--radius);padding:var(--space-2);min-width:11rem;display:flex;flex-direction:column;gap:var(--space-1)">
      <div style="display:flex;align-items:center;gap:var(--space-2)">
        <button title="${esc(t('spellbook.prepToggle'))}" style="background:none;border:none;cursor:pointer;font-size:var(--text-base)"${dataAction(host.action('spellSet'), c.id, sp.id, 'prepared', prepared ? '0' : '1')}>${prepared ? '★' : '☆'}</button>
        ${originBadge}
        <input class="edit-input" style="flex:1" value="${esc(sp.name || '')}" placeholder="${esc(t('spellbook.name'))}"${dataOn('change', host.action('spellSet'), c.id, sp.id, 'name', '$value')}>
        <button class="inline-create-btn" title="${esc(t('action.remove'))}"${dataAction(host.action('spellDel'), c.id, sp.id)}>✕</button>
      </div>
      <div style="display:flex;gap:var(--space-1);align-items:center">
        ${numField(dataOn('change', host.action('spellSet'), c.id, sp.id, 'level', '$value'), lvl, { min: 0, max: 9, title: t('spellbook.level') })}
        <input class="edit-input" style="flex:1" value="${esc(sp.school || '')}" placeholder="${esc(t('spellbook.school'))}"${dataOn('change', host.action('spellSet'), c.id, sp.id, 'school', '$value')}>
      </div>${slotTag ? `<div>${slotTag}</div>` : ''}${noteLine}
    </div>`;
  }

  // Level-up spell swap modal — a floating overlay (matches the Rest wizard). Pick a
  // prepared spell to swap out + a new one to swap in; confirm records the swap
  // (out → in @ level) and applies it. Coexists with free re-prep on the slots.
  function spellSwapModal(c, s, comp, engine, classId) {
    const sc = comp && comp.spellcasting;
    const p = sc && (sc.perClass || []).find((x) => x.classId === classId);
    if (!p) return '';
    const cid = c.id;
    const clsName = (engine.getItem('class', classId) || {}).name || titleize(classId);
    const prepared = (s.preparedSpells && s.preparedSpells[classId]) || [];
    const maxLvl = num(p.maxSpellLevel, 9);
    const pool = engine.listSpells ? (engine.listSpells({ class: classId }) || []) : [];
    // A spellbook caster can only swap IN a spell already learned into the book (SP-5).
    const bookMode = p.prepares === 'spellbook';
    const bookSet = bookMode ? new Set((s.spellbook && s.spellbook[classId]) || []) : null;
    const inPool = pool.filter((sp) => num(sp.level) >= 1 && num(sp.level) <= Math.max(1, maxLvl) && !prepared.includes(sp.id) && (!bookMode || bookSet.has(sp.id)));
    const outOpts = prepared.map((ref) => `<option value="${esc(ref)}">${esc(spellInfo(engine, ref).name)}</option>`).join('');
    const inOpts = inPool.map((sp) => `<option value="${esc(sp.id)}">${esc(sp.name)}</option>`).join('');
    const body = (prepared.length && inPool.length)
      ? `<div style="display:flex;flex-direction:column;gap:var(--space-3)">
           <label style="display:flex;flex-direction:column;gap:2px;font-size:var(--text-sm);color:var(--text-muted)">${esc(t('spell.swapOut'))}<select id="dse-swap-out-${esc(cid)}" class="edit-input">${outOpts}</select></label>
           <label style="display:flex;flex-direction:column;gap:2px;font-size:var(--text-sm);color:var(--text-muted)">${esc(t('spell.swapIn'))}<select id="dse-swap-in-${esc(cid)}" class="edit-input">${inOpts}</select></label>
           <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-2)">
             <button class="inline-create-btn"${dataAction(host.action('spellSwapClose'), cid)}>${esc(t('action.cancel'))}</button>
             <button class="edit-save-btn"${dataAction(host.action('spellSwapApply'), cid, classId)}>${esc(t('spell.swapConfirm'))}</button>
           </div></div>`
      : `<div style="color:var(--text-muted);font-size:var(--text-sm)">${esc(t('spell.swapNone'))}</div>`;
    return `<div class="addon-wizard-overlay">
      <div style="position:absolute;inset:0" title="${esc(t('action.cancel'))}"${dataAction(host.action('spellSwapClose'), cid)}></div>
      <div class="addon-wizard" role="dialog" aria-modal="true" aria-label="${esc(t('spell.swapTitle', { cls: clsName }))}" style="position:relative;z-index:1">
        <div class="addon-wizard-head"><h3>🔄 ${esc(t('spell.swapTitle', { cls: clsName }))}</h3>
          <button class="inline-create-btn" title="${esc(t('action.cancel'))}"${dataAction(host.action('spellSwapClose'), cid)}>✕</button></div>
        <div class="addon-wizard-body">${body}</div>
      </div></div>`;
  }

  // Spellbook management modal (floating overlay) — TWO modes, one per button (B4.2c):
  //  • 'copy'  → copy a spell into the book (spellbook casters): pick a class spell,
  //     pay 50 gp × level, optionally consume a /scroll/i inventory item → s.spellbook.
  //  • 'other' → add a spell from another source (feat / magic item / homebrew) with a
  //     source note; a spellcaster can mark it castable WITH SPELL SLOTS (2024/SP-10).
  // Each mode carries its own removal list. Coexists with the main tab's class-learning.
  function spellbookMgrModal(c, s, comp, engine, mode) {
    const cid = c.id;
    const sc = comp && comp.spellcasting;
    const bookP = ((sc && sc.perClass) || []).find((p) => p.prepares === 'spellbook') || null;
    const isCaster = !!(sc && (sc.perClass || []).length);
    const clsNameOf = (id) => (engine.getItem('class', id) || {}).name || titleize(id);
    let title = '', body = '';

    if (mode === 'copy' && bookP) {
      const bid = bookP.classId;
      title = t('spell.copyHdr', { cls: clsNameOf(bid) });
      const book = new Set((s.spellbook && s.spellbook[bid]) || []);
      const maxLvl = num(bookP.maxSpellLevel, 9);
      const pool = engine.listSpells ? (engine.listSpells({ class: bid }) || []) : [];
      const copyable = pool.filter((sp) => num(sp.level) >= 1 && num(sp.level) <= Math.max(1, maxLvl) && !book.has(sp.id));
      // The spell pick persists across the change→re-render cycle (spellCopyPick
      // stores it), so the scroll list can be filtered to scrolls of THAT spell.
      const selRef = uiState.get(cid, 'spellCopySelection', '');
      const selected = copyable.some((sp) => sp.id === selRef) ? selRef : ((copyable[0] && copyable[0].id) || '');
      const selSpell = copyable.find((sp) => sp.id === selected) || null;
      // Only scrolls that actually HOLD the picked spell may be consumed
      // (ROADMAP 5b): prefer the canonical "Scroll of <spell>" form, fall back
      // to any scroll whose name contains the spell's name. Wrong scrolls are
      // never offered; with no match, copying without a scroll stays possible.
      const allScrolls = (s.inventory || []).filter((it) => /scroll/i.test(String(it.name || '')));
      const reEsc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ofRe = selSpell ? new RegExp('scroll\\s+of\\s+' + reEsc(selSpell.name), 'i') : null;
      let scrolls = ofRe ? allScrolls.filter((it) => ofRe.test(String(it.name || ''))) : [];
      if (!scrolls.length && selSpell) scrolls = allScrolls.filter((it) => String(it.name || '').toLowerCase().includes(String(selSpell.name).toLowerCase()));
      const scrollSelect = scrolls.length
        ? `<select id="dse-copy-scroll-${esc(cid)}" class="edit-input"><option value="">${esc(t('spell.noScroll'))}</option>${scrolls.map((it) => `<option value="${esc(it.id)}">${esc(it.name)}</option>`).join('')}</select>`
        : `<select id="dse-copy-scroll-${esc(cid)}" class="edit-input" disabled><option value="">${esc(allScrolls.length ? t('spell.noMatchingScroll') : t('spell.noScroll'))}</option></select>`;
      const gp = num((s.currency || {}).gp, 0);
      const form = copyable.length
        ? `<div style="display:flex;flex-direction:column;gap:var(--space-2)">
             <label style="display:flex;flex-direction:column;gap:2px;font-size:var(--text-sm);color:var(--text-muted)">${esc(t('spell.copyPick'))}
               <select id="dse-copy-spell-${esc(cid)}" class="edit-input"${dataOn('change', host.action('spellCopyPick'), cid, '$value')}>${copyable.map((sp) => `<option value="${esc(sp.id)}"${sp.id === selected ? ' selected' : ''}>${esc(sp.name)} — ${scrollCopyCost(sp.level)} ${esc(t('spell.gp'))}</option>`).join('')}</select></label>
             <label style="display:flex;flex-direction:column;gap:2px;font-size:var(--text-sm);color:var(--text-muted)">${esc(t('spell.copyScroll'))}
               ${scrollSelect}</label>
             <div style="font-size:var(--text-xs);color:var(--text-muted)">${esc(t('spell.copyCost', { gp }))}</div>
             <div style="display:flex;justify-content:flex-end"><button class="edit-save-btn"${dataAction(host.action('spellCopy'), cid, bid)}>📜 ${esc(t('spell.copyConfirm'))}</button></div>
           </div>`
        : `<div style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('spell.copyAllKnown'))}</div>`;
      const rows = ((s.spellbook && s.spellbook[bid]) || []).map((ref) => {
        const info = spellInfo(engine, ref);
        return `<div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm)">
          <span style="flex:1">${entityRef('spell', ref, info.name, spellLegend(engine, ref))} <span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(t('spell.inBook'))}</span></span>
          <button class="inline-create-btn" title="${esc(t('action.remove'))}"${dataAction(host.action('spellbookForget'), cid, bid, ref)}>✕</button></div>`;
      });
      const removeBlock = rows.length ? `<div>${subLabel(t('spell.manageBook'))}<div style="display:flex;flex-direction:column;gap:2px">${rows.join('')}</div></div>` : '';
      body = `<div style="display:flex;flex-direction:column;gap:var(--space-4)">${form}${removeBlock}</div>`;
    } else {
      // 'other' — add a spell from a feat / magic item / homebrew (any class).
      title = t('spell.otherTitle');
      const form = `<div style="display:flex;flex-direction:column;gap:var(--space-2)">
        ${subLabel(t('spell.otherHint'))}
        <input id="dse-custom-name-${esc(cid)}" class="edit-input" placeholder="${esc(t('spellbook.name'))}">
        <div style="display:flex;gap:var(--space-2)">
          <input id="dse-custom-level-${esc(cid)}" class="edit-input" type="number" min="0" max="9" value="0" style="width:5rem" title="${esc(t('spellbook.level'))}">
          <input id="dse-custom-school-${esc(cid)}" class="edit-input" placeholder="${esc(t('spellbook.school'))}" style="flex:1">
        </div>
        <input id="dse-custom-note-${esc(cid)}" class="edit-input" placeholder="${esc(t('spell.sourceNote'))}">
        ${isCaster ? `<label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);color:var(--text-light)"><input type="checkbox" id="dse-custom-slots-${esc(cid)}" checked> ${esc(t('spell.castWithSlots'))}</label>` : ''}
        <div style="display:flex;justify-content:flex-end"><button class="edit-save-btn"${dataAction(host.action('spellCustomAdd'), cid)}>＋ ${esc(t('spell.customConfirm'))}</button></div>
      </div>`;
      const rows = (s.spells || []).filter((sp) => sp.origin !== 'snapshot').map((sp) => {
        const badge = sp.origin === 'copied' ? '📖' : (sp.origin === 'other' || sp.origin === 'custom') ? '✎' : '•';
        const slot = sp.castWithSlots ? ` <span style="color:var(--accent-gold)" title="${esc(t('spell.castWithSlotsHint'))}">◈</span>` : '';
        const note = sp.sourceNote ? ` <span style="font-style:italic">— ${esc(sp.sourceNote)}</span>` : '';
        return `<div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm)">
          <span style="flex:1">${esc(badge)} ${esc(sp.name || t('misc.unnamed'))} <span style="color:var(--text-muted);font-size:var(--text-xs)">${esc(lvlLabel(num(sp.level, 0)))}${slot}${note}</span></span>
          <button class="inline-create-btn" title="${esc(t('action.remove'))}"${dataAction(host.action('spellDel'), cid, sp.id)}>✕</button></div>`;
      });
      const removeBlock = rows.length ? `<div>${subLabel(t('spell.manageAdded'))}<div style="display:flex;flex-direction:column;gap:2px">${rows.join('')}</div></div>` : '';
      body = `<div style="display:flex;flex-direction:column;gap:var(--space-4)">${form}${removeBlock}</div>`;
    }

    return `<div class="addon-wizard-overlay">
      <div style="position:absolute;inset:0" title="${esc(t('action.cancel'))}"${dataAction(host.action('spellMgrClose'), cid)}></div>
      <div class="addon-wizard" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="position:relative;z-index:1">
        <div class="addon-wizard-head"><h3>${mode === 'copy' ? '📜' : '✎'} ${esc(title)}</h3>
          <button class="inline-create-btn" title="${esc(t('action.cancel'))}"${dataAction(host.action('spellMgrClose'), cid)}>✕</button></div>
        <div class="addon-wizard-body">${body}</div>
      </div></div>`;
  }

  return { panelSpellbook, spellSwapModal, spellbookMgrModal };
}

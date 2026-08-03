// ═══════════════════════════════════════════════════════════════
//  panel.rail.js — the ability CARDS column (UX: full-width sheet layout).
//
//  One card per ability, stacked vertically down the left of the Character Sheet
//  and Combat tabs (in the space the host side-card used to hold). Each card is
//  the "attribute with its skills" block: a mod/score tile, the SAVING THROW
//  integrated on the ability's title line (🛡), and that ability's skills listed
//  beneath — so a skill reads directly under the score it keys off. Every value
//  carries the same hover legend (UX-7). Editable in standalone (score input +
//  save/skill toggles); computed + read-only in engine mode.
//
//  Shared by both tabs (bound onto ctx before the panels) so they present the
//  ability block identically; the tab-specific content sits in the column beside.
// ═══════════════════════════════════════════════════════════════

export function makeRail(ctx) {
  const { host, t, ABILITIES, SKILLS, num, signed, abilityMod, titleize, ui, viewModel, legends, uiLayout } = ctx;
  const { esc, dataAction } = host.h;
  const { card, statTip, numField, profDot, S } = ui;

  // A docked-stat chip (COMPACT layout): tiny uppercase label + the number,
  // carrying the same hover legend as the band tile it replaces. Compact mode
  // moves Initiative onto DEX, passive Perception onto the Perception row, and
  // Save DC / Spell Attack onto the casting ability's card — proximity over a
  // longer vitals band (the sheet's ⚙ Settings tab, per sheet).
  function dock(label, valueText, legend) {
    const inner = `<span class="dse-dock">${esc(label)} <strong>${esc(valueText)}</strong></span>`;
    return legend ? statTip(inner, legend) : inner;
  }

  // One save/skill line: trained dot + label + total (total carries a legend).
  // Zero vertical padding + a tightened line-height keep the stacked cards
  // compact — six cards of skills add up fast.
  function line(state, labelHtml, legend, dotAttr) {
    const dot = profDot(state, dotAttr);
    const total = statTip(`<strong style="${S.profTotal}">${esc(legend.total)}</strong>`, legend, { align: 'r' });
    return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:0 var(--space-2);line-height:1.3">${dot}<span style="${S.profLabel}">${labelHtml}</span>${total}</div>`;
  }

  // The saving-throw indicator IS the shield: an outline (empty) when not
  // proficient, filled gold (full) when proficient — replacing the separate
  // proficiency dot. Inline SVG (not the emoji) so fill/stroke are controllable.
  // Clickable to toggle proficiency in standalone edit; a static marker otherwise.
  function saveShield(prof, attr, title) {
    const path = `<path d="M12 2.4 L19.3 5.3 V11 C19.3 15.8 16 19.6 12 21.5 C8 19.6 4.7 15.8 4.7 11 V5.3 Z" style="fill:${prof ? 'var(--accent-gold)' : 'none'};stroke:${prof ? 'var(--accent-gold)' : 'var(--text-muted)'};stroke-width:1.7;stroke-linejoin:round"/>`;
    const svg = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="display:block">${path}</svg>`;
    if (attr) return `<button class="dse-dot" title="${esc(title)}" aria-pressed="${prof ? 'true' : 'false'}"${attr}>${svg}</button>`;
    return `<span title="${esc(title)}" style="line-height:0">${svg}</span>`;
  }

  function abilityCard(c, s, comp, a, editable, vm, L, compact, casters) {
    const standaloneEdit = editable && !comp;
    const score = comp && comp.abilities && comp.abilities[a] ? num(comp.abilities[a].score, 10) : num(s.abilities[a], 10);
    const mod = comp && comp.abilities && comp.abilities[a] ? num(comp.abilities[a].mod, abilityMod(score)) : abilityMod(s.abilities[a]);

    // Mod/score tile (left of the card).
    const scoreCell = standaloneEdit
      ? numField(host.h.dataOn('change', host.action('setAbility'), c.id, a, '$value'), score, { min: 1, max: 30, width: '2.75rem', ariaLabel: t('ability.' + a) })
      : `<div style="${S.abilScore}">${esc(String(score))}</div>`;
    // Compact mod/score tile — the ability's name in the title row identifies it,
    // so the abbreviation is dropped to save vertical height.
    const modBig = statTip(`<div style="${S.abilMod}">${esc(signed(mod))}</div>`, L.ability(a), { align: 'l' });
    const leftTile = `<div style="flex:none;text-align:center;background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:var(--radius);padding:var(--space-1) var(--space-2);min-width:3.5rem">
      ${modBig}<div style="margin-top:1px">${scoreCell}</div></div>`;

    // COMPACT docks: Initiative rides the DEX title row, passive Perception the
    // WIS title row (same slot, eye emoji); the casting classes' Save DC /
    // Spell Attack ride their ability's card (SP-4 — per class), which gets the
    // gold accent ring (no "caster" text — the ring says it). Empty in classic.
    const casting = compact ? (casters[a] || []) : [];
    const multiCaster = compact && comp && comp.spellcasting && (comp.spellcasting.perClass || []).length > 1;
    const initDock = (compact && a === 'DEX') ? dock('⚡ ' + t('dock.init'), signed(vm.init), L.init()) : '';
    const passiveDock = (compact && a === 'WIS') ? dock('👁 ' + t('dock.passiveShort'), String(num(vm.passivePerc)), L.passive()) : '';
    // ONE combined spellcasting chip per casting class — "SAVE DC 11 · SPELL
    // ATK +3" — so the pair always shares a line at full size (two hover
    // legends inside one chip, split by a dot). Sits in the right column above
    // the skills; the mod/score box stays level with every other card.
    // Centred in the right column — equal distance to the mod/score box on the
    // left and the card edge on the right (the skills below stay left-aligned).
    const casterRow = casting.length
      ? `<div style="display:flex;gap:var(--space-1);flex-wrap:wrap;justify-content:center;padding:2px 0 var(--space-1)">${casting.map((p) => {
          const pre = multiCaster ? esc(titleize(p.classId)) + ' ' : '';
          const dc = statTip(`${pre}${esc(t('spell.saveDC'))} <strong>${esc(String(num(p.saveDC)))}</strong>`, L.spellDC(p));
          const atk = statTip(`${esc(t('dock.spellAtk'))} <strong>${esc(signed(num(p.spellAttack)))}</strong>`, L.spellAtk(p));
          return `<span class="dse-dock">${dc}<span class="dse-dock-sep">·</span>${atk}</span>`;
        }).join('')}</div>`
      : '';

    // Save integrated onto the ability's title line: the shield's fill IS the
    // proficiency (full = proficient, outline = not), then the total. Compact
    // drops the "Save" word — the shield alone carries the meaning (its title/
    // aria keep the full wording).
    const sv = vm.save(a);
    const saveDot = standaloneEdit ? dataAction(host.action('toggleSave'), c.id, a) : null;
    const saveTotal = statTip(`<strong style="${S.profTotal}">${esc(signed(sv.total))}</strong>`, L.save(a), { align: 'r' });
    const saveTitle = t('sheet.saves') + ' · ' + (sv.prof ? t('misc.proficient') : t('misc.notProficient'));
    const saveLabel = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:var(--text-xs);color:var(--accent-gold)">${saveShield(sv.prof, saveDot, saveTitle)}${compact ? '' : esc(t('sheet.saveTag'))}</span>`;
    // The dock slot owns ALL the space between the name and the shield and
    // centres its chip in it — equal gaps on both sides (with no chip it's
    // just the spacer, so classic + chipless cards look unchanged).
    const titleRow = `<div style="display:flex;align-items:center;gap:var(--space-2);padding-bottom:var(--space-1);border-bottom:1px solid var(--border-subtle);margin-bottom:var(--space-1)">
      <span style="color:var(--text-parchment);font-weight:600;font-size:var(--text-sm);letter-spacing:.03em">${esc(t('ability.' + a))}</span>
      <span class="dse-dock-slot">${initDock}${passiveDock}</span>
      ${saveLabel}${saveTotal}</div>`;

    // Skills governed by this ability (alphabetical), beneath the title.
    const skillsFor = SKILLS.filter((sk) => sk.ability === a)
      .map((sk) => ({ sk, name: t('skill.' + sk.id) }))
      .sort((x, y) => x.name.localeCompare(y.name));
    const skillRows = skillsFor.length
      ? skillsFor.map(({ sk, name }) => {
          const kv = vm.skill(sk.id, sk.ability);
          const state = kv.exp ? 'exp' : kv.prof ? 'prof' : 'none';
          const dotAttr = standaloneEdit ? dataAction(host.action('toggleSkill'), c.id, sk.id) : null;
          return line(state, esc(name), L.skill(sk.id, sk.ability), dotAttr);
        }).join('')
      : `<div style="color:var(--text-muted);font-size:var(--text-xs);padding:var(--space-1) var(--space-2)">${esc(t('sheet.noSkills'))}</div>`;

    // CLASSIC: title row + skills sit beside the mod box. COMPACT: the title
    // row spans the card top (name in the left corner, docks + save right),
    // the mod box drops BELOW it — level with every other card's box — and the
    // caster chips open the right column above the skills.
    if (!compact) {
      return card(`<div style="display:flex;gap:var(--space-2);align-items:flex-start">
        ${leftTile}<div style="flex:1;min-width:0">${titleRow}${skillRows}</div></div>`, { style: 'padding:var(--space-2) var(--space-3)' });
    }
    return card(`${titleRow}<div style="display:flex;gap:var(--space-2);align-items:flex-start">
      ${leftTile}<div style="flex:1;min-width:0">${casterRow}${skillRows}</div></div>`, { style: 'padding:var(--space-2) var(--space-3)', accent: casting.length > 0 });
  }

  // The stacked ability cards. Callers wrap in `.dse-cards`.
  function abilityRail(c, s, comp, editable) {
    const vm = viewModel(s, comp);
    const L = legends(s, comp, vm);
    const compact = uiLayout(c.id) === 'compact';
    // ability → the casting classes keyed on it (each carries saveDC/spellAttack).
    const casters = {};
    if (compact && comp && comp.spellcasting) {
      for (const p of comp.spellcasting.perClass || []) (casters[p.ability] = casters[p.ability] || []).push(p);
    }
    return ABILITIES.map((a) => abilityCard(c, s, comp, a, editable, vm, L, compact, casters)).join('');
  }

  return { abilityRail };
}

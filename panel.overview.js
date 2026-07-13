// ═══════════════════════════════════════════════════════════════
//  panel.overview.js — the Character Sheet tab (the "stat block").
//
//  Full-width layout (UX): the ability CARDS — each ability with its SAVING
//  THROW integrated (🛡) and its skills listed beneath (panel.rail.js) — stack
//  vertically down the LEFT from the very top. The column to the RIGHT holds
//  the vital strip (HP control + AC/Init/Speed/PB/Passive + spell DC/attack),
//  then the Backpack (inventory + currency — it has no tab of its own), so the
//  bag sits right under the stats beside the abilities. Every save/skill total
//  carries a hover legend explaining its formula and terms (UX-7).
//
//  Editing is direct and role-gated (`edit`): standalone turns ability scores
//  into inputs and save/skill dots into toggles (in the cards); engine mode is
//  computed and read-only (change it in the Builder). The standalone identity
//  block (class/level/background…) sits under the vitals on the right.
// ═══════════════════════════════════════════════════════════════

export function makeOverviewPanel(ctx) {
  const { host, t, num, ui, vitalsBar, abilityRail } = ctx;
  const { esc, dataOn } = host.h;
  const { section, numField } = ui;

  // A labelled free-text / number input that writes a flat field (standalone).
  function idField(cid, label, field, value, opts) {
    opts = opts || {};
    const input = opts.num
      ? numField(dataOn('change', host.action('setField'), cid, field, '$value'), value, { min: opts.min, ariaLabel: label })
      : `<input class="edit-input" value="${esc(value || '')}" ${dataOn('change', host.action('setField'), cid, field, '$value')}>`;
    return `<label style="display:flex;flex-direction:column;gap:2px;font-size:var(--text-xs);color:var(--text-muted)">
      <span style="text-transform:uppercase;letter-spacing:.03em">${esc(label)}</span>${input}</label>`;
  }

  function identitySection(c, s) {
    const cid = c.id;
    const grid = [
      idField(cid, t('field.class'), 'className', s.className),
      idField(cid, t('field.subclass'), 'subclass', s.subclass),
      idField(cid, t('field.level'), 'level', num(s.level, 1), { num: true, min: 1 }),
      idField(cid, t('field.background'), 'background', s.background),
      idField(cid, t('field.alignment'), 'alignment', s.alignment),
      idField(cid, t('field.player'), 'player', s.player),
    ].join('');
    return section(t('sheet.identity'),
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:var(--space-2)">${grid}</div>`);
  }

  function panelOverview(c, s, edit, comp, engine) {
    const standaloneEdit = edit && !engine;
    const identity = standaloneEdit ? identitySection(c, s) : '';
    // The Backpack panel, headed like a mini-tab. ctx.panels is assembled after
    // the panel factories run (entry.js), so resolve it lazily at render time.
    const backpack = `<div style="border-top:1px solid var(--border-subtle);padding-top:var(--space-4)">
      <div style="font-size:var(--text-lg);font-weight:600;color:var(--text-parchment);margin-bottom:var(--space-3);display:flex;align-items:center;gap:var(--space-2)"><span aria-hidden="true">🎒</span> ${esc(t('tab.backpack'))}</div>
      ${ctx.panels.panelBackpack(c, s, edit, comp, engine)}</div>`;
    const right = `<div style="display:flex;flex-direction:column;gap:var(--space-5)">
      ${vitalsBar(c, s, comp, edit, engine)}${identity}${backpack}</div>`;
    return `<div class="dse-cols">
      <div class="dse-cards">${abilityRail(c, s, comp, edit)}</div>
      <div class="dse-cols-main">${right}</div>
    </div>`;
  }

  return { panelOverview };
}

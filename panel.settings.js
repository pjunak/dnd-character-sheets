// ═══════════════════════════════════════════════════════════════
//  panel.settings.js — the ⚙ Settings tab (rightmost tool tab, beside the
//  Builder): everything sheet-scoped that isn't play or building.
//
//  • Sheet layout — the classic/compact switch, PER SHEET + per browser
//    (localStorage 'dse-ui:layout:<cid>'), so every player picks their own
//    favorite look for each character. This replaced the host Settings →
//    Doplňky tab this addon used to register (a global per-browser switch).
//  • Print & data — the Print / Export / Import actions that used to ride a
//    toolbar above the tab strip (moved here to reclaim the vertical space).
//    Import overwrites, so it's editor-only.
//  • The rules status line (book addon connected / hand-fillable), formerly
//    on that host settings tab too.
// ═══════════════════════════════════════════════════════════════

export function makeSettingsPanel(ctx) {
  const { host, t, plural, ui, uiLayout } = ctx;
  const { esc, dataAction, dataOn } = host.h;
  const { section } = ui;

  function panelSettings(c, s, edit, engine) {
    const layout = uiLayout(c.id);

    // One layout choice as a radio card (border lights up on the active one).
    const opt = (mode, label, desc) => `
      <label style="display:flex;align-items:flex-start;gap:var(--space-2);padding:var(--space-2);border:1px solid ${layout === mode ? 'rgba(var(--accent-gold-rgb),.45)' : 'var(--border-subtle)'};border-radius:var(--radius);cursor:pointer;background:var(--bg-surface)">
        <input type="radio" name="dse-layout-${esc(c.id)}" value="${esc(mode)}" ${layout === mode ? 'checked' : ''} ${dataOn('change', host.action('uiLayoutSet'), c.id, mode)}>
        <span><strong style="color:var(--text-parchment)">${esc(label)}</strong>
          <span style="display:block;color:var(--text-muted);font-size:var(--text-sm)">${esc(desc)}</span></span>
      </label>`;
    const layoutBody = `
      <p style="color:var(--text-muted);font-size:var(--text-sm);margin:0 0 var(--space-2)">${esc(t('settings.layoutHint'))}</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-2)">
        ${opt('classic', t('settings.layoutClassic'), t('settings.layoutClassicDesc'))}
        ${opt('compact', t('settings.layoutCompact'), t('settings.layoutCompactDesc'))}
      </div>`;

    // One data tool: the button + a one-line what-it-does beside it.
    const tool = (action, icon, label, desc) => `
      <div style="display:flex;align-items:baseline;gap:var(--space-3)">
        <button class="inline-create-btn" style="flex:none;min-width:7.5rem"${dataAction(host.action(action), c.id)}>${icon} ${esc(label)}</button>
        <span style="color:var(--text-muted);font-size:var(--text-sm)">${esc(desc)}</span></div>`;
    const tools = `<div style="display:flex;flex-direction:column;gap:var(--space-2)">
      ${tool('printSheet', '🖨', t('action.print'), t('settings.printDesc'))}
      ${tool('exportSheet', '⬇', t('action.export'), t('settings.exportDesc'))}
      ${edit ? tool('importOpen', '⬆', t('action.import'), t('settings.importDesc')) : ''}</div>`;

    const provider = ctx.engine.providerState(s);
    let status = '';
    if (provider.status === 'active') {
      status = `<p style="color:var(--color-success);font-size:var(--text-sm);margin:0">${esc(
        edit
          ? plural('rules.connected', engine.listClasses().length)
          : plural('rules.connectedReadOnly', engine.listClasses().length)
      )}</p>`;
    } else if (provider.status === 'reconcile') {
      const message = provider.reason === 'edition'
        ? t('rules.reconcileEdition')
        : t('rules.reconcileManual');
      status = `<div class="codex-warnings">
        <p style="margin:0 0 var(--space-2)">${esc(message)}</p>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          <button class="inline-create-btn"${dataAction(host.action('providerResolve'), c.id, 'manual')}>${esc(t('rules.keepManual'))}</button>
          <button class="edit-save-btn"${dataAction(host.action('providerResolve'), c.id, 'builder')}>${esc(t('rules.resumeBuilder'))}</button>
        </div>
      </div>`;
    } else if (provider.status === 'manual') {
      status = `<div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <p style="color:var(--text-muted);font-size:var(--text-sm);margin:0">${esc(t('rules.manualMode'))}</p>
        <button class="inline-create-btn"${dataAction(host.action('providerResolve'), c.id, 'builder')}>${esc(t('rules.enableBuilder'))}</button>
      </div>`;
    } else {
      status = `<p style="color:var(--text-muted);font-size:var(--text-sm);margin:0">${esc(t('rules.disconnected'))}</p>`;
    }
    const norm = value => String(value || '').trim().toLocaleLowerCase();
    const coreClass = engine && c.title
      ? engine.listClasses().find(record => norm(record.name) === norm(c.title))
      : null;
    const sheetClass = engine && s.className
      ? (engine.getItem('class', s.className) || engine.getItemByName('class', s.className))
      : null;
    const identityWarning = coreClass && sheetClass && coreClass.id !== sheetClass.id
      ? `<div class="codex-warnings">${esc(t('rules.coreClassMismatch', {
          core: coreClass.name,
          sheet: sheetClass.name,
        }))}</div>`
      : '';

    return `<div style="display:flex;flex-direction:column;gap:var(--space-4);max-width:44rem;padding-top:var(--space-3)">
      ${section(t('settings.layoutTitle'), layoutBody)}
      ${section(t('settings.dataTitle'), tools)}
      ${identityWarning}
      ${status}
    </div>`;
  }

  return { panelSettings };
}

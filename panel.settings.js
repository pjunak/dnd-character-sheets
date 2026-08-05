// ═══════════════════════════════════════════════════════════════
//  panel.settings.js — the ⚙ Settings tab (rightmost tool tab, beside the
//  Builder): everything sheet-scoped that isn't play or building.
//
//  • Sheet renderer — built-in and discovered renderer choices, PER SHEET +
//    per browser, so every player can independently choose a presentation for
//    each character without changing campaign data.
//  • Print & data — the Print / Export / Import actions that used to ride a
//    toolbar above the tab strip (moved here to reclaim the vertical space).
//    Import overwrites, so it's editor-only.
//  • The rules status line (engine/data connected / hand-fillable), formerly
//    on that host settings tab too.
// ═══════════════════════════════════════════════════════════════

export function makeSettingsPanel(ctx) {
  const { host, t, plural, ui, renderers } = ctx;
  const { esc, dataAction, dataOn } = host.h;
  const { section } = ui;

  function panelSettings(c, s, edit, engine) {
    const rendererContext = { sheet: s, engine };
    const rendererState = renderers.resolve(c.id, rendererContext);

    const opt = (renderer) => `
      <label style="display:flex;align-items:flex-start;gap:var(--space-2);padding:var(--space-2);border:1px solid ${rendererState.preferred === renderer.identity ? 'rgba(var(--accent-gold-rgb),.45)' : 'var(--border-subtle)'};border-radius:var(--radius);cursor:${renderer.unavailable ? 'not-allowed' : 'pointer'};background:var(--bg-surface);opacity:${renderer.unavailable ? '.65' : '1'}">
        <input type="radio" name="dse-renderer-${esc(c.id)}" value="${esc(renderer.identity)}" ${rendererState.preferred === renderer.identity ? 'checked' : ''} ${renderer.unavailable ? 'disabled' : dataOn('change', host.action('uiRendererSet'), c.id, renderer.identity)}>
        <span><strong style="color:var(--text-parchment)">${esc(renderer.label)}</strong>
          ${renderer.owner ? `<span style="display:block;color:var(--text-muted);font-size:var(--text-xs)">${esc(t('settings.rendererOwner', { owner: renderer.owner }))}</span>` : ''}
          <span style="display:block;color:var(--text-muted);font-size:var(--text-sm)">${esc(renderer.unavailable ? t('settings.rendererUnavailable') : renderer.description)}</span></span>
      </label>`;
    const rendererBody = `
      <p style="color:var(--text-muted);font-size:var(--text-sm);margin:0 0 var(--space-2)">${esc(t('settings.rendererHint'))}</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-2)">
        ${renderers.options(c.id, rendererContext).map(renderer => opt({
          ...renderer,
          label: renderer.identity === 'builtin:classic' ? t('settings.layoutClassic')
            : renderer.identity === 'builtin:compact' ? t('settings.layoutCompact') : renderer.label,
          description: renderer.identity === 'builtin:classic' ? t('settings.layoutClassicDesc')
            : renderer.identity === 'builtin:compact' ? t('settings.layoutCompactDesc') : renderer.description,
        })).join('')}
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
        : provider.reason === 'identity' ? t('rules.reconcileIdentity') : t('rules.reconcileManual');
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
      ${section(t('settings.rendererTitle'), rendererBody)}
      ${section(t('settings.dataTitle'), tools)}
      ${identityWarning}
      ${status}
    </div>`;
  }

  return { panelSettings };
}

import { parseSheet, serializeSheet } from './sheet-transfer.js';

export const TRANSFER_ACTIONS = Object.freeze([
  'printSheet',
  'exportSheet',
  'importOpen',
  'importClose',
  'importPreview',
  'importConfirm',
  'importUndo',
]);

export function registerTransferActions(deps) {
  const {
    host,
    NS,
    blank,
    sheetOf,
    getRules,
    safeHydrate,
    decisionsOf,
    buildPrintHtml,
    mutate,
    prepareSheetExport,
    uiState,
  } = deps;
  const register = (name, fn) => host.registerAction(name, fn);
  const timers = new Set();
  const later = (fn, delay) => { const id = setTimeout(() => { timers.delete(id); fn(); }, delay); timers.add(id); };
  // Print / PDF (B4.6): build a self-contained sheet and open it in a new window,
  // which auto-opens the browser's print dialog (→ paper or Save as PDF). Isolated
  // from host chrome + theme. No-ops safely without a DOM (tests / headless).
  register('printSheet', (cid) => {
    const ent = host.store.getCharacters().find((x) => x && x.id === cid) || { id: cid };
    const s = sheetOf(ent);
    const engine = getRules(s);
    const r = engine ? safeHydrate(engine, decisionsOf(s, engine)) : null;
    const html = buildPrintHtml(ent, s, r && r.sheet, engine);
    try {
      const w = window.open('', '_blank');
      if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print(); }
    } catch (_) {}
  });
  // Export (B4.6): download the character's sheet data as a JSON file (backup /
  // transfer). Serializes the normalized sheet; no-ops safely without a DOM.
  register('exportSheet', (cid) => {
    const ent = host.store.getCharacters().find((x) => x && x.id === cid) || { id: cid };
    const json = serializeSheet(prepareSheetExport(sheetOf(ent)));
    const fname = String(ent.name || 'character').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'character';
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      later(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 1000);
    } catch (_) {}
  });
  register('importOpen', (cid) => {
    uiState.remove(cid, 'importDraft');
    uiState.set(cid, 'importOpen', true);
    host.ui.rerender();
  });
  register('importClose', (cid) => {
    uiState.remove(cid, 'importOpen');
    uiState.remove(cid, 'importDraft');
    host.ui.rerender();
  });
  register('importPreview', async (cid) => {
    let raw = '';
    try {
      const input = document.getElementById('dse-import-file-' + cid);
      const file = input?.files?.[0];
      raw = file
        ? await file.text()
        : (document.getElementById('dse-import-' + cid)?.value || '');
    } catch {
      uiState.set(cid, 'importDraft', { ok: false, code: 'read' });
      host.ui.rerender();
      return;
    }
    const draft = parseSheet(raw, {
      template: blank(),
      normalize: sheet => sheetOf({ addonData: { [NS]: sheet } }),
    });
    uiState.set(cid, 'importDraft', draft);
    host.ui.rerender();
  });
  register('importConfirm', (cid) => {
    const draft = uiState.get(cid, 'importDraft');
    if (!draft?.ok || draft.status === 'completed') return;
    const current = host.store.getCharacters()
      .find(character => character?.id === cid);
    if (!current) return;
    if (draft.legacy && getRules(draft.sheet)) {
      draft.sheet.rulesMode = 'manual';
    }
    uiState.set(cid, 'importDraft', {
      ...draft,
      status: 'completed',
      previous: sheetOf(current),
    });
    mutate(cid, () => draft.sheet);
    host.ui.announce(host.i18n.t('data.importComplete'));
  });
  register('importUndo', (cid) => {
    const draft = uiState.get(cid, 'importDraft');
    if (draft?.status !== 'completed' || !draft.previous) return;
    const previous = draft.previous;
    uiState.remove(cid, 'importOpen');
    uiState.remove(cid, 'importDraft');
    mutate(cid, () => previous);
    host.ui.announce(host.i18n.t('data.importUndone'));
  });
  return () => { for (const timer of timers) clearTimeout(timer); timers.clear(); };
}

export const TRANSFER_ACTIONS = Object.freeze(['printSheet','exportSheet','importOpen','importClose','importApply']);

export function registerTransferActions(deps) {
  const { host, NS, sheetOf, getRules, safeHydrate, decisionsOf, buildPrintHtml, mutate, uiState } = deps;
  const register = (name, fn) => host.registerAction(name, fn);
  const timers = new Set();
  const later = (fn, delay) => { const id = setTimeout(() => { timers.delete(id); fn(); }, delay); timers.add(id); };
  // Print / PDF (B4.6): build a self-contained sheet and open it in a new window,
  // which auto-opens the browser's print dialog (→ paper or Save as PDF). Isolated
  // from host chrome + theme. No-ops safely without a DOM (tests / headless).
  register('printSheet', (cid) => {
    const ent = host.store.getCharacters().find((x) => x && x.id === cid) || { id: cid };
    const s = sheetOf(ent);
    const engine = getRules();
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
    const json = JSON.stringify(sheetOf(ent), null, 2);
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
    uiState.set(cid, 'importOpen', true);
    host.ui.rerender();
  });
  register('importClose', (cid) => {
    uiState.remove(cid, 'importOpen');
    host.ui.rerender();
  });
  register('importApply', (cid) => {
    let raw = '';
    try { raw = (document.getElementById('dse-import-' + cid) || {}).value || ''; } catch (_) {}
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    uiState.remove(cid, 'importOpen');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { host.ui.rerender(); return; }
    // Replace the whole sheet with the imported data, normalized through sheetOf.
    mutate(cid, () => sheetOf({ addonData: { [NS]: parsed } }));
  });
  return () => { for (const timer of timers) clearTimeout(timer); timers.clear(); };
}

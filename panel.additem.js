// ═══════════════════════════════════════════════════════════════
//  panel.additem.js — the "Add to Backpack" wizard (a floating overlay).
//
//  Replaces the old inline blank-row-plus-picker. A search box over the whole
//  compendium, a drill-down category TREE with a breadcrumb, and a batch tray:
//  stage several items (each with a quantity you can type), then commit once.
//
//  Data source: engine.getRecords(kind) returns the FULL localized records for
//  any compendium kind (the slim list* projections drop the subtype fields the
//  deeper tree levels need). Tree depth per branch:
//    Weapons → category (simple/martial) → range (melee/ranged) → items
//    Armor   → armorType (light/medium/heavy/shield) → items
//    Tools   → type (Artisan's / Other) → items
//    Magic   → rarity → items
//    Gear / Packs → flat (the records carry no subtype)
//  Book-absent (no PHB addon) degrades to the custom-item field only.
//
//  State lives in localStorage (keyed by character id), like the other overlays,
//  because every action re-renders the whole fragment:
//    dse-additem:<cid>       'open'
//    dse-additem-path:<cid>  '' | '<kind>' | '<kind>/<v1>' | '<kind>/<v1>/<v2>'
//    dse-additem-q:<cid>     current search query (non-empty ⇒ flat search mode)
//    dse-additem-cart:<cid>  JSON [{ key, kind, ref, name, qty, custom }]
//  The render is pure (reads that state); the actions in entry.js mutate it.
// ═══════════════════════════════════════════════════════════════

// The category tree. Each kind lists its facet fields, outer → inner; an empty
// facets array is a flat category (gear, packs). `label` prettifies a raw value.
export const ADDITEM_TREE = [
  { id: 'weapon', kind: 'weapon', labelKey: 'additem.catWeapons', facets: [{ field: 'category' }, { field: 'range' }] },
  { id: 'armor', kind: 'armor', labelKey: 'additem.catArmor', facets: [{ field: 'armorType' }] },
  { id: 'gear', kind: 'gear', labelKey: 'additem.catGear', facets: [] },
  { id: 'tool', kind: 'tool', labelKey: 'additem.catTools', facets: [{ field: 'type' }] },
  { id: 'magic-item', kind: 'magic-item', labelKey: 'additem.catMagic', facets: [{ field: 'rarity' }] },
  { id: 'pack', kind: 'pack', labelKey: 'additem.catPacks', facets: [] },
];
const ITEM_CAP = 80;   // max item rows shown at once (search / a tree leaf)

export function makeAddItemPanel(ctx) {
  const { host, t, num, titleize, ui } = ctx;
  const { esc, dataAction, dataOn } = host.h;

  const norm = (x) => String(x == null ? '' : x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const catLabel = (node) => t(node.labelKey);
  const facetLabel = (v) => titleize(String(v));
  const recsOf = (engine, kind) => (engine && engine.getRecords ? (engine.getRecords(kind) || []) : []);

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const readCart = (cid) => { try { return JSON.parse(lsGet('dse-additem-cart:' + cid) || '[]') || []; } catch (_) { return []; } };

  // A clickable folder row (drill down / breadcrumb target).
  function folderRow(cid, path, label, count) {
    return `<button class="dse-aiw-folder"${dataAction(host.action('addItemNav'), cid, path)}>
      <span class="dse-aiw-fi" aria-hidden="true">▸</span>
      <span class="dse-aiw-fn">${esc(label)}</span>
      <span class="dse-aiw-fc">${esc(String(count))}</span></button>`;
  }

  // A result row: name + a facet subtitle + an Add button that stages it.
  function itemRow(cid, kind, rec, subtitle) {
    return `<div class="dse-aiw-res">
      <div class="dse-aiw-meta"><div class="dse-aiw-rn">${esc(rec.name || rec.id)}</div>${subtitle ? `<div class="dse-aiw-rt">${esc(subtitle)}</div>` : ''}</div>
      <button class="inline-create-btn"${dataAction(host.action('addItemStage'), cid, kind, rec.id)}>＋ ${esc(t('additem.add'))}</button></div>`;
  }
  function itemList(cid, kind, recs, subtitleOf) {
    const shown = recs.slice(0, ITEM_CAP);
    const rows = shown.map((r) => itemRow(cid, kind, r, subtitleOf ? subtitleOf(r) : '')).join('');
    const more = recs.length > ITEM_CAP
      ? `<div class="dse-aiw-more">${esc(t('additem.moreN', { n: recs.length - ITEM_CAP }))}</div>`
      : '';
    return `<div class="dse-aiw-results">${rows}${more}</div>`;
  }
  const distinct = (recs, field) => {
    const seen = [];
    for (const r of recs) { const v = String(r[field] == null ? '' : r[field]); if (v && !seen.includes(v)) seen.push(v); }
    return seen.sort((a, b) => a.localeCompare(b));
  };

  // A weapon/armor subtitle line for the result rows (best-effort, from facets).
  function subtitleOf(node) {
    return (r) => node.facets.map((f) => r[f.field]).filter(Boolean).map(facetLabel).join(' · ');
  }

  // Flat search across every browsable kind (name substring, diacritic-folded).
  function searchBody(cid, q, engine) {
    const term = norm(q);
    const hits = [];
    for (const node of ADDITEM_TREE) {
      for (const r of recsOf(engine, node.kind)) {
        if (norm(r.name).includes(term)) hits.push({ kind: node.kind, rec: r, node });
        if (hits.length > ITEM_CAP + 1) break;
      }
      if (hits.length > ITEM_CAP + 1) break;
    }
    if (!hits.length) return `<div class="dse-aiw-empty">${esc(t('additem.noResults', { q }))}</div>`;
    const shown = hits.slice(0, ITEM_CAP);
    const rows = shown.map(({ kind, rec, node }) => itemRow(cid, kind, rec, catLabel(node))).join('');
    const more = hits.length > ITEM_CAP ? `<div class="dse-aiw-more">${esc(t('additem.moreNarrow'))}</div>` : '';
    return `<div class="dse-aiw-results">${rows}${more}</div>`;
  }

  // The category tree at the current path (folders for the next facet + the
  // items matching the path so far), with a breadcrumb above.
  function treeBody(cid, path, engine) {
    const parts = path ? path.split('/') : [];
    const node = ADDITEM_TREE.find((n) => n.id === parts[0]);

    // Breadcrumb: All items › <kind> › <facet…>.
    const crumbSeg = (p, label, here) => here
      ? `<span class="dse-aiw-cr here">${esc(label)}</span>`
      : `<button class="dse-aiw-cr"${dataAction(host.action('addItemNav'), cid, p)}>${esc(label)}</button>`;
    const crumbs = [crumbSeg('', t('additem.allItems'), !node)];
    if (node) {
      crumbs.push(crumbSeg(node.id, catLabel(node), parts.length === 1));
      for (let i = 1; i < parts.length; i++) {
        crumbs.push(crumbSeg(parts.slice(0, i + 1).join('/'), facetLabel(parts[i]), i === parts.length - 1));
      }
    }
    const up = node ? `<button class="dse-aiw-up"${dataAction(host.action('addItemNav'), cid, parts.slice(0, -1).join('/'))}>↑ ${esc(t('additem.up'))}</button>` : '';
    const crumbBar = `<div class="dse-aiw-crumbs">${crumbs.join('<span class="dse-aiw-sep">›</span>')}${up}</div>`;

    // Root: the top categories.
    if (!node) {
      const folders = ADDITEM_TREE.map((n) => folderRow(cid, n.id, catLabel(n), recsOf(engine, n.kind).length)).join('');
      return crumbBar + `<div class="dse-aiw-folders">${folders}</div>`;
    }

    // Inside a kind: filter by the facet values chosen so far.
    const chosen = parts.slice(1);
    let recs = recsOf(engine, node.kind);
    node.facets.slice(0, chosen.length).forEach((f, i) => { recs = recs.filter((r) => String(r[f.field] == null ? '' : r[f.field]) === chosen[i]); });
    const nextFacet = node.facets[chosen.length];

    let foldersHtml = '';
    if (nextFacet) {
      const vals = distinct(recs, nextFacet.field);
      foldersHtml = `<div class="dse-aiw-folders">${vals.map((v) => {
        const cnt = recs.filter((r) => String(r[nextFacet.field] == null ? '' : r[nextFacet.field]) === v).length;
        return folderRow(cid, path + '/' + v, facetLabel(v), cnt);
      }).join('')}</div>`;
    }
    const divider = nextFacet ? `<div class="dse-aiw-divlbl">${esc(t('additem.allIn', { cat: catLabel(node) }))}</div>` : '';
    return crumbBar + foldersHtml + divider + itemList(cid, node.kind, recs, subtitleOf(node));
  }

  // The batch tray: staged items, each with a typeable quantity, then commit.
  function cartRail(cid) {
    const cart = readCart(cid);
    const total = cart.reduce((n, it) => n + num(it.qty, 1), 0);
    const rows = cart.length
      ? cart.map((it) => `<div class="dse-aiw-ci">
          <span class="dse-aiw-cn">${esc(it.name || t('misc.unnamed'))}</span>
          ${ui.numField(dataOn('change', host.action('addItemQty'), cid, it.key, '$value'), num(it.qty, 1), { min: 1, width: '2.4rem', ariaLabel: t('additem.qty') })}
          <button class="inline-create-btn dse-aiw-cx" title="${esc(t('action.remove'))}"${dataAction(host.action('addItemUnstage'), cid, it.key)}>✕</button>
        </div>`).join('')
      : `<div class="dse-aiw-empty">${esc(t('additem.cartEmpty'))}</div>`;
    const foot = cart.length
      ? `<div class="dse-aiw-cfoot">
          <button class="inline-create-btn"${dataAction(host.action('addItemClear'), cid)}>${esc(t('additem.clear'))}</button>
          <button class="edit-save-btn"${dataAction(host.action('addItemCommit'), cid)}>${esc(t('additem.commit', { n: total }))}</button>
        </div>`
      : '';
    return `<div class="dse-aiw-cart">
      <div class="dse-aiw-ch">${esc(t('additem.cartTitle'))} <span class="dse-aiw-cc">${esc(String(total))}</span></div>
      <div class="dse-aiw-cbody">${rows}</div>${foot}</div>`;
  }

  // The whole overlay. Rendered at the fragment root by entry.js when the flag is set.
  function addItemModal(c, s, engine) {
    const cid = c.id;
    const q = lsGet('dse-additem-q:' + cid) || '';
    const path = lsGet('dse-additem-path:' + cid) || '';
    const hasBook = !!(engine && engine.getRecords);

    const search = `<div class="dse-aiw-search">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--text-muted)" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
      <input id="dse-additem-q-${esc(cid)}" class="edit-input" type="search" value="${esc(q)}" placeholder="${esc(t('additem.search'))}" aria-label="${esc(t('additem.search'))}"${dataOn('change', host.action('addItemSearch'), cid)}></div>`;

    let browse;
    if (!hasBook) browse = `<div class="dse-aiw-empty">${esc(t('additem.noBook'))}</div>`;
    else if (q.trim()) browse = searchBody(cid, q.trim(), engine);
    else browse = treeBody(cid, path, engine);

    // Custom / homebrew item: a free-text name → staged like any other pick.
    const custom = `<div class="dse-aiw-custom">
      <input id="dse-additem-custom-${esc(cid)}" class="edit-input" placeholder="${esc(t('additem.customPlaceholder'))}" aria-label="${esc(t('additem.custom'))}">
      <button class="inline-create-btn"${dataAction(host.action('addItemStageCustom'), cid)}>＋ ${esc(t('additem.customAdd'))}</button></div>`;

    const body = `<div class="dse-aiw">
      <div class="dse-aiw-browse">${search}${browse}${custom}</div>
      ${cartRail(cid)}</div>`;

    return `<div class="addon-wizard-overlay">
      <div style="position:absolute;inset:0" title="${esc(t('action.cancel'))}"${dataAction(host.action('addItemClose'), cid)}></div>
      <div class="addon-wizard dse-aiw-panel" role="dialog" aria-modal="true" aria-label="${esc(t('additem.title'))}" style="position:relative;z-index:1">
        <div class="addon-wizard-head">
          <h3><span style="color:var(--accent-gold)">${ui.bagIcon(17)}</span> ${esc(t('additem.title'))}</h3>
          <button class="inline-create-btn" title="${esc(t('action.cancel'))}"${dataAction(host.action('addItemClose'), cid)}>✕</button>
        </div>
        <div class="addon-wizard-body">${body}</div>
      </div>
    </div>`;
  }

  return { addItemModal };
}

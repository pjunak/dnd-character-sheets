export const SHEET_TRANSFER_FORMAT = 'dnd-sheets.character';
export const SHEET_TRANSFER_VERSION = 1;

const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 16;
const MAX_NODES = 20000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isObject = value => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype
    || Object.getPrototypeOf(value) === null)
);

function validateTree(value) {
  let nodes = 0;
  const visit = (item, depth) => {
    nodes += 1;
    if (nodes > MAX_NODES) return 'limit';
    if (depth > MAX_DEPTH) return 'depth';
    if (item === null || typeof item === 'string' || typeof item === 'boolean') {
      return null;
    }
    if (typeof item === 'number') return Number.isFinite(item) ? null : 'shape';
    if (Array.isArray(item)) {
      for (const child of item) {
        const error = visit(child, depth + 1);
        if (error) return error;
      }
      return null;
    }
    if (!isObject(item)) return 'shape';
    for (const [key, child] of Object.entries(item)) {
      if (FORBIDDEN_KEYS.has(key)) return 'unsafe';
      const error = visit(child, depth + 1);
      if (error) return error;
    }
    return null;
  };
  return visit(value, 0);
}

function byteLength(value) {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length * 2;
}

function sheetFromDocument(document) {
  if (!isObject(document)) return { error: 'shape' };
  if (!Object.hasOwn(document, 'format')) {
    return { sheet: document, legacy: true };
  }
  const keys = Object.keys(document).sort();
  if (keys.join('\0') !== ['format', 'sheet', 'version'].join('\0')) {
    return { error: 'shape' };
  }
  if (document.format !== SHEET_TRANSFER_FORMAT) return { error: 'format' };
  if (document.version !== SHEET_TRANSFER_VERSION) return { error: 'version' };
  if (!isObject(document.sheet)) return { error: 'shape' };
  return { sheet: document.sheet, legacy: false };
}

function validateTopLevel(sheet, template) {
  const allowed = new Set(Object.keys(template));
  for (const key of Object.keys(sheet)) {
    if (!allowed.has(key)) return 'shape';
  }
  for (const [key, value] of Object.entries(sheet)) {
    const expected = template[key];
    if (expected === null) {
      if (value !== null && !isObject(value)) return 'shape';
    } else if (Array.isArray(expected)) {
      if (!Array.isArray(value)) return 'shape';
    } else if (isObject(expected)) {
      if (!isObject(value)) return 'shape';
    } else if (typeof value !== typeof expected) {
      return 'shape';
    }
  }
  if (sheet.v !== undefined
      && (!Number.isInteger(sheet.v) || sheet.v < 1 || sheet.v > template.v)) {
    return 'version';
  }
  return null;
}

export function serializeSheet(sheet) {
  return JSON.stringify({
    format: SHEET_TRANSFER_FORMAT,
    version: SHEET_TRANSFER_VERSION,
    sheet,
  }, null, 2);
}

export function parseSheet(raw, { template, normalize }) {
  const text = String(raw || '');
  if (!text.trim()) return { ok: false, code: 'empty' };
  if (byteLength(text) > MAX_BYTES) return { ok: false, code: 'size' };

  let document;
  try {
    document = JSON.parse(text);
  } catch {
    return { ok: false, code: 'json' };
  }

  const extracted = sheetFromDocument(document);
  if (extracted.error) return { ok: false, code: extracted.error };
  const treeError = validateTree(extracted.sheet);
  if (treeError) return { ok: false, code: treeError };
  const shapeError = validateTopLevel(extracted.sheet, template);
  if (shapeError) return { ok: false, code: shapeError };

  const sheet = normalize(extracted.sheet);
  return {
    ok: true,
    sheet,
    legacy: extracted.legacy,
    preview: {
      className: String(sheet.className || ''),
      level: Number(sheet.level) || 1,
      inventory: sheet.inventory.length,
      spells: sheet.spells.length,
    },
  };
}

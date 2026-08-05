export const RENDERER_CONTRACT = 'dnd-sheets.renderer';
export const RENDERER_CONTRACT_VERSION = 2;
export const COMPACT_RENDERER = 'builtin:compact';
export const CLASSIC_RENDERER = 'builtin:classic';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MATCH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUIRED_PERMISSIONS = Object.freeze(['ui:override', 'data:read:characters']);
const APPLICABILITY_FIELDS = Object.freeze(['classIds', 'subclassIds', 'editions', 'rulesetIds']);

const clone = value => {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const freezeTree = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
};

function normalizeApplicability(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid renderer applicability');
  if (Object.keys(value).some(key => !APPLICABILITY_FIELDS.includes(key))) throw new TypeError('unknown renderer applicability field');
  const normalized = {};
  for (const field of APPLICABILITY_FIELDS) {
    if (value[field] == null) continue;
    if (!Array.isArray(value[field]) || !value[field].length || value[field].length > 64) throw new TypeError('invalid renderer applicability list');
    const items = [...new Set(value[field].map(item => String(item || '')))];
    if (items.some(item => !MATCH_ID_RE.test(item))) throw new TypeError('invalid renderer applicability id');
    normalized[field] = Object.freeze(items);
  }
  return Object.keys(normalized).length ? Object.freeze(normalized) : null;
}

function applicabilityContext(value) {
  const sheet = value?.sheet || value || {};
  const classes = Array.isArray(sheet.classes) ? sheet.classes : [];
  let identity = sheet.rulesProvider?.identity || {};
  try { identity = value?.engine?.getContextIdentity?.() || identity; } catch (_) {}
  return Object.freeze({
    classIds: Object.freeze([...new Set(classes.map(entry => String(entry?.classId || '')).filter(Boolean))]),
    subclassIds: Object.freeze([...new Set(classes.map(entry => String(entry?.subclass || '')).filter(Boolean))]),
    edition: String(identity.edition || sheet.ruleset || ''),
    rulesetId: String(identity.rulesetId || ''),
  });
}

function applies(renderer, value) {
  if (!renderer.appliesTo) return true;
  const context = applicabilityContext(value);
  const tests = [
    ['classIds', context.classIds],
    ['subclassIds', context.subclassIds],
    ['editions', context.edition ? [context.edition] : []],
    ['rulesetIds', context.rulesetId ? [context.rulesetId] : []],
  ];
  return tests.every(([field, selected]) => !renderer.appliesTo[field]
    || renderer.appliesTo[field].some(id => selected.includes(id)));
}

const builtins = Object.freeze([
  Object.freeze({
    identity: COMPACT_RENDERER,
    id: 'compact',
    label: 'Compact',
    description: 'Dense default layout for everyday play.',
    owner: 'D&D Character Sheets',
    builtin: true,
    baseLayout: 'compact',
  }),
  Object.freeze({
    identity: CLASSIC_RENDERER,
    id: 'classic',
    label: 'Classic',
    description: 'Roomier traditional layout.',
    owner: 'D&D Character Sheets',
    builtin: true,
    baseLayout: 'classic',
  }),
]);

function inspectHandle(handle) {
  try {
    const api = handle?.api;
    const provider = handle?.provider || {};
    const permissions = new Set(Array.isArray(provider.permissions) ? provider.permissions : []);
    if (!api || api.apiVersion !== RENDERER_CONTRACT_VERSION
        || typeof api.descriptor !== 'function' || typeof api.render !== 'function') return null;
    if (REQUIRED_PERMISSIONS.some(permission => !permissions.has(permission))) return null;
    const descriptor = api.descriptor();
    const id = String(descriptor?.id || '');
    if (!descriptor || !ID_RE.test(id) || Number(descriptor.sheetSchemaVersion) !== 1) return null;
    const appliesTo = normalizeApplicability(descriptor.appliesTo);
    const providerId = String(provider.addonId || '');
    const identity = `${providerId}:${id}`;
    if (!providerId || identity.length > 128) return null;
    return Object.freeze({
      identity,
      id,
      label: String(descriptor.label || id).slice(0, 120),
      description: String(descriptor.description || '').slice(0, 300),
      owner: String(provider.addonName || providerId).slice(0, 120),
      provider: Object.freeze({
        addonId: providerId,
        addonVersion: String(provider.addonVersion || ''),
        contractVersion: String(provider.contractVersion || ''),
      }),
      builtin: false,
      baseLayout: 'compact',
      appliesTo,
      api,
    });
  } catch (_) {
    return null;
  }
}

export function createRendererRegistry(host, uiState) {
  const discovered = () => {
    let handles = [];
    try { handles = host.listServices?.(RENDERER_CONTRACT) || []; } catch (_) {}
    const external = handles.map(inspectHandle).filter(Boolean);
    return [...builtins, ...external].sort((left, right) => {
      if (left.builtin !== right.builtin) return left.builtin ? -1 : 1;
      return left.identity.localeCompare(right.identity);
    });
  };
  const available = context => discovered().filter(renderer => applies(renderer, context));

  const resolve = (characterId, context) => {
    const preferred = uiState.getRenderer(characterId);
    const renderer = available(context).find(candidate => candidate.identity === preferred)
      || builtins[0];
    return Object.freeze({ preferred, renderer, unavailable: renderer.identity !== preferred });
  };

  return Object.freeze({
    list: discovered,
    resolve,
    options(characterId, context) {
      const state = resolve(characterId, context);
      const options = available(context);
      if (state.unavailable) options.push(Object.freeze({
        identity: state.preferred,
        label: state.preferred,
        description: 'This renderer is currently unavailable; Compact is being used.',
        owner: '',
        unavailable: true,
      }));
      return options;
    },
    select(characterId, identity, context) {
      const value = String(identity || '');
      if (!available(context).some(candidate => candidate.identity === value)) return false;
      uiState.setRenderer(characterId, value);
      return true;
    },
    baseLayout(characterId, context) {
      return resolve(characterId, context).renderer.baseLayout;
    },
    render(characterId, surface, payload, defaultHtml, context) {
      const state = resolve(characterId, context);
      const renderer = state.renderer;
      if (renderer.builtin) return defaultHtml;
      try {
        const input = freezeTree(clone({
          ...payload,
          sheetSchemaVersion: 1,
          surface: String(surface || ''),
          defaultHtml,
        }));
        const html = renderer.api.render(input);
        return typeof html === 'string' && html.length <= 1_000_000 ? html : defaultHtml;
      } catch (_) {
        return defaultHtml;
      }
    },
  });
}

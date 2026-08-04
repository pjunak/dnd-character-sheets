const MATERIALIZED_FIELDS = Object.freeze([
  'ruleset',
  'className',
  'subclass',
  'level',
  'abilities',
  'maxHp',
  'ac',
  'initiative',
  'speed',
  'profBonus',
  'manualSaveProf',
  'saveProf',
  'skillProf',
  'skillExpertise',
]);

function clone(value) {
  return value === undefined
    ? null
    : JSON.parse(JSON.stringify(value));
}

function equal(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)
        || left.length !== right.length) return false;
    return left.every((value, index) => equal(value, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length
      || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every(key => equal(left[key], right[key]));
}

export function materializedValues(sheet) {
  return Object.fromEntries(
    MATERIALIZED_FIELDS.map(field => [field, clone(sheet?.[field])]),
  );
}

function normalizeIdentity(identity) {
  if (typeof identity === 'string') {
    return Object.freeze({ edition: identity, legacy: true });
  }
  const value = identity && typeof identity === 'object' ? identity : {};
  if (value.legacy) return Object.freeze({ edition: String(value.edition || ''), legacy: true });
  return Object.freeze({
    engineAddonId: String(value.engineAddonId || ''),
    engineAddonVersion: String(value.engineAddonVersion || ''),
    engineContractVersion: String(value.engineContractVersion || ''),
    providerAddonId: String(value.providerAddonId || ''),
    providerAddonVersion: String(value.providerAddonVersion || ''),
    providerContractVersion: String(value.providerContractVersion || ''),
    contentRevision: String(value.contentRevision || ''),
    rulesetId: String(value.rulesetId || ''),
    rulesetVersion: Number(value.rulesetVersion) || 0,
    edition: String(value.edition || ''),
  });
}

export function captureProviderState(sheet, identity) {
  sheet.rulesMode = 'auto';
  sheet.rulesProvider = {
    identity: normalizeIdentity(identity),
    materialized: materializedValues(sheet),
  };
  return sheet;
}

export function resolveProviderState(sheet, identity, available = true) {
  if (!available) return Object.freeze({ status: 'unavailable' });
  if (sheet?.rulesMode === 'manual') {
    return Object.freeze({ status: 'manual' });
  }
  const state = sheet?.rulesProvider;
  if (!state?.materialized) return Object.freeze({ status: 'active' });
  const current = normalizeIdentity(identity);
  const stored = state.identity
    ? normalizeIdentity(state.identity)
    : normalizeIdentity(state.edition || sheet?.ruleset || '');
  if (stored.edition !== current.edition) {
    return Object.freeze({ status: 'reconcile', reason: 'edition' });
  }
  if (stored.legacy || !equal(stored, current)) {
    return Object.freeze({ status: 'reconcile', reason: 'identity' });
  }
  const changed = MATERIALIZED_FIELDS.filter(
    field => !equal(sheet?.[field], state.materialized[field]),
  );
  return changed.length
    ? Object.freeze({ status: 'reconcile', reason: 'manual', changed })
    : Object.freeze({ status: 'active' });
}

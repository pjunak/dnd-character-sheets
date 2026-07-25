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

export function captureProviderState(sheet, edition) {
  sheet.rulesMode = 'auto';
  sheet.rulesProvider = {
    edition: String(edition || ''),
    materialized: materializedValues(sheet),
  };
  return sheet;
}

export function resolveProviderState(sheet, edition, available = true) {
  if (!available) return Object.freeze({ status: 'unavailable' });
  if (sheet?.rulesMode === 'manual') {
    return Object.freeze({ status: 'manual' });
  }
  const state = sheet?.rulesProvider;
  if (!state?.materialized) return Object.freeze({ status: 'active' });
  if (String(state.edition || '') !== String(edition || '')) {
    return Object.freeze({ status: 'reconcile', reason: 'edition' });
  }
  const changed = MATERIALIZED_FIELDS.filter(
    field => !equal(sheet?.[field], state.materialized[field]),
  );
  return changed.length
    ? Object.freeze({ status: 'reconcile', reason: 'manual', changed })
    : Object.freeze({ status: 'active' });
}

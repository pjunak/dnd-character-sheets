import { registerActionMap } from './actions.shared.js';

export const RESOURCE_ACTIONS = Object.freeze([
  'resourceAdd', 'resourceDel', 'resourceAdjust', 'resourceSet',
  'resourceUseAdjust', 'resourceUseReset', 'restOpen', 'restClose',
  'restSpendHitDie', 'restApply', 'featureToggle',
]);

export function applyHpChange(sheet, delta, maxHp, num, clampHp) {
  const next = { ...sheet };
  let change = Number(delta) || 0;
  if (change < 0) {
    const temp = num(next.tempHp, 0);
    const absorbed = Math.min(temp, -change);
    next.tempHp = temp - absorbed;
    change += absorbed;
  }
  next.hp = clampHp(num(next.hp, maxHp) + change, maxHp);
  return next;
}

export function registerResourceActions(deps) {
  const { host, num, uid, mutate, getRules, safeHydrate, decisionsOf, effectiveMaxHp, hitDieAvg, uiState } = deps;
  const clampResource = (current, max) => num(max, 0) > 0
    ? Math.max(0, Math.min(num(max, 0), num(current, 0)))
    : Math.max(0, num(current, 0));
  const hydrate = (sheet) => {
    const engine = getRules(sheet);
    const result = engine ? safeHydrate(engine, decisionsOf(sheet, engine)) : null;
    return result && result.sheet;
  };
  const currentResource = (sheet, resource) => Object.prototype.hasOwnProperty.call(sheet.resourceUses || {}, resource.key)
    ? num(sheet.resourceUses[resource.key], resource.max) : num(resource.max, 0);

  registerActionMap(host, {
    resourceAdd(cid) {
      mutate(cid, (sheet) => {
        sheet.resources = sheet.resources.concat([{ id: uid('res'), name: '', current: 0, max: 0 }]);
        return sheet;
      });
    },
    resourceDel(cid, rid) {
      mutate(cid, (sheet) => { sheet.resources = sheet.resources.filter((resource) => resource.id !== rid); return sheet; });
    },
    resourceAdjust(cid, rid, delta) {
      mutate(cid, (sheet) => {
        sheet.resources = sheet.resources.map((resource) => resource.id === rid
          ? { ...resource, current: clampResource(num(resource.current, 0) + Number(delta), resource.max) } : resource);
        return sheet;
      });
    },
    resourceSet(cid, rid, field, value) {
      mutate(cid, (sheet) => {
        sheet.resources = sheet.resources.map((resource) => {
          if (resource.id !== rid) return resource;
          if (field === 'name') return { ...resource, name: String(value) };
          if (field === 'max') {
            const max = Math.max(0, num(value, 0));
            return { ...resource, max, current: clampResource(resource.current, max) };
          }
          return field === 'current' ? { ...resource, current: clampResource(value, resource.max) } : resource;
        });
        return sheet;
      });
    },
    resourceUseAdjust(cid, key, delta, max) {
      mutate(cid, (sheet) => {
        const limit = num(max, 0);
        const uses = { ...(sheet.resourceUses || {}) };
        const id = String(key);
        const current = Object.prototype.hasOwnProperty.call(uses, id) ? num(uses[id], limit) : limit;
        uses[id] = limit > 0 ? Math.max(0, Math.min(limit, current + Number(delta))) : Math.max(0, current + Number(delta));
        sheet.resourceUses = uses;
        return sheet;
      });
    },
    resourceUseReset(cid, key) {
      mutate(cid, (sheet) => {
        const uses = { ...(sheet.resourceUses || {}) };
        delete uses[String(key)];
        sheet.resourceUses = uses;
        return sheet;
      });
    },
    featureToggle(cid, key) {
      mutate(cid, (sheet) => {
        const computed = hydrate(sheet);
        const activation = (computed && computed.activations || [])
          .find((candidate) => candidate.key === key);
        if (!activation || !activation.available) return sheet;
        const active = { ...(sheet.activeFeatures || {}) };
        if (active[key]) {
          delete active[key];
        } else {
          if (activation.exclusiveGroup) {
            for (const candidate of (computed && computed.activations) || []) {
              if (candidate.exclusiveGroup === activation.exclusiveGroup) delete active[candidate.key];
            }
          }
          active[key] = true;
        }
        sheet.activeFeatures = active;
        return sheet;
      });
    },
    restOpen(cid) {
      uiState.set(cid, 'restOpen', true);
      host.ui.rerender();
    },
    restClose(cid) {
      uiState.remove(cid, 'restOpen');
      host.ui.rerender();
    },
    restSpendHitDie(cid, dieKey) {
      mutate(cid, (sheet) => {
        const computed = hydrate(sheet);
        const resource = computed && (computed.resources || []).find((item) => item.key === dieKey && item.kind === 'hitdice');
        if (!resource || currentResource(sheet, resource) <= 0) return sheet;
        sheet.resourceUses = { ...(sheet.resourceUses || {}), [dieKey]: currentResource(sheet, resource) - 1 };
        const con = computed.abilities && computed.abilities.CON ? num(computed.abilities.CON.mod, 0) : 0;
        const heal = Math.max(1, hitDieAvg(resource.die, getRules(sheet)) + con);
        const maxHp = effectiveMaxHp(sheet, computed);
        sheet.hp = maxHp > 0 ? Math.min(maxHp, num(sheet.hp, 0) + heal) : num(sheet.hp, 0) + heal;
        return sheet;
      });
    },
    restApply(cid, kind) {
      const long = String(kind) === 'long';
      uiState.remove(cid, 'restOpen');
      mutate(cid, (sheet) => {
        const computed = hydrate(sheet);
        const resources = (computed && computed.resources) || [];
        const totalLevel = computed ? num(computed.totalLevel, num(sheet.level, 1)) : num(sheet.level, 1);
        const maxHp = effectiveMaxHp(sheet, computed);
        const ability = (id) => computed && computed.abilities && computed.abilities[id] ? num(computed.abilities[id].mod, 0) : 0;
        const uses = { ...(sheet.resourceUses || {}) };
        const regain = (resource, amount) => {
          const max = num(resource.max, 0);
          const current = Object.prototype.hasOwnProperty.call(uses, resource.key) ? num(uses[resource.key], max) : max;
          let next = amount === 'full' ? max
            : amount === 'halfLevel' ? Math.min(max, current + Math.max(1, Math.floor(totalLevel / 2)))
            : amount && typeof amount === 'object' && amount.abilityMod
              ? Math.min(max, current + Math.max(1, ability(amount.abilityMod)))
              : Math.min(max, current + num(amount, 0));
          if (next >= max) delete uses[resource.key]; else uses[resource.key] = next;
        };
        const triggers = long ? ['short', 'long'] : ['short'];
        for (const resource of resources) {
          for (const recharge of resource.recharge || []) if (triggers.includes(recharge.on)) regain(resource, recharge.amount);
        }
        sheet.resourceUses = uses;
        if (long) {
          sheet.hp = maxHp > 0 ? maxHp : num(sheet.hp, 0);
          sheet.tempHp = 0;
          sheet.activeFeatures = {};
        }
        return sheet;
      });
    },
  });
}

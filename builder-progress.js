function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function grantTotal(sheet, id) {
  const grant = (Array.isArray(sheet.abilityGrants) ? sheet.abilityGrants : [])
    .find(candidate => candidate?.id === id);
  return Object.values(grant?.assign || {})
    .reduce((total, value) => total + Math.max(0, number(value)), 0);
}

function choiceValues(sheet, choice) {
  const choices = sheet.featureChoices || {};
  const count = Math.max(1, number(choice.count, 1));
  const values = [];
  for (let index = 0; index < count; index++) {
    const key = count > 1 ? `${choice.id}#${index}` : choice.id;
    const value = choices[key] || (index === 0 ? choice.default : '');
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

export function descriptorCompletion(sheet, choice, engine) {
  if (choice.kind !== 'asiMode') {
    const required = Math.max(1, number(choice.count, 1));
    const picked = choiceValues(sheet, choice).length;
    return Object.freeze({ done: picked >= required, picked, required });
  }

  const mode = sheet.featureChoices?.[choice.id] || '';
  if (mode === 'asi') {
    const required = Math.max(1, number(engine.getRuleset().constants.asi.budget, 2));
    const picked = grantTotal(sheet, `${choice.id}:ability`);
    return Object.freeze({ done: picked >= required, picked, required, mode });
  }
  if (mode === 'feat') {
    const featId = sheet.featureChoices?.[`${choice.id}:feat`] || '';
    if (!featId) return Object.freeze({ done: false, picked: 0, required: 1, mode });
    const feat = engine.getItem('feat', featId);
    const increase = feat?.grants?.abilityScoreIncrease;
    const from = Array.isArray(increase?.from)
      ? increase.from
      : increase?.from === 'ANY' ? ['ANY'] : [];
    if (increase && (from.length > 1 || from.includes('ANY'))) {
      const required = Math.max(1, number(increase.amount, 1));
      const picked = grantTotal(sheet, `${choice.id}:featability`);
      return Object.freeze({ done: picked >= required, picked, required, mode });
    }
    return Object.freeze({ done: true, picked: 1, required: 1, mode });
  }
  return Object.freeze({ done: false, picked: 0, required: 1, mode: '' });
}

function issue(code, target, details = {}) {
  return Object.freeze({ code, target: Object.freeze(target), ...details });
}

function section(id, requirements) {
  const issues = requirements.filter(requirement => !requirement.done)
    .map(requirement => requirement.issue);
  return Object.freeze({
    id,
    total: requirements.length,
    complete: requirements.length - issues.length,
    issues: Object.freeze(issues),
  });
}

export function createBuilderProgress({
  sheet,
  classes,
  classChoices,
  creationChoices,
  engine,
  computed,
  pointBuyRemaining,
}) {
  const characterTarget = { tab: 'character' };
  const foundation = [];
  foundation.push({
    done: !!sheet.manualScores || pointBuyRemaining === 0,
    issue: issue('abilities', characterTarget),
  });
  foundation.push({
    done: !!(sheet.species || sheet.race),
    issue: issue('species', characterTarget),
  });
  foundation.push({
    done: !!sheet.background,
    issue: issue('background', characterTarget),
  });
  const speciesId = sheet.species || sheet.race;
  const species = speciesId
    ? engine.getItemByName('species', speciesId) || engine.getItem('species', speciesId)
    : null;
  if (species?.lineages?.length) {
    foundation.push({
      done: !!sheet.lineage,
      issue: issue('lineage', characterTarget),
    });
  }
  const background = sheet.background
    ? engine.getItemByName('background', sheet.background)
      || engine.getItem('background', sheet.background)
    : null;
  const backgroundBudget = number(engine.getRuleset().constants.asi.bgBudget);
  if (background?.abilityScores?.length && backgroundBudget > 0) {
    foundation.push({
      done: grantTotal(sheet, 'bgasi') >= backgroundBudget,
      issue: issue('backgroundAsi', characterTarget),
    });
  }
  for (const choice of creationChoices) {
    foundation.push({
      done: descriptorCompletion(sheet, choice, engine).done,
      issue: issue('choice', characterTarget, { choice }),
    });
  }

  const progression = [];
  for (const [index, entry] of classes.entries()) {
    const target = {
      tab: entry.classId || 'character',
      ...(entry.classId ? { classId: entry.classId, level: 1 } : {}),
    };
    progression.push({
      done: !!entry.classId,
      issue: issue('class', target, { classIndex: index }),
    });
    if (!entry.classId) continue;
    const record = engine.getItem('class', entry.classId);
    const subclassLevel = number(record?.subclassLevel, 3);
    if (number(entry.level, 1) >= subclassLevel
        && engine.listSubclasses(entry.classId).length) {
      progression.push({
        done: !!entry.subclass,
        issue: issue('subclass', {
          tab: entry.classId,
          classId: entry.classId,
          level: subclassLevel,
        }, { classId: entry.classId }),
      });
    }
  }
  for (const choice of classChoices) {
    progression.push({
      done: descriptorCompletion(sheet, choice, engine).done,
      issue: issue('choice', {
        tab: choice.classId || 'character',
        ...(choice.classId ? {
          classId: choice.classId,
          level: number(choice.source?.level, 1),
        } : {}),
      }, { choice }),
    });
  }

  const spells = [];
  for (const choice of computed?.spellcasting?.pendingChoices || []) {
    const picked = Array.isArray(choice.picked) ? choice.picked.length : 0;
    spells.push({
      done: picked >= Math.max(1, number(choice.choose, 1)),
      issue: issue('spellChoice', { tab: 'spellbook' }, { spellChoice: choice }),
    });
  }
  for (const choice of computed?.spellcasting?.castingAbilityChoices || []) {
    spells.push({
      done: !!choice.selected,
      issue: issue('castingAbility', { tab: 'spellbook' }, { castingChoice: choice }),
    });
  }

  const sections = Object.freeze([
    section('foundation', foundation),
    section('progression', progression),
    section('spells', spells),
  ]);
  const issues = Object.freeze(sections.flatMap(value => value.issues));
  return Object.freeze({
    sections,
    issues,
    total: sections.reduce((sum, value) => sum + value.total, 0),
    complete: sections.reduce((sum, value) => sum + value.complete, 0),
    ready: issues.length === 0,
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuilderProgress,
  descriptorCompletion,
} from '../builder-progress.js';

const records = {
  'class:wizard': {
    id: 'wizard',
    subclassLevel: 3,
  },
  'species:elf': {
    id: 'elf',
    lineages: [{ id: 'high-elf' }],
  },
  'background:sage': {
    id: 'sage',
    abilityScores: ['INT', 'WIS', 'CON'],
  },
  'feat:observant': {
    id: 'observant',
    grants: {
      abilityScoreIncrease: {
        amount: 1,
        from: ['INT', 'WIS'],
      },
    },
  },
};

const engine = {
  getRuleset: () => ({
    constants: {
      asi: {
        budget: 2,
        bgBudget: 3,
      },
    },
  }),
  getItem: (kind, id) => records[`${kind}:${id}`] || null,
  getItemByName: (kind, id) => records[`${kind}:${id}`] || null,
  listSubclasses: classId => classId === 'wizard'
    ? [{ id: 'evoker' }]
    : [],
};

test('builder progress: multi-pick descriptors require distinct completed slots', () => {
  const choice = { id: 'skills:wizard', kind: 'skills', count: 2 };
  assert.deepEqual(
    descriptorCompletion({
      featureChoices: {
        'skills:wizard#0': 'arcana',
        'skills:wizard#1': 'arcana',
      },
    }, choice, engine),
    { done: false, picked: 1, required: 2 },
  );
  assert.deepEqual(
    descriptorCompletion({
      featureChoices: {
        'skills:wizard#0': 'arcana',
        'skills:wizard#1': 'history',
      },
    }, choice, engine),
    { done: true, picked: 2, required: 2 },
  );
});

test('builder progress: a half-feat is incomplete until its ability is assigned', () => {
  const choice = { id: 'asi:wizard:4', kind: 'asiMode' };
  const base = {
    featureChoices: {
      'asi:wizard:4': 'feat',
      'asi:wizard:4:feat': 'observant',
    },
  };
  assert.equal(descriptorCompletion(base, choice, engine).done, false);
  assert.equal(descriptorCompletion({
    ...base,
    abilityGrants: [{
      id: 'asi:wizard:4:featability',
      assign: { INT: 1 },
    }],
  }, choice, engine).done, true);
});

test('builder progress: issues point to the exact builder section or spellbook', () => {
  const progress = createBuilderProgress({
    sheet: {
      baseStats: { STR: 8 },
      featureChoices: {},
    },
    classes: [{ classId: 'wizard', level: 4, subclass: '' }],
    classChoices: [{
      id: 'asi:wizard:4',
      kind: 'asiMode',
      classId: 'wizard',
      source: { level: 4 },
    }],
    creationChoices: [],
    engine,
    pointBuyRemaining: 20,
    computed: {
      spellcasting: {
        pendingChoices: [{
          choose: 1,
          picked: [],
          source: { id: 'magic-initiate' },
        }],
        castingAbilityChoices: [{
          selected: '',
          source: { id: 'magic-initiate' },
        }],
      },
    },
  });

  assert.equal(progress.ready, false);
  assert.ok(progress.issues.some(issue => issue.code === 'subclass'
    && issue.target.classId === 'wizard'
    && issue.target.level === 3));
  assert.ok(progress.issues.some(issue => issue.code === 'choice'
    && issue.target.classId === 'wizard'
    && issue.target.level === 4));
  assert.equal(
    progress.issues.filter(issue => issue.target.tab === 'spellbook').length,
    2,
  );
});

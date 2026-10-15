const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const RoundChallenge = require('../src/round-challenge.js');

function proof(overrides = {}) {
  return {
    proof: {
      ruleId: 'region-subset-lock',
      groups: [{ kind: 'region', index: 2 }, { kind: 'region', index: 1 }],
      targetGroups: [{ kind: 'column', index: 4 }, { kind: 'column', index: 3 }],
      conclusion: { place: [], exclude: [9, 3] },
      before: 'ignored board state',
      premises: [{ kind: 'exclude', cell: 7 }],
      solution: [1, 2, 3],
      ...overrides
    }
  };
}

test('policy selects tutorial, regular, complex, and late-complex limits from evidence', () => {
  for (let level = 1; level <= 5; level++) {
    assert.deepEqual(RoundChallenge.policyFor({ level, role: '高峰挑战', allowedTier: 5, targetScore: 99 }),
      { seconds: null, hintLimit: null });
  }
  assert.deepEqual(RoundChallenge.policyFor({ level: 6, size: 14 }), { seconds: 180, hintLimit: 2 });
  assert.deepEqual(RoundChallenge.policyFor({ level: 20, role: '高峰挑战', allowedTier: 1, targetScore: 20 }),
    { seconds: 300, hintLimit: 3 });
  assert.deepEqual(RoundChallenge.policyFor({ level: 20, allowedTier: 3, targetScore: 20 }),
    { seconds: 300, hintLimit: 3 });
  assert.deepEqual(RoundChallenge.policyFor({ level: 20, allowedTier: 1, targetScore: 45 }),
    { seconds: 300, hintLimit: 3 });
  assert.deepEqual(RoundChallenge.policyFor({ level: 77, allowedTier: 1, targetScore: 44, size: 20 }),
    { seconds: 180, hintLimit: 2 }, '关号和尺寸不能单独放大时限');
  assert.deepEqual(RoundChallenge.policyFor({ level: 77, allowedTier: 3, targetScore: 44 }),
    { seconds: 480, hintLimit: 3 });
  assert.deepEqual(RoundChallenge.policyFor({ level: 100, role: '最终高峰', allowedTier: 1, targetScore: 20 }),
    { seconds: 480, hintLimit: 3 });
  assert.deepEqual(RoundChallenge.policyFor({ level: 80, role: '高峰回落', allowedTier: 1, targetScore: 20 }),
    { seconds: 180, hintLimit: 2 });
});

test('module exposes the same API through the browser global', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/round-challenge.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.RoundChallenge).sort(), Object.keys(RoundChallenge).sort());
  assert.equal(context.RoundChallenge.policyFor({ level: 77, allowedTier: 3 }).seconds, 480);
});

test('create initializes old saves and clamps restored time without refilling valid progress', () => {
  const fresh = RoundChallenge.create({ level: 6 });
  assert.deepEqual(fresh.policy, { seconds: 180, hintLimit: 2 });
  assert.equal(fresh.remainingMs, 180000);
  assert.deepEqual([...fresh.hintKeys], []);

  assert.equal(RoundChallenge.create({ level: 6 }, { remainingMs: 12345 }).remainingMs, 12345);
  assert.equal(RoundChallenge.create({ level: 6 }, { remainingMs: 999999 }).remainingMs, 180000);
  for (const bad of [-1, NaN, Infinity, '9000', null]) {
    assert.equal(RoundChallenge.create({ level: 6 }, { remainingMs: bad }).remainingMs, 180000);
  }
  const tutorial = RoundChallenge.create({ level: 3 }, { remainingMs: 1000 });
  assert.equal(tutorial.remainingMs, null);
  assert.equal(tutorial.policy.hintLimit, null);
});

test('create filters, deduplicates, and caps saved hint keys', () => {
  const saved = {
    hintKeys: ['first', '', '   ', 'first', 'second', 'third', 7, 'x'.repeat(2049)]
  };
  assert.deepEqual([...RoundChallenge.create({ level: 6 }, saved).hintKeys], ['first', 'second']);
  assert.equal(RoundChallenge.create({ level: 20, allowedTier: 3 }, saved).hintKeys.size, 3);
  const many = Array.from({ length: 1005 }, (_, index) => `key-${index}`);
  assert.equal(RoundChallenge.create({ level: 1 }, { hintKeys: many }).hintKeys.size, 1000);
});

test('advance uses elapsed milliseconds, rejects bad deltas, and never goes below zero', () => {
  const state = RoundChallenge.create({ level: 6 });
  assert.equal(RoundChallenge.advance(state, 1250.5), 178749.5);
  assert.equal(RoundChallenge.advance(state, -1), 178749.5);
  assert.equal(RoundChallenge.advance(state, NaN), 178749.5);
  assert.equal(RoundChallenge.advance(state, '1000'), 178749.5);
  assert.equal(RoundChallenge.advance(state, 999999), 0);
  assert.equal(RoundChallenge.advance(state, 1), 0);
  const tutorial = RoundChallenge.create({ level: 1 });
  assert.equal(RoundChallenge.advance(tutorial, 999999), null);
});

test('hint keys are stable across ordering and ignored proof history', () => {
  const first = RoundChallenge.hintKey(proof());
  const same = RoundChallenge.hintKey(proof({
    groups: [{ kind: 'region', index: 1 }, { kind: 'region', index: 2 }, { kind: 'region', index: 1 }],
    targetGroups: [{ kind: 'column', index: 3 }, { kind: 'column', index: 4 }],
    conclusion: { place: [], exclude: [3, 9, 3] },
    before: 'different',
    premises: [{ kind: 'exclude', cell: 99 }],
    solution: [99]
  }));
  assert.equal(first, same);
  assert.deepEqual(JSON.parse(first), {
    ruleId: 'region-subset-lock',
    groups: [{ kind: 'region', index: 1 }, { kind: 'region', index: 2 }],
    targetGroups: [{ kind: 'column', index: 3 }, { kind: 'column', index: 4 }],
    conclusion: { place: [], exclude: [3, 9] }
  });
  assert.notEqual(first, RoundChallenge.hintKey(proof({ conclusion: { place: [], exclude: [4, 9] } })));
});

test('hintKey rejects missing or ineffective proofs', () => {
  assert.equal(RoundChallenge.hintKey(null), null);
  assert.equal(RoundChallenge.hintKey({ type: 'none' }), null);
  assert.equal(RoundChallenge.hintKey({ proof: { ruleId: 'single' } }), null);
  assert.equal(RoundChallenge.hintKey(proof({ conclusion: { place: [], exclude: [] } })), null);
  assert.equal(RoundChallenge.hintKey(proof({ conclusion: { place: ['3'], exclude: [-1] } })), null);
});

test('claimHint charges only new conclusions and keeps acquired hints readable after exhaustion', () => {
  const state = RoundChallenge.create({ level: 6 });
  const first = RoundChallenge.hintKey(proof());
  const second = RoundChallenge.hintKey(proof({ ruleId: 'single', conclusion: { place: [4], exclude: [] } }));
  const third = RoundChallenge.hintKey(proof({ ruleId: 'single', conclusion: { place: [8], exclude: [] } }));
  assert.equal(RoundChallenge.remainingHints(state), 2);
  assert.equal(RoundChallenge.claimHint(state, first), true);
  assert.equal(RoundChallenge.claimHint(state, first), true);
  assert.equal(RoundChallenge.remainingHints(state), 1);
  assert.equal(RoundChallenge.claimHint(state, second), true);
  assert.equal(RoundChallenge.remainingHints(state), 0);
  assert.equal(RoundChallenge.claimHint(state, third), false);
  assert.equal(RoundChallenge.claimHint(state, first), true);
  assert.equal(RoundChallenge.claimHint(state, ''), false);
});

test('snapshot round-trips remaining time and claimed conclusions while replay resets them', () => {
  const state = RoundChallenge.create({ level: 20, allowedTier: 3 });
  RoundChallenge.advance(state, 1234);
  const key = RoundChallenge.hintKey(proof());
  RoundChallenge.claimHint(state, key);
  const saved = RoundChallenge.snapshot(state);
  assert.deepEqual(saved, { remainingMs: 298766, hintKeys: [key] });
  assert.doesNotThrow(() => JSON.stringify(saved));

  const restored = RoundChallenge.create({ level: 20, allowedTier: 3 }, saved);
  assert.equal(restored.remainingMs, 298766);
  assert.deepEqual([...restored.hintKeys], [key]);
  assert.equal(RoundChallenge.remainingHints(restored), 2);

  const replay = RoundChallenge.create({ level: 20, allowedTier: 3 });
  assert.equal(replay.remainingMs, 300000);
  assert.equal(replay.hintKeys.size, 0);
});

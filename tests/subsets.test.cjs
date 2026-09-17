const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/puzzle-core.js');
const Logic = require('../src/logic-engine.js');

for (const k of [2, 3, 4]) for (const inverse of [false, true]) for (const transpose of [false, true]) {
  test(`${k} subsets / inverse=${inverse} / transpose=${transpose}`, () => {
    const n = 2 * k + 1, lines = Array.from({ length: k }, (_, i) => i * 2);
    const puzzle = { size: n, regions: Array.from({ length: n * n }, (_, i) => transpose ? Math.floor(i / n) : i % n) };
    const excluded = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (inverse ? lines.includes(r) && c >= k : c < k && !lines.includes(r)) excluded.push(transpose ? c * n + r : r * n + c);
    }
    assert(Core.countSolutions(puzzle, { excluded }).count > 0, 'premises are satisfiable');
    const state = Logic.createState(puzzle, { excluded });
    const result = Logic.derive(state);
    const expected = inverse ? 'line-subset-lock' : 'region-subset-lock';
    const step = result.steps.find(s => s.ruleId === expected && s.groups.length === k);
    assert(step, JSON.stringify(result));
    assert.equal(step.tier, k === 2 ? 2 : 3);
    assert(Logic.verifyStep(state, step));
    assert.equal(Logic.derive(state, {maxTier:3,maxSubsetSize:k-1}).status,'stalled');
    for (const i of step.conclusion.exclude) {
      const check = Core.countSolutions(puzzle, { excluded, placed: [i] });
      assert.equal(check.status, 'complete'); assert.equal(check.count, 0);
    }
    // Restoring one external candidate destroys this particular Hall-set premise.
    const restored = excluded.find(i => inverse ? lines.includes(transpose ? i % n : Math.floor(i / n)) : (transpose ? Math.floor(i / n) : i % n) < k);
    const loose = Logic.createState(puzzle, { excluded: excluded.filter(i => i !== restored) });
    const again = Logic.derive(loose);
    assert(!again.steps.some(s => s.ruleId === step.ruleId && JSON.stringify(s.groups) === JSON.stringify(step.groups) && JSON.stringify(s.targetGroups) === JSON.stringify(step.targetGroups)));
  });
}

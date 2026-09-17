const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/puzzle-core.js');
const Logic = require('../src/logic-engine.js');
const fixture = require('./fixtures/marked-horse.cjs');
const { sample, rng } = require('./helpers.cjs');

test('input validation checks connected nonempty regions and cell range', () => {
  assert(Core.validate(fixture).valid);
  for (const puzzle of [null, { size: 0 }, { size: 13 }, { size: 2, regions: [0,1] },
    { size: 2, regions: [0,1,1,0] }, { size: 2, regions: [0,0,0,0] },
    { size: 2, regions: [0,0,1,2] }]) assert.equal(Core.validate(puzzle).valid, false);
  assert.equal(Core.countSolutions(fixture, { excluded: [-1] }).status, 'invalid');
  assert.equal(Core.countSolutions(fixture, { budgetMs: -1 }).status, 'invalid');
});

test('exact search distinguishes zero, unique, multiple and unknown', () => {
  assert.equal(Core.countSolutions({ size: 2, regions: [0,0,1,1] }).count, 0);
  const unique = Core.countSolutions(fixture);
  assert.equal(unique.status, 'complete'); assert.equal(unique.count, 1);
  assert.deepEqual(unique.solutions[0], fixture.horses);
  const multi = Core.countSolutions({ size: 4, regions: Array.from({ length: 16 }, (_, i) => Math.floor(i / 4)) });
  assert.equal(multi.count, 2); assert.equal(multi.truncated, true);
  assert.equal(Core.countSolutions(fixture, { maxNodes: 0 }).status, 'unknown');
  assert.equal(Core.countSolutions(fixture, { budgetMs: 0 }).status, 'unknown');
  assert.equal(Core.countSolutions(fixture, { placed: [14], excluded: [14] }).count, 0);
  assert.equal(Core.countSolutions(fixture, { placed: [0, 1] }).count, 0);
});

test('solution validator enforces local adjacency, not whole diagonals', () => {
  assert(Core.validateSolution(fixture, fixture.horses));
  assert(!Core.validateSolution(fixture, Array(7).fill(0)));
  const rows = { size: 5, regions: Array.from({ length: 25 }, (_, i) => Math.floor(i / 5)) };
  assert(Core.validateSolution(rows, [0, 2, 4, 1, 3]));
  assert(!Core.validateSolution(rows, [0, 1, 3, 2, 4]));
});

test('wrong player marks cannot exclude the horse from the reported regression', () => {
  const puzzle = { size: fixture.size, regions: fixture.regions };
  Object.defineProperty(puzzle, 'solution', { get() { throw new Error('hidden answer read'); } });
  Object.defineProperty(puzzle, 'horses', { get() { throw new Error('hidden answer read'); } });
  const marks = fixture.marks.slice();
  const hint = Logic.hint(puzzle, {}, marks);
  assert.equal(hint.type, 'correction'); assert.deepEqual(hint.targets, [14]);
  assert.deepEqual(marks, fixture.marks);
  assert(!hint.proof.conclusion.exclude.includes(24));
  assert(Logic.verifyStep(Logic.createState(puzzle), hint.proof));
});

test('facts, stale proofs, tampered premises and conclusions are rejected', () => {
  assert.equal(Logic.solve(fixture, { placed: [-1] }).status, 'invalid');
  assert.equal(Logic.solve(fixture, { placed: [14], excluded: [14] }).status, 'contradiction');
  assert.equal(Logic.solve(fixture, { placed: [0, 1] }).status, 'contradiction');
  const state = Logic.createState(fixture);
  const step = Logic.derive(state).steps[0];
  const changed = JSON.parse(JSON.stringify(step)); changed.conclusion.place = [0];
  assert.equal(Logic.verifyStep(state, changed), false);
  const altered = JSON.parse(JSON.stringify(step)); altered.premises.push({ kind: 'exclude', cell: 24, by: 'made-up' });
  assert.equal(Logic.verifyStep(state, altered), false);
  Logic.applyStep(state, step);
  assert.equal(Logic.verifyStep(state, step), false);
  assert.throws(() => Logic.applyStep(state, step), /stale/);
  assert.equal(Logic.solve(fixture, {}, { maxSteps: 0 }).status, 'unknown');
});

test('solve trace is replayable and every step has an independent exact-search certificate', () => {
  const result = Logic.solve(fixture);
  assert.equal(result.status, 'solved');
  assert(Logic.replay(fixture, {}, result.trace).valid);
  const placed = [], excluded = [];
  for (const step of result.trace) {
    for (const i of step.conclusion.place) {
      const check = Core.countSolutions(fixture, { placed, excluded: [...excluded, i] });
      assert.equal(check.status, 'complete'); assert.equal(check.count, 0, step.id);
    }
    for (const i of step.conclusion.exclude) {
      const check = Core.countSolutions(fixture, { placed: [...placed, i], excluded });
      assert.equal(check.status, 'complete'); assert.equal(check.count, 0, step.id);
    }
    placed.push(...step.conclusion.place); excluded.push(...step.conclusion.exclude);
  }
});

test('seeded boards and valid partial states: all offered deductions are sound', () => {
  const coverage = new Set();
  let stepsChecked = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const puzzle = sample(seed, 4 + seed % 4), random = rng(seed + 2000);
    assert(Core.validate(puzzle).valid); assert(Core.validateSolution(puzzle, puzzle.horses));
    const horseCells = new Set(puzzle.horses.map((c, r) => r * puzzle.size + c));
    const excluded = [];
    for (let i = 0; i < puzzle.size ** 2; i++) if (!horseCells.has(i) && random() < 0.2) excluded.push(i);
    const state = Logic.createState(puzzle, { excluded });
    for (let round = 0; round < 12; round++) {
      const result = Logic.derive(state, { budgetMs: 2000 });
      if (result.status !== 'progress') break;
      for (const step of result.steps) {
        coverage.add(step.ruleId); stepsChecked++;
        assert(Logic.verifyStep(state, step));
        for (const i of step.conclusion.place) {
          const check = Core.countSolutions(puzzle, { placed: state.placed, excluded: [...state.excluded, i] });
          assert.equal(check.status, 'complete'); assert.equal(check.count, 0, JSON.stringify({ seed, step }));
        }
        for (const i of step.conclusion.exclude) {
          const check = Core.countSolutions(puzzle, { placed: [...state.placed, i], excluded: state.excluded });
          assert.equal(check.status, 'complete'); assert.equal(check.count, 0, JSON.stringify({ seed, step }));
        }
      }
      Logic.applyStep(state, result.steps[0]);
    }
  }
  assert(stepsChecked > 500);
  assert(coverage.has('single')); assert(coverage.has('placed-exclusion'));
  console.log(JSON.stringify({ stepsChecked, rulesObserved: [...coverage] }));
});

test('marks never change a mathematical conclusion, including random incorrect marks', () => {
  const random = rng(73), horseCells = new Set(fixture.horses.map((c, r) => r * fixture.size + c));
  for (let t = 0; t < 200; t++) {
    const marks = Array.from({ length: 49 }, (_, i) => i).filter(() => random() < 0.3);
    const hint = Logic.hint(fixture, {}, marks);
    if (hint.type === 'exclude') assert(hint.targets.every(i => !horseCells.has(i)));
    if (hint.type === 'horse' || hint.type === 'correction') assert(hint.targets.every(i => horseCells.has(i)));
  }
});

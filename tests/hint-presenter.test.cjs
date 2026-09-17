const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/puzzle-core.js');
const L = require('../src/logic-engine.js');
const P = require('../src/hint-presenter.js');
const D = require('../src/difficulty.js');
const campaign = require('../data/campaign.js');
const fixture = require('./fixtures/level18-hint.cjs');

test('level 18 explains the forced fourth column and every excluded fifth-column cell', () => {
  const before = JSON.stringify(fixture);
  const hint = L.hint(fixture, {}, fixture.marks, { budgetMs: 5000 });
  assert.equal(hint.proof.ruleId, 'bounded-contradiction');
  assert.equal(hint.proof.contradiction.assumedCell, 14);
  assert.equal(hint.proof.contradiction.steps.length, 3);
  assert.deepEqual(hint.proof.contradiction.steps[1].conclusion.place, [3]);
  assert.deepEqual(hint.proof.contradiction.conflict.cells, [4,11,18,25,32,39,46]);
  assert(L.replay(fixture, {}, [...hint.prerequisites, hint.proof]).valid);
  const result = P.toLegacyHint(hint, fixture);
  assert.equal(result.type, 'exclude');
  assert(result.message.length <= 450, result.message.length);
  assert(result.message.includes('第 4 列只剩第 1、4 行'));
  assert(result.message.includes('第 5 列只剩第 2、3 行'));
  assert(result.message.includes('第 4 列只剩第 1 行第 4 列，必须放马'));
  assert(result.message.includes('3. '));
  assert(result.message.includes('斜角相邻'));
  assert(result.message.includes('第 3 行第 5 列（与这匹马同行）'));
  assert(result.message.includes('第 4 行第 4 列（与这匹马同色区域）'));
  assert(result.message.includes('第 2 行第 5 列（与这匹马斜角相邻）'));
  assert(!result.message.includes('前置 1'));
  const full = P.fullExplanation(hint, fixture);
  for (const i of [4,11,18,25,32,39,46]) assert(full.includes(`${P.cellName(i,7)}：已由`));
  assert(result.message.includes('第 3 行第 1 列不能放马'));
  assert(!result.message.includes('经过 3 步'));
  assert.equal(JSON.stringify(fixture), before);
});

test('explanations work without reading answers, with wrong marks and color remapping', () => {
  const puzzle = { size: fixture.size, regions: fixture.regions, colorMap: [6,1,3,2,11,9,4] };
  Object.defineProperty(puzzle, 'solution', { get() { throw new Error('answer accessed'); } });
  const hint = L.hint(puzzle, {}, fixture.marks, { budgetMs: 5000 });
  const text = P.fullExplanation(hint, puzzle);
  assert(text.includes('苹果绿区域'));
  const exact = C.countSolutions(puzzle);
  const wrongMarks = [...fixture.marks, ...exact.solutions[0].map((c,r) => r*7+c)];
  assert.deepEqual(L.hint(puzzle, {}, wrongMarks, { budgetMs: 5000 }).targets, hint.targets);
  const marks = Array.from({length:49},(_,i)=>i);
  const correction = P.toLegacyHint(L.hint(puzzle, {}, marks, { budgetMs: 5000 }), puzzle);
  assert.equal(correction.type, 'error');
  assert(correction.message.includes('这个 ✕ 需要撤销'));
});

test('transformed level 18 hints name the actual assumption and conflict axis', () => {
  for (let rotation=0; rotation<4; rotation++) for (const mirror of [false,true]) {
    const puzzle = D.transform(fixture, rotation, mirror);
    const marks = fixture.marks.map(i => {
      let r = Math.floor(i/7), c = i%7;
      for(let k=0;k<rotation;k++) [r,c]=[c,6-r];
      if(mirror)c=6-c;
      return r*7+c;
    });
    const hint = L.hint(puzzle, {}, marks, {budgetMs:5000});
    const out = P.toLegacyHint(hint,puzzle);
    assert.notEqual(out.type,'none',out.reason);
    if (hint.proof.contradiction) {
      assert(out.message.includes(P.cellName(hint.proof.contradiction.assumedCell,7)));
      assert(out.message.includes(P.groupName(hint.proof.contradiction.conflict.group,puzzle)));
    }
  }
});

test('missing proof ancestry does not invent an explanation', () => {
  const hint = L.hint(fixture, {}, fixture.marks, {budgetMs:5000});
  hint.prerequisites = [];
  const out = P.toLegacyHint(hint,fixture);
  assert.equal(out.type,'none');
  assert(out.message.includes('依据不完整'));
});

test('every step in the current campaign has a supported explanation', () => {
  const rules = new Set();
  for (const {puzzle} of campaign.levels) {
    const solved = L.solve(puzzle,{}, {budgetMs:puzzle.size>=12?60000:5000});
    assert.equal(solved.status,'solved');
    const prior = [];
    for (const proof of solved.trace) {
      const type = proof.conclusion.place.length ? 'horse' : 'exclude';
      const out = P.toLegacyHint({type,proof,targets:proof.conclusion.place.concat(proof.conclusion.exclude),prerequisites:prior},puzzle);
      assert.notEqual(out.type,'none',out.reason);
      rules.add(proof.ruleId); prior.push(proof);
    }
  }
  assert(rules.has('bounded-contradiction'));
  assert(rules.has('common-conflict'));
  assert(rules.has('region-subset-lock'));
});

test('non-proof states stay explicit and contain no invented target', () => {
  for (const type of ['unknown','invalid','stalled','contradiction','solved']) {
    const out = P.toLegacyHint({type},fixture);
    assert.equal(out.type,'none'); assert.deepEqual(out.idxs,[]); assert(out.message.length>0);
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/puzzle-core.js');
const D = require('../src/difficulty.js');
const L = require('../src/logic-engine.js');
const P = require('../src/hint-presenter.js');
const campaign = require('../data/campaign.js');

// v1.3 准入审计：
//  · 前 30 关（≤9×9）与全部 20 个高峰关：8 个旋转/镜像方向完整审计
//  · 其余大棋盘关：恒等方向完整审计
//  · 计数断言全部数据驱动；大棋盘预算与节点上限按规模放大
const peaks = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
const fullTransformLevels = new Set([...Array.from({ length: 30 }, (_, i) => i + 1), ...peaks]);
const countOpts = size => size >= 12
  ? { budgetMs: 120000, maxNodes: 20000000 }
  : { budgetMs: 15000 };

test('campaign levels pass admission audit in all required directions', { timeout: 900000 }, () => {
  let transforms = 0, conclusions = 0, hints = 0, contradictionPuzzles = 0;
  for (const record of campaign.levels) {
    const analysis = D.analyze(record.puzzle, { budgetMs: 30000, maxStates: 2000,
      exact: record.puzzle.size >= 12 ? { budgetMs: 120000, maxNodes: 20000000 } : undefined });
    assert.equal(analysis.status, 'accepted', `第 ${record.level} 关分析失败`);
    assert.equal(analysis.difficultyScore, record.targetScore, `L${record.level} 分数不一致`);
    assert.equal(analysis.profile.requiredRuleTier, record.allowedTier, `L${record.level} 档位不一致`);
    const contradictionSteps = analysis.trace.filter(step => step.ruleId === 'bounded-contradiction');
    if (contradictionSteps.length) contradictionPuzzles++;
    for (const proof of contradictionSteps) {
      assert(proof.contradiction.steps.length <= 3);
      assert(proof.contradiction.steps.every(child => !child.contradiction));
    }
    const directions = fullTransformLevels.has(record.level)
      ? [[0, false], [1, false], [2, false], [3, false], [0, true], [1, true], [2, true], [3, true]]
      : [[0, false]];
    for (const [rotation, mirror] of directions) {
      const puzzle = D.transform(record.puzzle, rotation, mirror);
      const exact = C.countSolutions(puzzle, { limit: 2, ...countOpts(record.size) });
      assert.equal(exact.status, 'complete'); assert.equal(exact.count, 1); assert.equal(exact.truncated, false);
      const solved = L.solve(puzzle, {}, { maxTier: record.allowedTier, budgetMs: record.size >= 12 ? 60000 : 15000 });
      assert.equal(solved.status, 'solved', `第 ${record.level} 关 ${rotation}/${mirror}`);
      assert(L.replay(puzzle, {}, solved.trace).valid);
      const safePuzzle = { size: puzzle.size, regions: puzzle.regions };
      Object.defineProperty(safePuzzle, 'solution', { get() { throw new Error('hint accessed solution'); } });
      const placed = [], excluded = [], prior = [];
      for (const proof of solved.trace) {
        const hint = P.toLegacyHint({ type: proof.conclusion.place.length ? 'horse' : 'exclude',
          targets: [...proof.conclusion.place, ...proof.conclusion.exclude], proof, prerequisites: prior }, safePuzzle);
        assert.notEqual(hint.type, 'none', `第 ${record.level} 关提示失败：${hint.reason}`); hints++;
        for (const cell of proof.conclusion.place) {
          const contrary = C.countSolutions(puzzle, { placed, excluded: [...excluded, cell], ...countOpts(record.size) });
          assert.equal(contrary.status, 'complete'); assert.equal(contrary.count, 0); conclusions++;
        }
        for (const cell of proof.conclusion.exclude) {
          const contrary = C.countSolutions(puzzle, { placed: [...placed, cell], excluded, ...countOpts(record.size) });
          assert.equal(contrary.status, 'complete'); assert.equal(contrary.count, 0); conclusions++;
        }
        placed.push(...proof.conclusion.place); excluded.push(...proof.conclusion.exclude); prior.push(proof);
      }
      transforms++;
    }
  }
  // 数据驱动：前 30 关 + 20 个高峰关跑满 8 方向，其余大棋盘关至少 1 方向
  assert.equal(transforms, fullTransformLevels.size * 8 + (100 - fullTransformLevels.size));
  assert(conclusions > 1000);
  assert(hints > 1000);
  assert(campaign.levels.some(record => record.size >= 14), '题库应包含 14×14');
});

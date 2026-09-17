const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/puzzle-core.js');
const D = require('../src/difficulty.js');
const L = require('../src/logic-engine.js');
const campaign = require('../data/campaign.js');
const reference = require('../data/reference-level-66.json');

// v1.3 节奏：5×5 起步（L1 为分步引导关），尺寸阶梯升至 14×14；
// 新手区（5×5/6×6 波段）平稳渐进，L20 起每 5 关一个高峰、随后一关回落。
const peaks = Array.from({ length: 17 }, (_, i) => (i + 1) * 5 + 15);
const recoveryMap = new Map(peaks.map(peak => [peak + 1, peak]).filter(([lvl]) => lvl <= 100));
const peakSet = new Set(peaks);
const recoverySet = new Set(recoveryMap.keys());

function bandSize(level) {
  if (level <= 8) return 5;
  if (level <= 18) return 6;
  if (level <= 30) return 7;
  if (level <= 42) return 8;
  if (level <= 54) return 9;
  if (level <= 65) return 10;
  if (level <= 76) return 11;
  if (level <= 86) return 12;
  if (level <= 94) return 13;
  return 14;
}
function level(number) { return campaign.levels[number - 1]; }
function canonical(puzzle) { return D.canonical({ size: puzzle.size, regions: puzzle.regions }).signature; }
function answerKey(puzzle) {
  const keys = [];
  for (let rotation = 0; rotation < 4; rotation++) for (const mirror of [false, true]) {
    keys.push(D.transform(puzzle, rotation, mirror).solution.join(','));
  }
  return keys.sort()[0];
}
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const bigBudget = puzzle => puzzle.size >= 12
  ? { budgetMs: 120000, maxNodes: 20000000 }
  : { budgetMs: 8000 };

test('v1.3 campaign has 100 continuous, unique, valid and solvable levels', () => {
  assert.equal(campaign.campaignVersion, 'v1.3-local-100.1');
  assert.equal(campaign.status, 'production-campaign-100-local');
  assert.equal(campaign.levels.length, 100);
  const ids = new Set(), signatures = new Set();
  for (const record of campaign.levels) {
    assert.equal(record.level, ids.size + 1);
    assert(!ids.has(record.puzzleId), record.puzzleId); ids.add(record.puzzleId);
    assert(!signatures.has(canonical(record.puzzle)), record.puzzleId); signatures.add(canonical(record.puzzle));
    assert(C.validate(record.puzzle).valid, record.puzzleId);
    assert(C.validateSolution(record.puzzle, record.puzzle.solution));
    const exact = C.countSolutions(record.puzzle, bigBudget(record.puzzle));
    assert.equal(exact.status, 'complete', record.puzzleId);
    assert.equal(exact.count, 1); assert.equal(exact.truncated, false);
    const solved = L.solve(record.puzzle, {}, { maxTier: record.allowedTier, ...bigBudget(record.puzzle) });
    assert.equal(solved.status, 'solved', record.puzzleId);
    assert(L.replay(record.puzzle, {}, solved.trace).valid);
  }
});

test('board sizes rise from 5x5 to 14x14 with no regressions', () => {
  assert.equal(level(1).size, 5);
  assert.equal(level(1).role, '引导教学');
  assert.equal(level(100).size, 14);
  let prevBand = 4;
  for (let number = 1; number <= 100; number++) {
    const band = bandSize(number);
    if (band !== prevBand) { assert.equal(band, prevBand + 1, `L${number} 尺寸阶梯必须逐级上升`); prevBand = band; }
    const size = level(number).size;
    assert(size >= 5, `L${number} 低于 5×5`);
    assert(size <= 14, `L${number} 超过 14×14`);
    assert(size >= band - 1 && size <= band, `L${number} 尺寸 ${size} 偏离波段 ${band}`);
    if (recoveryMap.has(number)) {
      const peakSize = level(recoveryMap.get(number)).size;
      // 回落关尺寸 = 所在波段降一档（波段边界处不降档，避免叠加新波段形成 2 档突跃）
      assert([bandSize(number), Math.max(5, bandSize(number) - 1)].includes(size), `L${number} 回落尺寸异常`);
      assert(size <= peakSize, `L${number} 回落尺寸 ${size} 高于高峰 ${peakSize}`);
    }
  }
  for (let number = 2; number <= 100; number++) {
    assert(Math.abs(level(number).size - level(number - 1).size) <= 1, `L${number - 1}→L${number} 尺寸跳档`);
  }
  const sizes = new Set(campaign.levels.map(record => record.size));
  assert.deepEqual([...sizes].sort((a, b) => a - b), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});

test('peaks and recoveries alternate with a clear difficulty gap', () => {
  for (const [recoveryNumber, peakNumber] of recoveryMap) {
    const peak = level(peakNumber), recovery = level(recoveryNumber);
    assert.equal(recovery.recoveryOfLevel, peakNumber);
    assert(peak.targetScore - recovery.targetScore >= 8, `L${peakNumber}→L${recoveryNumber} 落差不足`);
    assert(peak.allowedTier >= recovery.allowedTier, `L${recoveryNumber} 回落档位高于高峰`);
  }
  // 新手区之后普通关分数按波段中位数递增
  const medians = [[20, 60], [61, 100]].map(([start, end]) =>
    median(campaign.levels.filter(record => record.level >= start && record.level <= end &&
      !peakSet.has(record.level) && !recoverySet.has(record.level)).map(record => record.targetScore)));
  assert(medians[0] < medians[1], `普通关中位数应递增: ${medians}`);
});

test('opening levels stay small and gentle', () => {
  for (const number of [1, 2, 3, 4, 5]) {
    assert.equal(level(number).size, 5, `L${number} 应为 5×5`);
  }
  assert.equal(level(1).puzzleId, 'v13-tutorial-n5');
});

test('old level 31 reference stays preserved outside the main campaign', () => {
  assert.equal(reference.disposition, 'reference-reserve-not-in-main-100');
  assert.equal(reference.record.puzzleId, 'v11-ref66-n7');
  assert(!campaign.levels.some(record => record.puzzleId === reference.record.puzzleId));
});

test('adjacent levels never share the same answer skeleton', () => {
  for (let number = 1; number < 100; number++) {
    assert.notEqual(answerKey(level(number).puzzle), answerKey(level(number + 1).puzzle),
      `第 ${number}→${number + 1} 关答案骨架重复`);
  }
});

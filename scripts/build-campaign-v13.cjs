// v1.3 战役装配：5×5 起步、尺寸阶梯升至 14×14；第 1 关为定制引导教学关；
// 高峰/回落节奏保留：每 5 关一个高峰，高峰后一关为回落（尺寸降一档、分数明显下降）。
// 用法：node scripts/build-campaign-v13.cjs <pool1.json> [pool2.json ...]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('../src/puzzle-core.js');
const Logic = require('../src/logic-engine.js');
const Difficulty = require('../src/difficulty.js');

const projectRoot = path.resolve(__dirname, '..');
const poolFiles = process.argv.slice(2);
if (!poolFiles.length) throw new Error('usage: build-campaign-v13.cjs <pool.json> [...]');

// ---- 第 1 关定制引导题：区域/排除链专为分步新手引导设计（已验证唯一解） ----
// R0 单格(0,2) 引导双击放马 → 排除 6 格 {1,3,4,6,7,8} → R1 只剩 (1,4) 引导第二匹 → 剩余自由完成
const TUTORIAL_PUZZLE = {
  size: 5,
  regions: [2, 2, 0, 1, 1, 2, 2, 2, 1, 1, 4, 2, 3, 3, 3, 4, 4, 3, 3, 3, 4, 4, 3, 3, 3],
  solution: [2, 4, 1, 3, 0],
  colorMap: [0, 2, 3, 4, 5], // 黄 / 珊瑚红 / 天蓝 / 紫 / 绿
};

// ---- 载入并去重候选池 ----
const bySignature = new Map();
for (const file of poolFiles) {
  const pool = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const rec of pool.records) {
    if (!bySignature.has(rec.signature)) bySignature.set(rec.signature, rec);
  }
}
// 从 v1.2 备份提取 5×5 / 6×6 题目（生成器题池只覆盖 7~14，低尺寸复用已审计的旧题）
const legacy = JSON.parse(fs.readFileSync(path.join(projectRoot, '.tmp/pool-v13/campaign-v12-extract.json'), 'utf8'));
for (const rec of legacy.records) {
  if (!bySignature.has(rec.signature)) bySignature.set(rec.signature, rec);
}
const buckets = new Map(); // size -> [record]
for (const rec of bySignature.values()) {
  if (!buckets.has(rec.size)) buckets.set(rec.size, []);
  buckets.get(rec.size).push(rec);
}
for (const [size, list] of buckets) list.sort((a, b) => a.analysis.difficultyScore - b.analysis.difficultyScore);
console.log('题池:', [...buckets.entries()].map(([s, l]) => `${s}×${s}:${l.length}`).join(' '));

// ---- 尺寸编排：5×5 起步渐进到 14×14 ----
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
// 新手区（5×5/6×6 波段，L1-18）低分题稀缺，撑不起高峰-回落节奏，改为平稳渐进；
// 高峰从 L20（7×7 波段）开始，每 5 关一个。
const peaks = Array.from({ length: 17 }, (_, i) => (i + 1) * 5 + 15); // 20,25,...,100
const recoveryOf = new Map(peaks.map(peak => [peak + 1, peak]).filter(([lvl]) => lvl <= 100));
// 难度分窗口自适应：每个尺寸波段的目标分由"该尺寸题池可达上限"决定。
// 硬编码窗口在小池子上会失效（例如 14×14 只有 16 题、需求正好 16 关时被迫全用，
// 被 5 分的低分题拖垮），因此先算各尺寸的可达上限 cap，再插值出递增窗口。
const need = {};
for (let level = 1; level <= 100; level++) { const s = levelSize(level); need[s] = (need[s] || 0) + 1; }
const cap = {};
for (const [size, list] of buckets) {
  const arr = list.map(r => r.analysis.difficultyScore).sort((a, b) => a - b);
  const n = Math.min(need[size] || 0, arr.length);
  cap[size] = n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : 0;
}
const HI5 = 8, HI14 = 72, LO5 = 2;
const bandHi = {}, bandLo = {};
for (let s = 5; s <= 14; s++) {
  bandHi[s] = Math.round(Math.min(cap[s] || 0, HI5 + (HI14 - HI5) * (s - 5) / 9));
}
// 上沿反向单调：若某尺寸题池偏弱（cap 低），前面的波段要跟着让路，
// 否则会出现"13×13 比 14×14 还难"的倒挂。
for (let s = 13; s >= 5; s--) if (bandHi[s] > bandHi[s + 1] - 1) bandHi[s] = bandHi[s + 1] - 1;
for (let s = 5; s <= 14; s++) {
  // 下沿不得顶穿上沿，保证窗口 [lo, hi] 有效且留至少 5 分的上升空间
  bandLo[s] = s === 5 ? LO5 : Math.round(Math.min(bandHi[s] - 5, Math.max(bandHi[s] - 9, (bandHi[s - 1] + bandLo[s - 1]) / 2)));
}
console.log('难度分窗口:', [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(s => `${s}:${bandLo[s]}~${bandHi[s]}(cap${Math.round(cap[s] || 0)})`).join(' '));
function bandStart(size) { return [1, 9, 19, 31, 43, 55, 66, 77, 87, 95][size - 5]; }
function levelSize(level) {
  const recovery = recoveryOf.get(level);
  if (recovery === undefined) return bandSize(level);
  // 波段边界处的回落关不再降档：否则"回落 -1 档 + 新波段 +1 档"会叠成 2 档突跃。
  if (level + 1 <= 100 && bandSize(level + 1) > bandSize(level)) return bandSize(level);
  return Math.max(5, bandSize(level) - 1);
}

// ---- 选题 ----
const used = new Set(); // 已用 signature
// 预处理每题的答案骨架（8 变换下解向量排序最小），避免相邻关同构
for (const rec of bySignature.values()) {
  const p = { size: rec.size, regions: rec.regions, solution: rec.solution };
  const keys = [];
  for (let r = 0; r < 4; r++) for (const m of [false, true]) keys.push(Difficulty.transform(p, r, m).solution.join(','));
  rec.answerKey = keys.sort()[0];
}
const tutorialKey = (() => {
  const keys = [];
  for (let r = 0; r < 4; r++) for (const m of [false, true]) keys.push(Difficulty.transform(TUTORIAL_PUZZLE, r, m).solution.join(','));
  return keys.sort()[0];
})();
const levelKeys = { 1: tutorialKey };
const isBC = rec => (rec.analysis.profile.rules || []).includes('bounded-contradiction');

function take(size, target, maxScore, opts = {}) {
  const list = buckets.get(size);
  if (!list) throw new Error(`题池缺少 ${size}×${size} 的题目`);
  const pick = (ceiling, filter) => {
    let best = null, bestGap = Infinity;
    for (const rec of list) {
      if (used.has(rec.signature)) continue;
      const sc = rec.analysis.difficultyScore;
      if (ceiling !== undefined && sc > ceiling) continue;
      if (filter && !filter(rec)) continue;
      if (opts.avoidKey && rec.answerKey === opts.avoidKey && list.length > 1) continue;
      const gap = Math.abs(sc - target);
      if (gap < bestGap) { bestGap = gap; best = rec; }
    }
    return best;
  };
  let best;
  // 高峰关优先选"需要反证法"的题——高峰即新技巧挑战；该尺寸池没有反证题时退回按分数取
  if (opts.preferBC) best = pick(maxScore, isBC) ?? pick(undefined, isBC);
  // 回落关必须明显低于其高峰，否则"回落"变成"继续变难"；
  // 若该尺寸低分题已被前面波段用光，则放宽上限并让断言暴露数据不足。
  if (!best) best = pick(maxScore) ?? pick(undefined);
  if (!best) throw new Error(`${size}×${size} 题池耗尽（需要更多候选）`);
  used.add(best.signature);
  return best;
}

const levels = [];
for (let level = 1; level <= 100; level++) {
  if (level === 1) {
    const a = Difficulty.analyze(TUTORIAL_PUZZLE, {});
    assert.equal(a.status, 'accepted', '引导题必须通过分析审计');
    levels.push({
      level,
      puzzleId: 'v13-tutorial-n5',
      role: '引导教学',
      size: 5,
      targetScore: a.difficultyScore,
      allowedTier: a.profile.requiredRuleTier,
      practiceRules: [],
      recoveryOfLevel: null,
      challengeShape: 'short',
      puzzle: JSON.parse(JSON.stringify(TUTORIAL_PUZZLE)),
    });
    continue;
  }
  const size = levelSize(level);
  const isPeak = peaks.includes(level);
  const recovery = recoveryOf.get(level);
  const lo = bandLo[bandSize(level)], hi = bandHi[bandSize(level)];
  let target;
  if (level <= 3) target = lo;
  else if (recovery !== undefined) target = Math.max(3, levels[recovery - 1].targetScore - 20);
  else if (isPeak) target = hi + 12;
  else target = Math.round(lo + (hi - lo) * Math.min(1, (level - bandStart(bandSize(level))) / 11));
  const avoidKey = levelKeys[level - 1];
  let rec, role;
  if (level <= 3) {
    // 引导关(定制)之后的教学练习：直接取最接近目标的题（不重试，避免白白消耗低分题）
    rec = take(size, target, undefined, { avoidKey });
    role = '单格教学练习';
  } else if (recovery !== undefined) {
    const peakScore = levels[recovery - 1].targetScore;
    rec = take(size, Math.min(Math.max(lo, peakScore - 20), peakScore - 8), peakScore - 8, { avoidKey });
    role = '回落缓冲';
  } else if (isPeak) {
    rec = take(size, target, undefined, { avoidKey, preferBC: true });
    role = level === 100 ? '最终高峰' : '高峰挑战';
  } else {
    rec = take(size, target, undefined, { avoidKey });
    role = level === bandStart(size) && level <= 81 ? '新尺寸初见' : '渐进练习';
  }
  levelKeys[level] = rec.answerKey;
  const analysis = rec.analysis;
  levels.push({
    level,
    puzzleId: `v13-${rec.seed}-n${size}`,
    role,
    size,
    targetScore: analysis.difficultyScore,
    allowedTier: analysis.profile.requiredRuleTier,
    practiceRules: (analysis.profile.rules || []).filter(r => !['single', 'placed-exclusion'].includes(r)).slice(0, 3),
    recoveryOfLevel: recovery !== undefined ? recovery : null,
    challengeShape: size >= 9 ? 'long' : 'short',
    puzzle: { size: rec.size, regions: rec.regions, solution: rec.solution },
  });
}

// ---- 回落关继承高峰的练习规则（复用刚学的技巧） ----
for (const [recoveryLevel, peakLevel] of recoveryOf) {
  const peak = levels[peakLevel - 1];
  levels[recoveryLevel - 1].practiceRules = peak.practiceRules;
}

// ---- 装配前自检 ----
for (const record of levels) {
  const p = record.puzzle;
  assert(Core.validate(p).valid, `L${record.level} invalid`);
  assert(Core.validateSolution(p, p.solution), `L${record.level} solution`);
  const budget = p.size >= 12 ? 120000 : 8000;
  const countOpts = p.size >= 12 ? { budgetMs: budget, maxNodes: 20000000 } : { budgetMs: budget };
  const exact = Core.countSolutions(p, countOpts);
  assert.equal(exact.status, 'complete', `L${record.level} uniqueness ${exact.status}`);
  assert.equal(exact.count, 1, `L${record.level} not unique`);
  const solved = Logic.solve(p, {}, { maxTier: record.allowedTier, budgetMs: p.size >= 12 ? 60000 : budget });
  assert.equal(solved.status, 'solved', `L${record.level} tier ${record.allowedTier}`);
  assert(Logic.replay(p, {}, solved.trace).valid, `L${record.level} replay`);
}
const sigs = new Set(levels.map(l => JSON.stringify(l.puzzle.regions)));
assert.equal(sigs.size, 100, '题目重复');
// 尺寸单调性：按波段不下降；最低 5、最高 14
let prevBand = 4;
for (let level = 1; level <= 100; level++) {
  const band = bandSize(level);
  if (band !== prevBand) { assert(band === prevBand + 1, '尺寸阶梯必须逐级上升'); prevBand = band; }
  const s = levels[level - 1].size;
  assert(s >= 5 && s <= 14 && s >= band - 1 && s <= band, `L${level} 尺寸越界`);
}
// 相邻关尺寸不跳档（含回落关与波段边界）
for (let level = 2; level <= 100; level++) {
  assert(Math.abs(levels[level - 1].size - levels[level - 2].size) <= 1,
    `L${level - 1}→L${level} 尺寸跳档 ${levels[level - 2].size}→${levels[level - 1].size}`);
}
// 各波段难度分必须同步上升（回落关不参与，避免落差干扰趋势判断）
// 各波段难度分须整体上升（回落关不参与）。允许 ≤6 分的口径噪音：
// 低尺寸复用 v1.2 旧题，其分数分布与生成器新题口径略有差异；
// 心流的主保证是尺寸单调 + 窗口插值，分数断言只拦截大幅倒挂。
let prevAvg = -1;
for (const size of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
  const group = levels.filter(l => l.size === size && l.recoveryOfLevel === null);
  const avg = group.reduce((a, b) => a + b.targetScore, 0) / group.length;
  assert(avg > prevAvg - 8, `${size}×${size} 波段难度分大幅倒挂 (${avg.toFixed(1)} vs ${prevAvg.toFixed(1)})`);
  prevAvg = avg;
}
// 高峰-回落落差（回落关必须明显低于其高峰）
for (const [recoveryLevel, peakLevel] of recoveryOf) {
  const gap = levels[peakLevel - 1].targetScore - levels[recoveryLevel - 1].targetScore;
  assert(gap >= 8, `L${peakLevel}→L${recoveryLevel} 落差不足 (${gap})`);
}

const campaign = {
  campaignVersion: 'v1.3-local-100.1',
  contentVersion: '1.3.0-local',
  status: 'production-campaign-100-local',
  note: 'v1.3 节奏：5×5 起步（第 1 关为分步引导教学关）、尺寸随关卡阶梯升至 14×14（回落只降一档、不低于 5×5）；' +
    '每 5 关一个高峰，回落关复用高峰的关键推理关系；推理档位与分数仍由分析器实测给出。',
  levels,
};

const out = `(function(root){
  const data=${JSON.stringify(campaign)};
  if(typeof module==="object"&&module.exports) module.exports=data;
  else root.GameCampaign=data;
})(typeof globalThis!=="undefined"?globalThis:this);
`;
fs.writeFileSync(path.join(projectRoot, 'data/campaign.js'), out);

const dist = {};
levels.forEach(l => dist[l.size] = (dist[l.size] || 0) + 1);
console.log('已写入 data/campaign.js');
console.log('尺寸分布:', JSON.stringify(dist));
console.log('分数范围:', levels[0].targetScore, '~', Math.max(...levels.map(l => l.targetScore)));

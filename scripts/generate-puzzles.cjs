const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/puzzle-core.js');
const Logic = require('../src/logic-engine.js');
const Difficulty = require('../src/difficulty.js');
const Source = require('./puzzle-source.cjs');

function run({ count = 1000, seed = 20260915, sizeMin = 5, sizeMax = 9, searchSteps = 100, source = 'search' } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('count out of range');
  if (!Number.isInteger(seed) || !Number.isInteger(sizeMin) || !Number.isInteger(sizeMax) || sizeMin < 4 || sizeMax > 16 || sizeMin > sizeMax ||
      !Number.isInteger(searchSteps) || searchSteps < 0 || searchSteps > 5000 || !['search','template'].includes(source)) throw new Error('invalid generation configuration');
  const records = [], rows = [], seen = new Set(), totals = {};
  let symmetryChecks = 0, exactProofChecks = 0;
  const start = Date.now();
  for (let i = 0; i < count; i++) {
    const candidateSeed = seed + i, size = sizeMin + i % (sizeMax - sizeMin + 1);
    const p = source === 'template' ? Source.candidate(candidateSeed, size, 1 + i % 4) : Source.search(candidateSeed, size, searchSteps);
    if (!p) { rows.push({ seed: candidateSeed, size, status: 'source-failed' }); totals['source-failed'] = (totals['source-failed'] || 0) + 1; continue; }
    // 大棋盘（≥12）暴力计数/推理耗时显著上升：预算按规模放大，避免超时/节点
    // 打满后的 unknown 状态被误当成"证明无效"。14×14 最坏搜索方向需 ~140 万节点，
    // 默认 maxNodes=100万 会先截断，故 maxNodes 放大到 2000 万。预算只影响时长/
    // 节点上限，不改变判定语义。
    const bigBudget = { exact: { budgetMs: 120000, maxNodes: 20000000 }, budgetMs: 30000 };
    const a = Difficulty.analyze(p, size >= 12 ? bigBudget : {});
    const row = { seed: candidateSeed, size, status: a.status, reason: a.reason || a.stage };
    if (a.status === 'accepted') {
      Object.assign(row, { score: a.difficultyScore, tier: a.profile.requiredRuleTier, singles: a.profile.singletonCount,
        episodes: a.profile.bottleneckEpisodes, subsets: a.profile.subsetSizes, signature: a.signature });
      const puzzle = a.puzzle;
      const auditBudget = size >= 12 ? { budgetMs: 30000 } : {};
      // Inspect actual transformed inputs rather than only canonical hashes.
      for (let r = 0; r < 4; r++) for (const m of [false, true]) {
        const t = Difficulty.transform(puzzle, r, m), exact = Core.countSolutions(t, auditBudget);
        const logic = Logic.solve(t, {}, { maxTier: a.profile.requiredRuleTier, ...(size >= 12 ? { budgetMs: 60000 } : {}) });
        symmetryChecks++;
        if (exact.status !== 'complete' || exact.count !== 1 || exact.truncated || logic.status !== 'solved' ||
            Difficulty.canonical(t).signature !== a.signature) throw new Error(`symmetry audit failed seed=${candidateSeed} rotation=${r} mirror=${m}`);
      }
      const placed = [], excluded = [];
      for (const step of a.trace) {
        for (const i of step.conclusion.place) {
          const c = Core.countSolutions(puzzle, { placed, excluded: [...excluded, i], ...auditBudget }); exactProofChecks++;
          if (c.status !== 'complete' || c.count !== 0) throw new Error(`invalid placement proof seed=${candidateSeed}`);
        }
        for (const i of step.conclusion.exclude) {
          const c = Core.countSolutions(puzzle, { placed: [...placed, i], excluded, ...auditBudget }); exactProofChecks++;
          if (c.status !== 'complete' || c.count !== 0) throw new Error(`invalid exclusion proof seed=${candidateSeed}`);
        }
        placed.push(...step.conclusion.place); excluded.push(...step.conclusion.exclude);
      }
      if (seen.has(a.signature)) row.status = 'duplicate';
      else {
        seen.add(a.signature);
        records.push({ puzzleId: `v11-s${candidateSeed}-n${size}`, contentVersion: '1.1.0-candidate',
          generatorVersion: Source.version, seed: candidateSeed, searchSteps, ...puzzle,
          signature: a.signature, analysis: { analyzerVersion: a.analyzerVersion, unique: true, humanSolvable: true,
            difficultyScore: a.difficultyScore, profile: a.profile, weaker: a.weaker, ablations: a.ablations, subsetAblations: a.subsetAblations, paths: a.paths } });
      }
    } else {
      // Rejected puzzles are also transformed and checked; do not omit failures.
      for (let r = 0; r < 4; r++) for (const m of [false, true]) {
        const t = Difficulty.transform(p,r,m); symmetryChecks++;
        if (!Core.validate(t).valid || !Core.validateSolution(t,t.solution)) throw new Error(`invalid source seed=${candidateSeed}`);
      }
    }
    rows.push(row); totals[row.status] = (totals[row.status] || 0) + 1;
    if ((i + 1) % 100 === 0) process.stderr.write(`Audited ${i+1}/${count}\n`);
  }
  return { generatorVersion: Source.version, analyzerVersion: Difficulty.version,
    config: { count, seed, sizeMin, sizeMax, searchSteps, source }, totals, symmetryChecks, exactProofChecks,
    elapsedMs: Date.now()-start, rows, records };
}
if (require.main === module) {
  const output = process.argv[2];
  if (!output) throw new Error('usage: node scripts/generate-puzzles.cjs /absolute/output.json [count] [seed]');
  const data = run({ count: Number(process.argv[3] || 1000), seed: Number(process.argv[4] || 20260915), source: process.argv[5] || 'search' });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(data));
  console.log(JSON.stringify({ ...data, rows: undefined, records: data.records.length }));
}
module.exports = { run };

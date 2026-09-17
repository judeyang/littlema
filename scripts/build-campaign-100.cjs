const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const taskRoot = process.env.CAMPAIGN100_TASK_ROOT;
if (!taskRoot) throw new Error('CAMPAIGN100_TASK_ROOT must point to the task evidence directory');
const projectRoot = path.resolve(__dirname, '..');
const workRoot = path.join(taskRoot, 'work/expand100');
const baselinePath = path.join(workRoot, 'baseline/campaign.js');
const D = require(path.join(projectRoot, 'src/difficulty.js'));
const C = require(path.join(projectRoot, 'src/puzzle-core.js'));
const L = require(path.join(projectRoot, 'src/logic-engine.js'));
const P = require(path.join(projectRoot, 'src/hint-presenter.js'));
const Source = require(path.join(projectRoot, 'scripts/puzzle-source.cjs'));
const Family66 = require(path.join(projectRoot, 'scripts/search-66-like.cjs'));

const sourcePaths = {
  candidateV2: path.join(taskRoot, 'work/generated/candidate-audit-v2.json'),
  candidateV1: path.join(taskRoot, 'work/generated/candidate-audit.json'),
  template: path.join(taskRoot, 'work/generated/template-audit.json'),
  development: path.join(projectRoot, 'data/development-samples.json'),
  outputSamples: path.join(taskRoot, 'outputs/difficulty-sample-pack.json'),
  diverse66: path.join(taskRoot, 'work/66-diverse.json'),
  campaign: path.join(projectRoot, 'data/campaign.js'),
  baseline: baselinePath,
  difficulty: path.join(projectRoot, 'src/difficulty.js'),
  logic: path.join(projectRoot, 'src/logic-engine.js'),
  core: path.join(projectRoot, 'src/puzzle-core.js'),
  presenter: path.join(projectRoot, 'src/hint-presenter.js'),
};

const peakLevels = Array.from({ length: 14 }, (_, i) => 34 + i * 5);
const recoveryLevels = new Set(peakLevels.map(level => level + 1));
const family66Levels = new Set([44, 54, 64, 74, 84, 94]);
const ignoredRules = new Set(['single', 'placed-exclusion']);
const loadKeys = ['proofDepth', 'premiseCount', 'span', 'workUnits'];

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function nowShanghai() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date()).replace(' ', 'T') + '+08:00';
}
function canonical(puzzle) { return D.canonical({ size: puzzle.size, regions: puzzle.regions }).signature; }
function fingerprint(puzzle) {
  return JSON.stringify({ size: puzzle.size, regions: puzzle.regions, solution: puzzle.solution, colorMap: puzzle.colorMap || null });
}
function answerKey(puzzle) {
  const keys = [];
  for (let rotation = 0; rotation < 4; rotation++) for (const mirror of [false, true]) {
    keys.push(D.transform(puzzle, rotation, mirror).solution.join(','));
  }
  return keys.sort()[0];
}
function profileOf(raw) { return raw.analysis?.profile || raw.report?.profile; }
function scoreOf(raw) { return raw.analysis?.difficultyScore ?? raw.report?.difficultyScore; }
function analyzerOf(raw) { return raw.analysis?.analyzerVersion || raw.report?.analyzerVersion; }
function storedSignature(raw) { return raw.signature || raw.report?.signature; }
function puzzleOf(raw) { return raw.puzzle || { size: raw.size, regions: raw.regions, solution: raw.solution, ...(raw.colorMap ? { colorMap: raw.colorMap } : {}) }; }
function advancedRules(profile) { return (profile.rules || []).filter(rule => !ignoredRules.has(rule)); }
function openingKey(profile) {
  const proof = profile.openingProof || {};
  const groups = (proof.groups || []).map(group => group.kind).sort().join('+');
  const targets = (proof.targetGroups || []).map(group => group.kind).sort().join('+');
  return `${proof.ruleId || 'none'}:${groups}:${targets}`;
}
function nearEntryKey(candidate) {
  return `${candidate.size}:${candidate.tier}:${candidate.openingKey}:${candidate.subsetSizes.join(',')}`;
}
function sourceHashRows() {
  return Object.entries(sourcePaths).filter(([, file]) => fs.existsSync(file)).map(([name, file]) => ({ name, path: file, sha256: sha256(file) }));
}

function normalize(raw, source, sourceIndex, auditStatus) {
  const puzzle = puzzleOf(raw);
  const profile = profileOf(raw);
  const currentSignature = canonical(puzzle);
  const signature = storedSignature(raw);
  const valid = C.validate(puzzle).valid;
  const solutionValid = C.validateSolution(puzzle, puzzle.solution);
  const accepted = raw.report ? raw.report.status === 'accepted' : raw.analysis?.unique === true && raw.analysis?.humanSolvable === true;
  const signatureMatch = signature === currentSignature;
  const analyzerVersion = analyzerOf(raw);
  const score = scoreOf(raw);
  const tier = profile?.requiredRuleTier;
  const singletonCount = profile?.singletonCount;
  const sourceId = raw.puzzleId || `v12-66-s${raw.seed}-n${puzzle.size}`;
  const candidate = {
    source, sourceIndex, sourceId, sourceSeed: raw.seed ?? null, auditStatus,
    signature: currentSignature, storedSignature: signature || null, signatureMatch,
    analyzerVersion, accepted, valid, solutionValid,
    size: puzzle.size, score, tier, singletonCount,
    proofDepth: profile?.proofDepth, premiseCount: profile?.premiseCount,
    span: profile?.span, workUnits: profile?.workUnits,
    forcedStepsInHypothesis: profile?.forcedStepsInHypothesis,
    bottleneckEpisodes: profile?.bottleneckEpisodes,
    rules: advancedRules(profile || {}), subsetSizes: profile?.subsetSizes || [],
    openingKey: openingKey(profile || {}), answerKey: answerKey(puzzle),
    puzzle: { size: puzzle.size, regions: puzzle.regions, solution: puzzle.solution, ...(puzzle.colorMap ? { colorMap: puzzle.colorMap } : {}) },
  };
  candidate.nearEntryKey = nearEntryKey(candidate);
  candidate.planningUsable = accepted && valid && solutionValid && signatureMatch && analyzerVersion === D.version &&
    Number.isFinite(score) && Number.isInteger(tier) && singletonCount === 0;
  return candidate;
}

function loadPools() {
  const baseline = require(baselinePath);
  const current = require(sourcePaths.campaign);
  assert.deepEqual(current.levels.slice(0, 30), baseline.levels.slice(0, 30), 'current first 30 differ from frozen baseline');
  const v2 = readJson(sourcePaths.candidateV2);
  const template = readJson(sourcePaths.template);
  const diverse = readJson(sourcePaths.diverse66);
  const sources = [
    ...v2.records.map((record, index) => normalize(record, 'candidate-audit-v2', index, 'full-old-pool-audit')),
    ...template.records.map((record, index) => normalize(record, 'template-audit', index, 'full-old-pool-audit')),
    ...diverse.found.map((record, index) => normalize(record, '66-diverse', index, 'accepted-original-direction')),
  ];
  for (const file of fs.readdirSync(workRoot).filter(name => /^66-batch-.*\.json$/.test(name)).sort()) {
    const batch = readJson(path.join(workRoot, file));
    for (const [index, record] of (batch.found || []).entries()) sources.push(normalize(record, file, index, 'accepted-original-direction'));
  }
  const first30 = new Map(baseline.levels.slice(0, 30).map(record => [canonical(record.puzzle), record]));
  const reference = baseline.levels[30];
  const referenceSignature = canonical(reference.puzzle);
  const bySignature = new Map(), duplicates = [];
  for (const candidate of sources) {
    if (bySignature.has(candidate.signature)) {
      duplicates.push({ signature: candidate.signature, kept: bySignature.get(candidate.signature).source, alias: candidate.source });
      continue;
    }
    bySignature.set(candidate.signature, candidate);
  }
  const all = [...bySignature.values()];
  const eligible = all.filter(candidate => candidate.planningUsable && !first30.has(candidate.signature) && candidate.signature !== referenceSignature);
  const excluded = all.filter(candidate => !eligible.includes(candidate)).map(candidate => ({
    source: candidate.source, sourceId: candidate.sourceId, signature: candidate.signature,
    reason: first30.has(candidate.signature) ? `matches-main-level-${first30.get(candidate.signature).level}`
      : candidate.signature === referenceSignature ? 'matches-old-reference-31'
        : !candidate.planningUsable ? 'cached-admission-or-zero-singleton-failed' : 'unknown',
  }));
  return { baseline, current, reference, referenceSignature, rawSources: sources, all, eligible, excluded, duplicates, v2, template, diverse };
}

function histogram(items, key) {
  const out = {};
  for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])));
}
function scoreBand(score) {
  if (score < 20) return '00-19';
  if (score < 40) return '20-39';
  if (score < 60) return '40-59';
  if (score < 70) return '60-69';
  if (score <= 80) return '70-80';
  return '81-100';
}
function summarize(items) {
  const band = {};
  for (const item of items) band[scoreBand(item.score)] = (band[scoreBand(item.score)] || 0) + 1;
  return { count: items.length, bySource: histogram(items, 'source'), bySize: histogram(items, 'size'), byTier: histogram(items, 'tier'),
    bySingletonCount: histogram(items, 'singletonCount'), byScoreBand: band };
}

function inventory() {
  const pools = loadPools();
  const oldV1 = readJson(sourcePaths.candidateV1);
  const development = readJson(sourcePaths.development);
  const outputSamples = readJson(sourcePaths.outputSamples);
  const v2Signatures = new Set(pools.v2.records.map(record => record.signature));
  const summary = {
    generatedAt: nowShanghai(), analyzerVersion: D.version,
    sourceHashes: sourceHashRows(),
    baselinePreserved: {
      campaign: sha256(sourcePaths.campaign) === sha256(path.join(workRoot, 'baseline/campaign.js')),
      game: sha256(path.join(projectRoot, 'game.js')) === sha256(path.join(workRoot, 'baseline/game.js')),
      hintPresenter: sha256(path.join(projectRoot, 'src/hint-presenter.js')) === sha256(path.join(workRoot, 'baseline/hint-presenter.js')),
    },
    sources: {
      candidateV2: { records: pools.v2.records.length, zeroSingleton: pools.v2.records.filter(record => record.analysis.profile.singletonCount === 0).length,
        analyzerVersion: pools.v2.analyzerVersion, totals: pools.v2.totals, symmetryChecks: pools.v2.symmetryChecks, exactProofChecks: pools.v2.exactProofChecks },
      candidateV1: { records: oldV1.records.length, analyzerVersion: oldV1.analyzerVersion, disposition: 'superseded-by-v2',
        signaturesAlsoInV2: oldV1.records.filter(record => v2Signatures.has(record.signature)).length },
      template: { records: pools.template.records.length, analyzerVersion: pools.template.analyzerVersion, totals: pools.template.totals,
        symmetryChecks: pools.template.symmetryChecks, exactProofChecks: pools.template.exactProofChecks },
      developmentSamples: { records: development.records.length, aliasesInV2: development.records.filter(record => v2Signatures.has(record.signature)).length },
      outputSamples: { records: outputSamples.records.length, disposition: 'duplicate-delivery-copy-not-primary-source' },
      diverse66: { records: pools.diverse.found.length, stats: pools.diverse.stats },
      excludedFourRegionSearches: ['work/generated/hall4-search.json', 'work/generated/subset-search.json'],
    },
    dedupe: { rawPrimaryRecords: pools.rawSources.length, uniqueSignatures: pools.all.length, duplicateAliases: pools.duplicates.length,
      excluded: pools.excluded.length, eligible: pools.eligible.length, exclusions: pools.excluded },
    allUnique: summarize(pools.all), eligible: summarize(pools.eligible),
    hardFamilyCandidates: pools.eligible.filter(candidate => candidate.tier === 5 && candidate.forcedStepsInHypothesis > 0).map(candidate => ({
      source: candidate.source, sourceId: candidate.sourceId, signature: candidate.signature, score: candidate.score,
      tier: candidate.tier, forcedStepsInHypothesis: candidate.forcedStepsInHypothesis, answerKey: candidate.answerKey,
    })),
    referenceReserve: { level: pools.reference.level, puzzleId: pools.reference.puzzleId, signature: pools.referenceSignature,
      disposition: 'preserved-outside-main-100' },
    notes: [
      'No puzzle solver was called by inventory; only stored analysis, difficulty.canonical, structural validation, and stored-solution validation were used.',
      'Old pool records with valid current signatures are reusable for planning; only selected records receive current full admission verification.',
      'Four-region search artifacts are intentionally excluded under the latest instruction.',
    ],
  };
  writeJson(path.join(workRoot, 'candidate-inventory.json'), { summary, candidates: pools.eligible });
  console.log(JSON.stringify({ eligible: pools.eligible.length, hardFamilyCandidates: summary.hardFamilyCandidates.length,
    zeroSingletonV2: summary.sources.candidateV2.zeroSingleton, excluded: pools.excluded.length, baselinePreserved: summary.baselinePreserved }));
}

function isShortContradiction(report) {
  return report.status === 'accepted' && report.profile.requiredRuleTier === 5 && report.profile.singletonCount === 0 &&
    report.trace.some(step => step.ruleId === 'bounded-contradiction' && step.contradiction.steps.length <= 3 &&
      step.contradiction.steps.every(child => !child.contradiction));
}

function search66(batchSeed, iterations, retain) {
  if (!Number.isInteger(batchSeed) || !Number.isInteger(iterations) || iterations < 1 || iterations > 6000 ||
      !Number.isInteger(retain) || retain < 1 || retain > 12) throw new Error('invalid bounded 66 search options');
  const output = path.join(workRoot, `66-batch-${batchSeed}.json`);
  if (fs.existsSync(output)) throw new Error(`batch already exists: ${output}`);
  const pools = loadPools(), seen = new Set(pools.all.map(candidate => candidate.signature));
  const random = Source.rng(batchSeed), family = [Family66.REFERENCE], found = [];
  const started = Date.now(), deadline = started + 60 * 60 * 1000;
  const stats = { batchSeed, iterationsRequested: iterations, checked: 0, valid: 0, canonicalUnique: 0, exactUnique: 0,
    tier4Stalled: 0, analyzed: 0, accepted: 0, unknown: 0 };
  const save = () => writeJson(output, { version: '66-production-batch-1', generatedAt: nowShanghai(), config: { batchSeed, iterations, retain,
    maxRuntimeMinutes: 60, maxMoves: 11, analyzerVersion: D.version }, stats, found });
  save();
  for (let index = 0; index < iterations && found.length < retain && Date.now() < deadline; index++) {
    stats.checked++;
    const parent = family[Math.floor(random() * Math.min(family.length, 60))];
    const parentSignature = canonical(parent), moves = 2 + Math.floor(random() * 10), mutationSeed = batchSeed + index * 113;
    const puzzle = Family66.mutate(parent, mutationSeed, moves);
    if (!C.validate(puzzle).valid) continue;
    stats.valid++;
    const signature = canonical(puzzle);
    if (seen.has(signature)) continue;
    seen.add(signature); stats.canonicalUnique++;
    family.push(puzzle); if (family.length > 100) family.splice(40, 1);
    const exact = C.countSolutions(puzzle, { limit: 2, budgetMs: 5000 });
    if (exact.status !== 'complete' || exact.count !== 1 || exact.truncated) continue;
    stats.exactUnique++; puzzle.solution = exact.solutions[0];
    const low = L.solve(puzzle, {}, { maxTier: 4, budgetMs: 5000 });
    if (low.status !== 'stalled') continue;
    stats.tier4Stalled++;
    const report = D.analyze(puzzle, { budgetMs: 10000, maxStates: 1000 }); stats.analyzed++;
    if (report.status === 'unknown') { stats.unknown++; continue; }
    if (!isShortContradiction(report) || report.difficultyScore < 70 || report.difficultyScore > 86) continue;
    found.push({ seed: mutationSeed, parentSignature, moves, puzzle, answerKey: answerKey(puzzle), report });
    stats.accepted++; save();
    console.log(JSON.stringify({ event: 'accepted', batchSeed, found: found.length, score: report.difficultyScore,
      seed: mutationSeed, moves, signature }));
  }
  stats.elapsedMs = Date.now() - started; save();
  console.log(JSON.stringify({ event: 'complete', output, stats, found: found.length }));
}

function rangeFor(level, kind) {
  const segment = level <= 50 ? 1 : level <= 75 ? 2 : 3;
  const ranges = {
    1: { normal: [34, 48], peak: [62, 79], recovery: [28, 46] },
    2: { normal: [42, 56], peak: [68, 82], recovery: [36, 54] },
    3: { normal: [50, 64], peak: [74, 86], recovery: [44, 62] },
  };
  if (level === 31 && kind === 'normal') return [30, 36];
  return ranges[segment][kind];
}
function targetFor(level, kind) {
  const [min, max] = rangeFor(level, kind);
  if (kind !== 'normal') return (min + max) / 2;
  const [start, end] = level <= 50 ? [31, 50] : level <= 75 ? [51, 75] : [76, 100];
  return min + ((level - start) / Math.max(1, end - start)) * (max - min);
}
function inRange(candidate, level, kind) {
  const [min, max] = rangeFor(level, kind); return candidate.score >= min && candidate.score <= max;
}
function loweredLoad(peak, recovery) { return loadKeys.some(key => Number(recovery[key]) < Number(peak[key])); }
function sharedRules(a, b) {
  const set = new Set(b.rules); return a.rules.filter(rule => set.has(rule));
}
function candidateDistance(candidate, level, kind) { return Math.abs(candidate.score - targetFor(level, kind)); }
function is66(candidate) { return candidate.tier === 5 && candidate.forcedStepsInHypothesis > 0; }

function build() {
  const pools = loadPools();
  const candidates = pools.eligible;
  const hard = candidates.filter(is66);
  if (hard.length < 6) throw new Error(`66-like gap: have ${hard.length}, need 6`);
  const used = new Set(), selected = new Map(), pairRows = [];
  const reserve = candidate => { assert(!used.has(candidate.signature)); used.add(candidate.signature); return candidate; };
  // Later segments have the narrowest high-score recovery pool, so reserve them first.
  const orderedPeaks = peakLevels.slice().sort((a, b) => b - a);
  for (const level of orderedPeaks) {
    const pool = candidates.filter(candidate => !used.has(candidate.signature) && inRange(candidate, level, 'peak') &&
      (family66Levels.has(level) ? is66(candidate) : candidate.tier >= 4));
    pool.sort((a, b) => candidateDistance(a, level, 'peak') - candidateDistance(b, level, 'peak') || a.signature.localeCompare(b.signature));
    let chosen;
    for (const peak of pool) {
      const recoveries = candidates.filter(candidate => !used.has(candidate.signature) && candidate.signature !== peak.signature &&
        inRange(candidate, level + 1, 'recovery') && peak.score - candidate.score >= 12 && loweredLoad(peak, candidate) && sharedRules(peak, candidate).length);
      recoveries.sort((a, b) => {
        const aPreferred = sharedRules(peak, a).includes('common-conflict') || sharedRules(peak, a).some(rule => rule.includes('subset'));
        const bPreferred = sharedRules(peak, b).includes('common-conflict') || sharedRules(peak, b).some(rule => rule.includes('subset'));
        return Number(bPreferred) - Number(aPreferred) || candidateDistance(a, level + 1, 'recovery') - candidateDistance(b, level + 1, 'recovery') || a.signature.localeCompare(b.signature);
      });
      if (recoveries.length) { chosen = { peak, recovery: recoveries[0] }; break; }
    }
    if (!chosen) throw new Error(`no pair for peak ${level}`);
    reserve(chosen.peak); reserve(chosen.recovery);
    selected.set(level, chosen.peak); selected.set(level + 1, chosen.recovery);
    pairRows.push({ peakLevel: level, peakSignature: chosen.peak.signature, peakScore: chosen.peak.score,
      recoveryLevel: level + 1, recoverySignature: chosen.recovery.signature, recoveryScore: chosen.recovery.score,
      scoreDrop: chosen.peak.score - chosen.recovery.score, sharedRules: sharedRules(chosen.peak, chosen.recovery),
      loweredLoads: loadKeys.filter(key => Number(chosen.recovery[key]) < Number(chosen.peak[key])),
      sameAnswerKey: chosen.peak.answerKey === chosen.recovery.answerKey,
      nearEntry: chosen.peak.nearEntryKey === chosen.recovery.nearEntryKey,
      family66: family66Levels.has(level) });
  }
  for (let level = 31; level <= 100; level++) {
    if (selected.has(level)) continue;
    const previous = selected.get(level - 1);
    const next = selected.get(level + 1);
    const avoidNextAnswer = level === 43 || level === 63;
    const pool = candidates.filter(candidate => !used.has(candidate.signature) && inRange(candidate, level, 'normal') && !is66(candidate) &&
      (!avoidNextAnswer || !next || candidate.answerKey !== next.answerKey));
    pool.sort((a, b) => {
      const aNear = previous && a.nearEntryKey === previous.nearEntryKey;
      const bNear = previous && b.nearEntryKey === previous.nearEntryKey;
      const aAnswer = previous && a.answerKey === previous.answerKey;
      const bAnswer = previous && b.answerKey === previous.answerKey;
      return Number(aNear) - Number(bNear) || Number(aAnswer) - Number(bAnswer) ||
        candidateDistance(a, level, 'normal') - candidateDistance(b, level, 'normal') || a.signature.localeCompare(b.signature);
    });
    if (!pool.length) throw new Error(`normal candidate gap at ${level}`);
    selected.set(level, reserve(pool[0]));
  }
  const levels = pools.baseline.levels.slice(0, 30).map(record => structuredClone(record));
  const selectionRows = [];
  for (let level = 31; level <= 100; level++) {
    const candidate = selected.get(level), kind = peakLevels.includes(level) ? 'peak' : recoveryLevels.has(level) ? 'recovery' : 'normal';
    const isFamily = family66Levels.has(level);
    const puzzleId = candidate.sourceId.startsWith('v11-') ? candidate.sourceId : `v12-66-s${candidate.sourceSeed}-n${candidate.size}`;
    const role = isFamily ? '第66关式短反证高峰' : kind === 'peak' ? '组合推理高峰' : kind === 'recovery' ? '高峰回落' :
      candidate.tier >= 4 ? '共同冲突练习' : candidate.tier >= 2 ? '联合关系练习' : '基础关系巩固';
    const record = { level, puzzleId, role, size: candidate.size, targetScore: candidate.score, allowedTier: candidate.tier,
      practiceRules: candidate.rules, recoveryOfLevel: kind === 'recovery' ? level - 1 : null,
      challengeShape: kind === 'peak' || candidate.bottleneckEpisodes > 1 ? 'long' : 'short', puzzle: candidate.puzzle };
    levels.push(record);
    selectionRows.push({ level, kind, family66: isFamily, source: candidate.source, sourceIndex: candidate.sourceIndex,
      sourceId: candidate.sourceId, puzzleId, signature: candidate.signature, size: candidate.size, score: candidate.score,
      tier: candidate.tier, singletonCount: candidate.singletonCount, rules: candidate.rules, proofDepth: candidate.proofDepth,
      premiseCount: candidate.premiseCount, span: candidate.span, workUnits: candidate.workUnits,
      answerKey: candidate.answerKey, openingKey: candidate.openingKey, nearEntryKey: candidate.nearEntryKey });
  }
  assert.deepEqual(levels.slice(0, 30), pools.baseline.levels.slice(0, 30));
  assert.equal(new Set(levels.map(record => record.puzzleId)).size, 100, 'duplicate puzzle ids');
  const resumeCompatibility = { campaignVersion: pools.baseline.campaignVersion,
    records: pools.baseline.levels.slice(0, 30).map(record => ({ level: record.level, puzzleId: record.puzzleId,
      fingerprint: fingerprint(record.puzzle) })) };
  const campaign = { campaignVersion: 'v1.2-local-100.1', contentVersion: '1.2.0-local', status: 'production-campaign-100-local',
    note: '前 30 关保持 v1.1-local-30.4 原记录；第 31～100 关按三段渐进基线、14 个高峰及峰后回落编排。旧第 31 关参考题移出正式主线并单独保存。',
    resumeCompatibility, levels };
  const ordinaryMedians = [[31, 50], [51, 75], [76, 100]].map(([lo, hi]) => {
    const scores = selectionRows.filter(row => row.level >= lo && row.level <= hi && row.kind === 'normal').map(row => row.score).sort((a, b) => a - b);
    const middle = Math.floor(scores.length / 2); return scores.length % 2 ? scores[middle] : (scores[middle - 1] + scores[middle]) / 2;
  });
  assert(ordinaryMedians[0] < ordinaryMedians[1] && ordinaryMedians[1] < ordinaryMedians[2]);
  const adjacency = selectionRows.slice(1).map((row, index) => {
    const before = selectionRows[index], intentionalPair = row.kind === 'recovery' && row.level === before.level + 1;
    return { from: before.level, to: row.level, intentionalPair, sameAnswerKey: before.answerKey === row.answerKey,
      sameOpeningKey: before.openingKey === row.openingKey, nearEntry: before.nearEntryKey === row.nearEntryKey };
  });
  writeJson(path.join(workRoot, 'selected-campaign.json'), { generatedAt: nowShanghai(), sourceHashes: sourceHashRows(),
    campaignVersion: campaign.campaignVersion, first30Unchanged: true, ordinaryMedians, pairs: pairRows, adjacency, rows: selectionRows });
  writeJson(path.join(workRoot, 'reference-level-66.json'), { preservedAt: nowShanghai(), sourceCampaignVersion: pools.baseline.campaignVersion,
    disposition: 'reference-reserve-not-in-main-100', record: pools.reference });
  const js = `(function(root){\n  const data=${JSON.stringify(campaign)};\n  if(typeof module==='object'&&module.exports)module.exports=data;\n  else root.GameCampaign=data;\n})(typeof globalThis!=='undefined'?globalThis:this);\n`;
  fs.writeFileSync(path.join(workRoot, 'campaign.generated.js'), js);
  console.log(JSON.stringify({ count: levels.length, newRecords: selectionRows.length, pairs: pairRows.length,
    family66: selectionRows.filter(row => row.family66).length, ordinaryMedians, output: path.join(workRoot, 'campaign.generated.js') }));
}

function verify() {
  const campaignPath = path.join(workRoot, 'campaign.generated.js');
  delete require.cache[require.resolve(campaignPath)];
  const campaign = require(campaignPath), baseline = require(baselinePath), selection = readJson(path.join(workRoot, 'selected-campaign.json'));
  assert.equal(campaign.levels.length, 100); assert.deepEqual(campaign.levels.slice(0, 30), baseline.levels.slice(0, 30));
  const started = Date.now(), deadline = started + 60 * 60 * 1000, seen = new Set(baseline.levels.map(record => canonical(record.puzzle)));
  let transformChecks = 0, conclusionChecks = 0, hints = 0, contradictionPuzzles = 0;
  const rows = [];
  for (const record of campaign.levels.slice(30)) {
    if (Date.now() >= deadline) throw new Error('verification time limit reached');
    const expected = selection.rows.find(row => row.level === record.level);
    const signature = canonical(record.puzzle); assert.equal(signature, expected.signature); assert(!seen.has(signature)); seen.add(signature);
    assert(C.validate(record.puzzle).valid); assert(C.validateSolution(record.puzzle, record.puzzle.solution));
    const counts = Array(record.puzzle.size).fill(0); record.puzzle.regions.forEach(group => counts[group]++); assert(!counts.includes(1));
    const analysis = D.analyze(record.puzzle, { budgetMs: 10000, maxStates: 1000 });
    assert.equal(analysis.status, 'accepted', `${record.level} analysis`); assert.equal(analysis.signature, signature);
    assert.equal(analysis.difficultyScore, record.targetScore); assert.equal(analysis.profile.requiredRuleTier, record.allowedTier);
    const contradictions = analysis.trace.filter(step => step.ruleId === 'bounded-contradiction');
    if (contradictions.length) contradictionPuzzles++;
    for (const step of contradictions) { assert(step.contradiction.steps.length <= 3); assert(step.contradiction.steps.every(child => !child.contradiction)); }
    for (let rotation = 0; rotation < 4; rotation++) for (const mirror of [false, true]) {
      const puzzle = D.transform(record.puzzle, rotation, mirror);
      const exact = C.countSolutions(puzzle, { limit: 2, budgetMs: 10000 });
      assert.equal(exact.status, 'complete', `${record.level} exact ${rotation}/${mirror}`);
      assert.equal(exact.count, 1); assert.equal(exact.truncated, false);
      const solved = L.solve(puzzle, {}, { maxTier: record.allowedTier, budgetMs: 10000 });
      assert.equal(solved.status, 'solved', `${record.level} solve ${rotation}/${mirror}`); assert(L.replay(puzzle, {}, solved.trace).valid);
      const safePuzzle = { size: puzzle.size, regions: puzzle.regions };
      Object.defineProperty(safePuzzle, 'solution', { get() { throw new Error('hint accessed solution'); } });
      const placed = [], excluded = [], prior = [];
      for (const proof of solved.trace) {
        const hint = P.toLegacyHint({ type: proof.conclusion.place.length ? 'horse' : 'exclude',
          targets: [...proof.conclusion.place, ...proof.conclusion.exclude], proof, prerequisites: prior }, safePuzzle);
        assert.notEqual(hint.type, 'none', `${record.level} hint: ${hint.reason}`); hints++;
        for (const cell of proof.conclusion.place) {
          const contrary = C.countSolutions(puzzle, { placed, excluded: [...excluded, cell], budgetMs: 10000 });
          assert.equal(contrary.status, 'complete'); assert.equal(contrary.count, 0); conclusionChecks++;
        }
        for (const cell of proof.conclusion.exclude) {
          const contrary = C.countSolutions(puzzle, { placed: [...placed, cell], excluded, budgetMs: 10000 });
          assert.equal(contrary.status, 'complete'); assert.equal(contrary.count, 0); conclusionChecks++;
        }
        placed.push(...proof.conclusion.place); excluded.push(...proof.conclusion.exclude); prior.push(proof);
      }
      transformChecks++;
    }
    rows.push({ level: record.level, puzzleId: record.puzzleId, signature, score: record.targetScore, tier: record.allowedTier,
      status: 'passed', contradictionSteps: contradictions.length });
    if (record.level % 10 === 0) console.log(JSON.stringify({ event: 'verified', throughLevel: record.level,
      transformChecks, conclusionChecks, elapsedMs: Date.now() - started }));
  }
  assert(contradictionPuzzles >= 6);
  const result = { verifiedAt: nowShanghai(), status: 'passed', campaignVersion: campaign.campaignVersion,
    first30Unchanged: true, newRecords: rows.length, transformChecks, conclusionChecks, hints,
    contradictionPuzzles, elapsedMs: Date.now() - started, sourceHashes: sourceHashRows(), rows };
  writeJson(path.join(workRoot, 'verification.json'), result);
  console.log(JSON.stringify(result));
}

const [command, ...args] = process.argv.slice(2);
if (command === 'inventory') inventory();
else if (command === 'search66') search66(Number(args[0]), Number(args[1] || 6000), Number(args[2] || 4));
else if (command === 'build') build();
else if (command === 'verify') verify();
else throw new Error('usage: build-campaign-100.cjs inventory|search66 <seed> <iterations> <retain>|build|verify');

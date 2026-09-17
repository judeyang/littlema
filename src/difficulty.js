(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./puzzle-core.js') : root.PuzzleCore, node ? require('./logic-engine.js') : root.PuzzleLogic);
  if (node) module.exports = api; else root.PuzzleDifficulty = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Logic) {
  'use strict';
  const VERSION = '1.1.1-provisional';
  const clamp = x => Math.max(0, Math.min(1, x));
  // P10/P90 from the frozen 20260915..20261914 cohort; never recompute on newly added puzzles.
  const BOUNDS = Object.freeze({ focus: [1, 2], span: [0.024691358024691357, 0.16], moves: [1, 4], work: [37, 101] });
  const normalize = (x, bounds) => clamp((x - bounds[0]) / (bounds[1] - bounds[0]));
  function transform(puzzle, rotation = 0, mirror = false) {
    const n = puzzle.size, regions = Array(n * n), solution = puzzle.solution || puzzle.horses, output = Array(n);
    for (let i = 0; i < n * n; i++) {
      const row = Math.floor(i / n), col = i % n; let r = row, c = col;
      for (let k = 0; k < rotation; k++) [r, c] = [c, n - 1 - r];
      if (mirror) c = n - 1 - c;
      regions[r * n + c] = puzzle.regions[i];
      if (solution && solution[row] === col) output[r] = c;
    }
    return { size: n, regions, ...(solution ? { solution: output } : {}) };
  }
  function canonical(puzzle) {
    let best;
    for (let r = 0; r < 4; r++) for (const m of [false, true]) {
      const p = transform(puzzle, r, m), ids = new Map();
      p.regions = p.regions.map(id => { if (!ids.has(id)) ids.set(id, ids.size); return ids.get(id); });
      const signature = `${p.size}:${JSON.stringify(p.regions)}`;
      if (!best || signature < best.signature) best = { puzzle: p, signature };
    }
    return best;
  }
  function profile(puzzle, trace, requiredTier, useful = []) {
    const n = puzzle.size, counts = Array(n).fill(0); puzzle.regions.forEach(r => counts[r]++);
    const depths = new Map(), episodes = [], rules = new Set();
    let placed = 0, current = null, maxP = 0, maxS = 0, maxDepth = 0, maxPremises = 0, maxHyp = 0;
    let maxFocus = 0, maxSpan = 0, advancedIndex = 0;
    for (let index = 0; index < trace.length; index++) {
      const step = trace[index], advanced = step.tier > 0;
      const depth = Math.max(0, ...step.premises.map(p => depths.get(p.by) || 0)) + (advanced ? 1 : 0);
      depths.set(step.id, depth); rules.add(step.ruleId);
      if (advanced) {
        if (!current || current.progressPlacements > 0) {
          current = { at: placed / n, proofIds: [], progressPlacements: 0, progressExclusions: 0, traceStart: index };
          episodes.push(current);
        }
        current.proofIds.push(step.id);
        const hyp = step.contradiction ? step.contradiction.steps.length : 0;
        const focus = new Set(step.sourceCells.map(i => puzzle.regions[i])).size;
        const rs = step.sourceCells.map(i => Math.floor(i / n)), cs = step.sourceCells.map(i => i % n);
        const span = rs.length ? ((Math.max(...rs) - Math.min(...rs) + 1) * (Math.max(...cs) - Math.min(...cs) + 1)) / (n * n) : 0;
        // Engineering proxy, not a psychological measurement.
        maxP = Math.max(maxP, .45 * clamp(step.premises.length / 30) + .35 * clamp(depth / 6) + .20 * hyp / 3);
        maxS = Math.max(maxS, .5 * normalize(focus, BOUNDS.focus) + .3 * normalize(span, BOUNDS.span) + .2 * (1 - normalize(useful[advancedIndex] ?? 1, BOUNDS.moves)));
        advancedIndex++; maxFocus = Math.max(maxFocus, focus); maxSpan = Math.max(maxSpan, span);
        maxDepth = Math.max(maxDepth, depth); maxPremises = Math.max(maxPremises, step.premises.length); maxHyp = Math.max(maxHyp, hyp);
      } else if (current) {
        current.progressPlacements += step.conclusion.place.length;
        current.progressExclusions += step.conclusion.exclude.length;
        current.traceEnd = index;
      }
      placed += step.conclusion.place.length;
    }
    const workUnits = trace.reduce((sum, s) => sum + 1 + s.conclusion.place.length + s.conclusion.exclude.length, 0);
    const basicPrefix = trace.findIndex(s => s.tier > 0);
    const basicPlaced = trace.slice(0, basicPrefix < 0 ? trace.length : basicPrefix).reduce((sum, s) => sum + s.conclusion.place.length, 0);
    const R = requiredTier / 5, B = clamp(episodes.length / 4), P = maxP, S = maxS, W = normalize(workUnits, BOUNDS.work);
    const score = Math.round(100 * (.40 * R + .10 * B + .30 * P + .15 * S + .05 * W));
    return { singletonCount: counts.filter(c => c === 1).length, basicClosureSolvedRatio: basicPlaced / n,
      requiredRuleTier: requiredTier, bottleneckEpisodes: episodes.length, bottleneckPositions: episodes.map(e => e.at),
      progressSegments: episodes, cascadeAfterBreakthrough: episodes.map(e => e.progressPlacements / n),
      openingProof: trace[0], proofDepth: maxDepth, premiseCount: maxPremises, lookaheadDepth: maxHyp ? 1 : 0,
      forcedStepsInHypothesis: maxHyp, usefulMovesAtStall: useful, focusRegionCount: maxFocus, span: maxSpan, workUnits, rules: [...rules],
      subsetSizes: [...new Set(trace.filter(s => s.ruleId.includes('subset')).map(s => s.groups.length))],
      components: { R, B, P, S, W }, difficultyScore: score };
  }
  function explore(puzzle, tier, options = {}) {
    const deadline = Date.now() + (options.budgetMs ?? 3000), maxStates = options.maxStates ?? 200, width = Math.min(8, options.width ?? 8);
    let frontier = [{ state: Logic.createState(puzzle), useful: [] }], expanded = 0, pruned = false, unfinished = false;
    const visited = new Set(), finals = [];
    while (frontier.length && expanded < maxStates && Date.now() < deadline) {
      const next = [];
      for (const item of frontier) {
        if (expanded >= maxStates || Date.now() >= deadline) { unfinished = true; break; }
        expanded++;
        let result = Logic.derive(item.state, { maxTier: 0, deadline });
        while (result.status === 'progress' && Date.now() < deadline) {
          Logic.applyStep(item.state, result.steps[0]); result = Logic.derive(item.state, { maxTier: 0, deadline });
        }
        if (Date.now() >= deadline) { unfinished = true; break; }
        const key = Logic.fingerprint(item.state);
        if (visited.has(key)) continue; visited.add(key);
        if (result.status === 'solved') { finals.push(item); continue; }
        if (result.status !== 'stalled') continue;
        result = Logic.derive(item.state, { maxTier: tier, deadline });
        if (result.status === 'unknown') unfinished = true;
        if (result.status !== 'progress') continue;
        const unique = [...new Map(result.steps.map(s => [JSON.stringify(s.conclusion), s])).values()];
        if (unique.length > width) pruned = true;
        unique.sort((a, b) => a.premises.length - b.premises.length || a.sourceCells.length - b.sourceCells.length);
        for (const step of unique.slice(0, width)) {
          const state = Logic.clone(item.state); Logic.applyStep(state, step);
          next.push({ state, useful: [...item.useful, unique.length] });
        }
      }
      next.sort((a, b) => profile(puzzle, a.state.trace, tier).difficultyScore - profile(puzzle, b.state.trace, tier).difficultyScore);
      if (next.length > width) pruned = true;
      frontier = next.slice(0, width);
    }
    finals.sort((a, b) => profile(puzzle, a.state.trace, tier).difficultyScore - profile(puzzle, b.state.trace, tier).difficultyScore);
    return { status: frontier.length || unfinished ? 'unknown' : 'complete', expanded, pruned, best: finals[0], solutionsFound: finals.length,
      guarantee: 'bounded-paths-only' };
  }
  function analyze(input, options = {}) {
    const valid = Core.validate(input);
    if (!valid.valid) return { status: 'invalid', errors: valid.errors };
    const { puzzle, signature } = canonical({ size: input.size, regions: input.regions });
    const exact = Core.countSolutions(puzzle, options.exact);
    if (exact.status !== 'complete') return { status: exact.status, stage: 'uniqueness' };
    if (exact.count !== 1 || exact.truncated) return { status: 'rejected', reason: exact.count ? 'multiple-solutions' : 'no-solution' };
    let requiredTier, solved; const weaker = [];
    for (let tier = 0; tier <= 5; tier++) {
      const result = Logic.solve(puzzle, {}, { maxTier: tier, budgetMs: options.budgetMs ?? 3000 });
      weaker.push({ tier, status: result.status, placed: result.state?.placed.size ?? 0 });
      if (result.status === 'unknown') return { status: 'unknown', stage: 'tier-analysis', weaker };
      if (result.status === 'solved') { requiredTier = tier; solved = result; break; }
    }
    if (!solved) return { status: 'rejected', reason: 'human-rules-stalled', weaker };
    const paths = explore(puzzle, requiredTier, options);
    if (paths.status === 'unknown') return { status: 'unknown', stage: 'path-analysis', paths: { ...paths, best: undefined } };
    const trace = paths.best?.state.trace || solved.trace;
    if (!Logic.replay(puzzle, {}, trace).valid) return { status: 'rejected', reason: 'proof-replay' };
    const report = profile(puzzle, trace, requiredTier, paths.best?.useful);
    const ablations = {};
    for (const rule of report.rules.filter(r => Logic.RULE_TIERS[r] > 0)) {
      const result = Logic.solve(puzzle, {}, { maxTier: requiredTier, disabledRules: [rule], budgetMs: options.budgetMs ?? 3000 });
      ablations[rule] = { status: result.status, necessaryWithinSupportedClosure: result.status === 'stalled' };
    }
    for (const [family, rules] of Object.entries({ 'single-lock-family': ['region-line-lock', 'line-region-lock'],
      'subset-lock-family': ['region-subset-lock', 'line-subset-lock'] })) {
      const result = Logic.solve(puzzle, {}, { maxTier: requiredTier, disabledRules: rules, budgetMs: options.budgetMs ?? 3000 });
      ablations[family] = { status: result.status, necessaryWithinSupportedClosure: result.status === 'stalled' };
    }
    const subsetAblations = {};
    for (const k of report.subsetSizes) {
      const result = Logic.solve(puzzle, {}, { maxTier: requiredTier, maxSubsetSize: k - 1, budgetMs: options.budgetMs ?? 3000 });
      subsetAblations[k] = { status: result.status, requiredAtLeastThisSize: result.status === 'stalled' };
    }
    return { status: 'accepted', analyzerVersion: VERSION, signature, puzzle: { ...puzzle, solution: exact.solutions[0] },
      unique: true, humanSolvable: true, profile: report, difficultyScore: report.difficultyScore, trace, weaker, ablations, subsetAblations,
      paths: { status: paths.status, expanded: paths.expanded, pruned: paths.pruned, solutionsFound: paths.solutionsFound, guarantee: paths.guarantee } };
  }
  return { version: VERSION, bounds: BOUNDS, transform, canonical, profile, explore, analyze };
});

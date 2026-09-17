(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./puzzle-core.js') : root.PuzzleCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuzzleLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const sorted = xs => [...xs].sort((a, b) => a - b);
  const groupRef = g => ({ kind: g.kind, index: g.index });
  const RULE_TIERS = Object.freeze({ 'placed-exclusion': 0, single: 0,
    'region-line-lock': 1, 'line-region-lock': 1, 'region-subset-lock': 2,
    'line-subset-lock': 2, 'common-conflict': 4, 'bounded-contradiction': 5 });

  function createState(puzzle, input = {}) {
    const board = Core.compile(puzzle), checked = Core.facts(board, input);
    const state = { board, ...checked, reasons: new Map(), trace: [] };
    for (const i of state.placed) state.reasons.set(`place:${i}`, `input:place:${i}`);
    for (const i of state.excluded) state.reasons.set(`exclude:${i}`, `input:exclude:${i}`);
    return state;
  }
  function clone(state) {
    return { board: state.board, placed: new Set(state.placed), excluded: new Set(state.excluded),
      reasons: new Map(state.reasons), trace: state.trace.slice() };
  }
  function fingerprint(state) { return JSON.stringify([sorted(state.placed), sorted(state.excluded)]); }
  function available(state, group) { return group.cells.filter(i => !state.excluded.has(i)); }
  function fulfilled(state, group) { return group.cells.some(i => state.placed.has(i)); }

  function conflict(state) {
    for (const i of state.placed) {
      if (state.excluded.has(i)) return { kind: 'excluded-placement', cells: [i] };
      const j = state.board.conflicts[i].find(x => state.placed.has(x));
      if (j !== undefined) return { kind: 'conflicting-placements', cells: [i, j] };
    }
    for (const g of state.board.groups) {
      if (!fulfilled(state, g) && available(state, g).length === 0) {
        return { kind: 'empty-group', group: groupRef(g), cells: g.cells.slice() };
      }
    }
    return null;
  }

  function proof(state, ruleId, sourceCells, groups, place, exclude, extra = {}) {
    const relevant = new Set(sourceCells);
    groups.forEach(g => g.cells.forEach(i => relevant.add(i)));
    const premises = [];
    for (const i of sorted(relevant)) {
      for (const [kind, set] of [['place', state.placed], ['exclude', state.excluded]]) {
        if (set.has(i)) premises.push({ kind, cell: i, by: state.reasons.get(`${kind}:${i}`) });
      }
    }
    const conclusion = { place: sorted(new Set(place)), exclude: sorted(new Set(exclude)) };
    const scope = groups.map(groupRef);
    return { id: `${state.trace.length}:${ruleId}:${JSON.stringify([scope, conclusion])}`,
      ruleId, tier: RULE_TIERS[ruleId], before: fingerprint(state), premises,
      sourceCells: sorted(new Set(sourceCells)), groups: scope, conclusion, ...extra };
  }

  function applyStep(state, step) {
    if (step.before !== fingerprint(state)) throw new Error('stale proof state');
    if (step.conclusion.place.some(i => state.placed.has(i) || state.excluded.has(i)) ||
        step.conclusion.exclude.some(i => state.placed.has(i) || state.excluded.has(i))) throw new Error('proof has non-new or conflicting conclusions');
    for (const [kind, cells] of Object.entries(step.conclusion)) {
      const set = kind === 'place' ? state.placed : state.excluded;
      for (const i of cells) {
        if (!Number.isInteger(i) || i < 0 || i >= state.board.size ** 2) throw new Error('invalid proof cell');
        set.add(i); state.reasons.set(`${kind}:${i}`, step.id);
      }
    }
    state.trace.push(step);
    return state;
  }

  function basic(state) {
    const steps = [];
    for (const i of sorted(state.placed)) {
      const targets = state.board.conflicts[i].filter(j => !state.excluded.has(j) && !state.placed.has(j));
      if (targets.length) steps.push(proof(state, 'placed-exclusion', [i], [], [], targets));
    }
    if (steps.length) return steps;
    for (const g of state.board.groups) {
      if (fulfilled(state, g)) continue;
      const cells = available(state, g);
      if (cells.length === 1) steps.push(proof(state, 'single', cells, [g], cells, []));
    }
    return steps;
  }

  function* combinations(array, k, start = 0, chosen = []) {
    if (chosen.length === k) { yield chosen; return; }
    for (let i = start; i <= array.length - (k - chosen.length); i++) {
      yield* combinations(array, k, i + 1, [...chosen, array[i]]);
    }
  }
  function ruleEnabled(rule, options) {
    return !(options.disabledRules || []).includes(rule);
  }

  function derive(state, options = {}) {
    const bad = conflict(state);
    if (bad) return { status: 'contradiction', conflict: bad, steps: [] };
    if (state.placed.size === state.board.size) return { status: 'solved', steps: [] };
    const maxTier = options.maxTier === undefined ? 5 : options.maxTier;
    const basicSteps = basic(state).filter(s => ruleEnabled(s.ruleId, options));
    if (basicSteps.length) return { status: 'progress', steps: basicSteps };
    if (maxTier === 0) return { status: 'stalled', steps: [] };
    const deadline = options.deadline === undefined ? Date.now() + (options.budgetMs === undefined ? 500 : options.budgetMs) : options.deadline;
    const cap = options.maxChecks === undefined ? 50000 : options.maxChecks;
    let checks = 0;
    const spent = () => ++checks > cap || Date.now() >= deadline;
    const openGroups = state.board.groups.filter(g => !fulfilled(state, g) && available(state, g).length >= 2);
    const project = (cell, kind) => kind === 'row' ? Math.floor(cell / state.board.size) : kind === 'column' ? cell % state.board.size : state.board.regions[cell];

    const subsetLimit = Math.min(maxTier < 2 ? 1 : maxTier < 3 ? 2 : 4,
      Number.isInteger(options.maxSubsetSize) ? Math.max(1, Math.min(4, options.maxSubsetSize)) : 4);
    for (let k = 1; k <= subsetLimit; k++) {
      const steps = [];
      for (const sourceKind of ['region', 'row', 'column']) {
        const targetKinds = sourceKind === 'region' ? ['row', 'column'] : ['region'];
        const ruleId = sourceKind === 'region'
          ? (k === 1 ? 'region-line-lock' : 'region-subset-lock')
          : (k === 1 ? 'line-region-lock' : 'line-subset-lock');
        if (!ruleEnabled(ruleId, options)) continue;
        for (const members of combinations(openGroups.filter(g => g.kind === sourceKind), k)) {
          if (spent()) return { status: 'unknown', steps: [], reason: 'analysis-budget' };
          const candidates = members.flatMap(g => available(state, g));
          const sourceIds = new Set(members.map(g => g.index));
          // Check both axes independently, including when only the second has new targets.
          for (const targetKind of targetKinds) {
            const targetIds = new Set(candidates.map(i => project(i, targetKind)));
            if (targetIds.size !== k) continue;
            const targets = [];
            for (let i = 0; i < state.board.size ** 2; i++) {
              if (targetIds.has(project(i, targetKind)) && !sourceIds.has(project(i, sourceKind)) &&
                  !state.excluded.has(i) && !state.placed.has(i)) targets.push(i);
            }
            if (targets.length) steps.push(proof(state, ruleId, candidates, members, [], targets,
              { tier: k <= 2 ? RULE_TIERS[ruleId] : 3, targetGroups: sorted(targetIds).map(index => ({ kind: targetKind, index })) }));
          }
        }
      }
      if (steps.length) return { status: 'progress', steps };
    }

    if (maxTier >= 4 && ruleEnabled('common-conflict', options)) {
      const steps = [];
      for (const group of openGroups) {
        if (spent()) return { status: 'unknown', steps: [], reason: 'analysis-budget' };
        const candidates = available(state, group);
        const targets = state.board.conflicts[candidates[0]].filter(i =>
          !state.excluded.has(i) && !state.placed.has(i) &&
          candidates.every(c => state.board.conflicts[c].includes(i)));
        if (targets.length) steps.push(proof(state, 'common-conflict', candidates, [group], [], targets));
      }
      if (steps.length) return { status: 'progress', steps };
    }

    if (maxTier >= 5 && ruleEnabled('bounded-contradiction', options)) {
      const maxForcedSteps = Number.isInteger(options.maxHypSteps) ? Math.max(0, Math.min(3, options.maxHypSteps)) : 3;
      for (let i = 0; i < state.board.size ** 2; i++) {
        if (spent()) return { status: 'unknown', steps: [], reason: 'analysis-budget' };
        if (state.excluded.has(i) || state.placed.has(i)) continue;
        const branch = clone(state);
        branch.placed.add(i); branch.reasons.set(`place:${i}`, `assumption:${i}`);
        // Explore every basic propagation order within the SAME three-step hypothesis.
        // A first-single-only scan can miss a short contradiction after rotation.
        const queue = [{ branch, nested: [] }], seen = new Set();
        let witness;
        while (queue.length) {
          if (spent()) return { status: 'unknown', steps: [], reason: 'analysis-budget' };
          const item = queue.shift(), key = fingerprint(item.branch);
          if (seen.has(key)) continue; seen.add(key);
          const bad = conflict(item.branch);
          if (bad) { witness = { nested: item.nested, contradiction: bad }; break; }
          if (item.nested.length >= maxForcedSteps) continue;
          for (const step of basic(item.branch)) {
            const next = clone(item.branch); applyStep(next, step);
            queue.push({ branch: next, nested: [...item.nested, step] });
          }
        }
        if (witness) {
          const { nested, contradiction } = witness;
          const groups = state.board.groups.filter(g => contradiction.group && g.kind === contradiction.group.kind && g.index === contradiction.group.index);
          const step = proof(state, 'bounded-contradiction', [i, ...nested.flatMap(s => s.sourceCells)], groups, [], [i],
            { contradiction: { assumedCell: i, steps: nested, conflict: contradiction }, maxHypSteps: maxForcedSteps });
          // Nested reasoning may depend on facts outside the final conflict group.
          const refs = new Map(step.premises.map(p => [`${p.kind}:${p.cell}`, p]));
          for (const s of nested) for (const p of s.premises) {
            if (state.reasons.get(`${p.kind}:${p.cell}`) === p.by) refs.set(`${p.kind}:${p.cell}`, p);
          }
          step.premises = [...refs.values()];
          return { status: 'progress', steps: [step] };
        }
      }
    }
    return { status: 'stalled', steps: [] };
  }

  function solve(puzzle, input = {}, options = {}) {
    let state;
    try { state = createState(puzzle, input); }
    catch (error) { return { status: 'invalid', error: error.message, trace: [] }; }
    const deadline = Date.now() + (options.budgetMs === undefined ? 2000 : options.budgetMs);
    const maxSteps = options.maxSteps === undefined ? puzzle.size ** 2 * 2 : options.maxSteps;
    while (state.trace.length < maxSteps) {
      if (Date.now() >= deadline) return { status: 'unknown', reason: 'solve-budget', state, trace: state.trace };
      const result = derive(state, { ...options, deadline });
      if (result.status !== 'progress') return { ...result, state, trace: state.trace };
      const choice = options.chooseStep ? options.chooseStep(result.steps) : result.steps[0];
      if (!result.steps.includes(choice)) throw new Error('chooseStep must return an offered step');
      applyStep(state, choice);
    }
    return { status: 'unknown', reason: 'step-budget', state, trace: state.trace };
  }

  function verifyStep(state, step) {
    if (!step || step.before !== fingerprint(state)) return false;
    const result = derive(state, { maxTier: step.tier, maxHypSteps: step.maxHypSteps, budgetMs: 5000 });
    return result.steps.some(candidate => JSON.stringify(candidate) === JSON.stringify(step));
  }

  function replay(puzzle, input, trace) {
    let state;
    try {
      state = createState(puzzle, input);
      for (const step of trace) {
        if (!verifyStep(state, step)) return { valid: false, stepId: step.id };
        applyStep(state, step);
      }
      return { valid: !conflict(state), state };
    } catch (error) { return { valid: false, error: error.message }; }
  }

  // User marks only suppress already-performed actions; they never narrow candidates.
  function hint(puzzle, input = {}, userMarks = [], options = {}) {
    let state, marks;
    try { state = createState(puzzle, input); marks = Core.facts(puzzle, { excluded: userMarks }).excluded; }
    catch (error) { return { type: 'invalid', message: error.message }; }
    const deadline = Date.now() + (options.budgetMs === undefined ? 500 : options.budgetMs);
    const prerequisites = [];
    for (let guard = 0; guard < puzzle.size ** 2 * 2; guard++) {
      if (Date.now() >= deadline) return { type: 'unknown', prerequisites };
      const result = derive(state, { ...options, deadline });
      if (result.status !== 'progress') return { type: result.status, conflict: result.conflict, prerequisites };
      const step = result.steps[0];
      if (step.conclusion.place.length) {
        return { type: step.conclusion.place.some(i => marks.has(i)) ? 'correction' : 'horse',
          proof: step, targets: step.conclusion.place, prerequisites };
      }
      const targets = step.conclusion.exclude.filter(i => !marks.has(i));
      if (targets.length) return { type: 'exclude', proof: step, targets, prerequisites };
      applyStep(state, step); prerequisites.push(step);
    }
    return { type: 'unknown', prerequisites };
  }

  return { version: '1.1.0', RULE_TIERS, createState, clone, fingerprint, conflict,
    available, derive, applyStep, solve, verifyStep, replay, hint };
});

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuzzleCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function validate(puzzle) {
    const errors = [];
    if (!puzzle || !Number.isInteger(puzzle.size) || puzzle.size < 1 || puzzle.size > 16) {
      return { valid: false, errors: ['size must be an integer from 1 to 16'] };
    }
    const n = puzzle.size, regions = puzzle.regions;
    if (!Array.isArray(regions) || regions.length !== n * n ||
        regions.some(g => !Number.isInteger(g) || g < 0 || g >= n)) {
      return { valid: false, errors: ['regions must contain size*size region ids in range'] };
    }
    for (let g = 0; g < n; g++) {
      const cells = regions.flatMap((v, i) => v === g ? [i] : []);
      if (!cells.length) { errors.push(`region ${g} is empty`); continue; }
      const seen = new Set([cells[0]]), queue = [cells[0]];
      while (queue.length) {
        const i = queue.pop(), r = Math.floor(i / n), c = i % n;
        for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
          const j = rr * n + cc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && regions[j] === g && !seen.has(j)) {
            seen.add(j); queue.push(j);
          }
        }
      }
      if (seen.size !== cells.length) errors.push(`region ${g} is disconnected`);
    }
    return { valid: errors.length === 0, errors };
  }

  function compile(puzzle) {
    const result = validate(puzzle);
    if (!result.valid) throw new TypeError(result.errors.join('; '));
    const size = puzzle.size, regions = puzzle.regions.slice();
    const groups = [];
    for (const kind of ['row', 'column', 'region']) {
      for (let index = 0; index < size; index++) {
        const cells = [];
        for (let i = 0; i < size * size; i++) {
          if ((kind === 'row' ? Math.floor(i / size) : kind === 'column' ? i % size : regions[i]) === index) cells.push(i);
        }
        groups.push({ kind, index, cells });
      }
    }
    const conflicts = Array.from({ length: size * size }, (_, i) => {
      const r = Math.floor(i / size), c = i % size, out = [];
      for (let j = 0; j < size * size; j++) {
        if (i === j) continue;
        const rr = Math.floor(j / size), cc = j % size;
        if (r === rr || c === cc || regions[i] === regions[j] ||
            (Math.abs(r - rr) <= 1 && Math.abs(c - cc) <= 1)) out.push(j);
      }
      return out;
    });
    return { size, regions, groups, conflicts };
  }

  function facts(puzzle, input = {}) {
    const n = puzzle.size;
    const placed = [...(input.placed || [])], excluded = [...(input.excluded || [])];
    if ([...placed, ...excluded].some(i => !Number.isInteger(i) || i < 0 || i >= n * n)) {
      throw new TypeError('fact cell is out of range');
    }
    return { placed: new Set(placed), excluded: new Set(excluded) };
  }

  // Independent row-wise exact search: never calls the human-rule engine.
  function countSolutions(puzzle, options = {}) {
    const validation = validate(puzzle);
    if (!validation.valid) return { status: 'invalid', count: 0, errors: validation.errors, solutions: [] };
    const n = puzzle.size, regions = puzzle.regions;
    let state;
    try { state = facts(puzzle, options); }
    catch (error) { return { status: 'invalid', count: 0, errors: [error.message], solutions: [] }; }
    const limit = options.limit === undefined ? 2 : options.limit;
    const maxNodes = options.maxNodes === undefined ? 1000000 : options.maxNodes;
    const budgetMs = options.budgetMs === undefined ? 1000 : options.budgetMs;
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(maxNodes) || maxNodes < 0 || !Number.isFinite(budgetMs) || budgetMs < 0) {
      return { status: 'invalid', count: 0, errors: ['invalid search budget'], solutions: [] };
    }
    const forced = new Map();
    for (const i of state.placed) {
      const row = Math.floor(i / n), col = i % n;
      if (state.excluded.has(i) || (forced.has(row) && forced.get(row) !== col)) {
        return { status: 'complete', count: 0, solutions: [], nodes: 0, truncated: false };
      }
      forced.set(row, col);
    }
    const usedCols = new Set(), usedRegions = new Set(), answer = [], solutions = [];
    const deadline = Date.now() + budgetMs;
    let nodes = 0, exhausted = false;
    function search(row) {
      if (solutions.length >= limit || exhausted) return;
      if (nodes >= maxNodes || Date.now() >= deadline) { exhausted = true; return; }
      nodes++;
      if (row === n) { solutions.push(answer.slice()); return; }
      const cols = forced.has(row) ? [forced.get(row)] : Array.from({ length: n }, (_, c) => c);
      for (const col of cols) {
        const cell = row * n + col, region = regions[cell];
        if (state.excluded.has(cell) || usedCols.has(col) || usedRegions.has(region) ||
            (row > 0 && Math.abs(answer[row - 1] - col) <= 1)) continue;
        usedCols.add(col); usedRegions.add(region); answer[row] = col;
        search(row + 1);
        usedCols.delete(col); usedRegions.delete(region);
        if (solutions.length >= limit || exhausted) break;
      }
    }
    search(0);
    return { status: exhausted ? 'unknown' : 'complete', count: solutions.length,
      solutions, nodes, truncated: solutions.length >= limit };
  }

  function validateSolution(puzzle, solution) {
    if (!validate(puzzle).valid || !Array.isArray(solution) || solution.length !== puzzle.size) return false;
    const n = puzzle.size, cols = new Set(), regions = new Set();
    for (let r = 0; r < n; r++) {
      const c = solution[r];
      if (!Number.isInteger(c) || c < 0 || c >= n || cols.has(c) ||
          (r > 0 && Math.abs(c - solution[r - 1]) <= 1)) return false;
      cols.add(c); regions.add(puzzle.regions[r * n + c]);
    }
    return regions.size === n;
  }

  return { version: '1.0.0', validate, compile, facts, countSolutions, validateSolution };
});

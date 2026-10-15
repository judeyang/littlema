(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoundChallenge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STANDARD_POLICY = Object.freeze({ seconds: 180, hintLimit: 2 });
  const COMPLEX_POLICY = Object.freeze({ seconds: 300, hintLimit: 3 });
  const LATE_COMPLEX_POLICY = Object.freeze({ seconds: 480, hintLimit: 3 });
  const TUTORIAL_POLICY = Object.freeze({ seconds: null, hintLimit: null });
  const MAX_HINT_KEY_LENGTH = 2048;
  const MAX_UNLIMITED_HINT_KEYS = 1000;

  function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function isPeakRole(role) {
    return typeof role === 'string' && role.includes('高峰') && !role.includes('回落');
  }

  function policyFor(record) {
    const source = record && typeof record === 'object' ? record : {};
    const level = Number.isInteger(source.level) ? source.level : 0;
    if (level >= 1 && level <= 5) return { ...TUTORIAL_POLICY };

    const complex = isPeakRole(source.role) ||
      (finiteNumber(source.allowedTier) && source.allowedTier >= 3) ||
      (finiteNumber(source.targetScore) && source.targetScore >= 45);
    if (complex && level >= 77) return { ...LATE_COMPLEX_POLICY };
    if (complex) return { ...COMPLEX_POLICY };
    return { ...STANDARD_POLICY };
  }

  function validHintKey(value) {
    return typeof value === 'string' && value.length <= MAX_HINT_KEY_LENGTH && value.trim().length > 0;
  }

  function restoredHintKeys(saved, limit) {
    const keys = new Set();
    const max = limit === null ? MAX_UNLIMITED_HINT_KEYS : limit;
    if (!saved || !Array.isArray(saved.hintKeys)) return keys;
    for (const key of saved.hintKeys) {
      if (keys.size >= max) break;
      if (validHintKey(key)) keys.add(key);
    }
    return keys;
  }

  function create(record, saved) {
    const policy = policyFor(record);
    const totalMs = policy.seconds === null ? null : policy.seconds * 1000;
    const restoredMs = saved && saved.remainingMs;
    const remainingMs = totalMs === null
      ? null
      : finiteNumber(restoredMs) && restoredMs >= 0
        ? Math.min(restoredMs, totalMs)
        : totalMs;
    return {
      policy,
      remainingMs,
      hintKeys: restoredHintKeys(saved, policy.hintLimit)
    };
  }

  function advance(state, deltaMs) {
    if (!state || state.remainingMs === null) return state ? state.remainingMs : null;
    if (!finiteNumber(state.remainingMs) || state.remainingMs < 0) state.remainingMs = 0;
    if (!finiteNumber(deltaMs) || deltaMs < 0) return state.remainingMs;
    state.remainingMs = Math.max(0, state.remainingMs - deltaMs);
    return state.remainingMs;
  }

  function remainingHints(state) {
    if (!state || !state.policy || state.policy.hintLimit === null) return null;
    const limit = Number.isInteger(state.policy.hintLimit) && state.policy.hintLimit >= 0
      ? state.policy.hintLimit
      : 0;
    const used = state.hintKeys instanceof Set ? state.hintKeys.size : 0;
    return Math.max(0, limit - used);
  }

  function sortedIndices(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.filter(value => Number.isInteger(value) && value >= 0))]
      .sort((a, b) => a - b);
  }

  function sortedGroups(values) {
    if (!Array.isArray(values)) return [];
    const groups = new Map();
    for (const value of values) {
      if (!value || typeof value !== 'object' || typeof value.kind !== 'string' ||
          !value.kind || !Number.isInteger(value.index) || value.index < 0) continue;
      const key = `${value.kind}\u0000${value.index}`;
      if (!groups.has(key)) groups.set(key, { kind: value.kind, index: value.index });
    }
    return [...groups.values()].sort((a, b) =>
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.index - b.index);
  }

  function hintKey(result) {
    const proof = result && result.proof;
    if (!proof || typeof proof !== 'object' || typeof proof.ruleId !== 'string' || !proof.ruleId) return null;
    const place = sortedIndices(proof.conclusion && proof.conclusion.place);
    const exclude = sortedIndices(proof.conclusion && proof.conclusion.exclude);
    if (!place.length && !exclude.length) return null;
    return JSON.stringify({
      ruleId: proof.ruleId,
      groups: sortedGroups(proof.groups),
      targetGroups: sortedGroups(proof.targetGroups),
      conclusion: { place, exclude }
    });
  }

  function claimHint(state, key) {
    if (!state || !(state.hintKeys instanceof Set) || !validHintKey(key)) return false;
    if (state.hintKeys.has(key)) return true;
    const left = remainingHints(state);
    if (left !== null && left <= 0) return false;
    if (left === null && state.hintKeys.size >= MAX_UNLIMITED_HINT_KEYS) return false;
    state.hintKeys.add(key);
    return true;
  }

  function snapshot(state) {
    return {
      remainingMs: state ? state.remainingMs : null,
      hintKeys: state && state.hintKeys instanceof Set ? [...state.hintKeys] : []
    };
  }

  return { policyFor, create, advance, remainingHints, hintKey, claimHint, snapshot };
});

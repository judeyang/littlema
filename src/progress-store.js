(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProgressStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function create(key) {
  'use strict';
  const KEY = key === undefined ? 'pony-run-progress-v11' : key;
  if(typeof KEY !== 'string' || !KEY.trim()) throw new Error('storage key required');
  const BACKUP_KEY = `${KEY}-backup`;
  let writesBlocked = false;
  const ints = (xs, max) => Array.isArray(xs) && xs.every(i => Number.isInteger(i) && i >= 0 && i < max);
  function rawHash(raw) {
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
      if (!raw) return { status: 'empty' };
      const data = JSON.parse(raw), max = Number(data.size) ** 2;
      if (!data || data.schema !== 1 || !Number.isInteger(data.level) || data.level < 1 ||
          !Number.isInteger(data.size) || data.size < 1 || !ints(data.revealed, max) ||
          !ints(data.missed, max) || !ints(data.candidates, max) ||
          data.revealed.some(i => data.missed.includes(i)) ||
          (data.puzzleFingerprint !== undefined && typeof data.puzzleFingerprint !== 'string')) {
        return { status: 'invalid', reason: '存档内容不完整', raw };
      }
      return { status: 'ok', data, raw };
    } catch (error) {
      if (raw === undefined) writesBlocked = true;
      return { status: 'invalid', reason: '存档无法读取', ...(raw === undefined ? {} : { raw }) };
    }
  }
  function backup(raw) {
    if (typeof raw !== 'string' || !raw) return { status: 'invalid', reason: '没有可备份的原存档' };
    try {
      const primary = localStorage.getItem(BACKUP_KEY);
      if (primary === raw) return { status: 'ok', reused: true };
      const target = primary === null ? BACKUP_KEY : `${BACKUP_KEY}-${rawHash(raw)}`;
      const existing = primary === null ? null : localStorage.getItem(target);
      if (existing === raw) return { status: 'ok', reused: true };
      if (existing !== null) {
        writesBlocked = true;
        return { status: 'unavailable', reason: '原存档备份键发生冲突' };
      }
      localStorage.setItem(target, raw);
      if (localStorage.getItem(target) !== raw) throw new Error('backup verification failed');
      return { status: 'ok', reused: false };
    } catch (error) {
      writesBlocked = true;
      return { status: 'unavailable', reason: '原存档无法安全备份' };
    }
  }
  function save(data) {
    if (writesBlocked) return { status: 'unavailable', reason: '原存档未安全备份，本次进度不会保存' };
    try {
      localStorage.setItem(KEY, JSON.stringify({ schema: 1, ...data }));
      return { status: 'ok' };
    } catch (error) { return { status: 'unavailable', reason: '本机存储不可用' }; }
  }
  function clear() {
    try { localStorage.removeItem(KEY); return { status: 'ok' }; }
    catch (error) { return { status: 'unavailable' }; }
  }
  // 列出本机所有玩家档案：
  // 默认档案"玩家"对应原始 key（无后缀）；其他档案为 pony-run-progress-v11:<名字>
  function listProfiles() {
    const names = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const m = k && k.match(/^pony-run-progress-v11:(.+)$/);
        if (m) names.push(m[1]);
      }
      if (names.indexOf('玩家') === -1 && localStorage.getItem('pony-run-progress-v11')) {
        names.push('玩家');
      }
    } catch (error) { /* 存储不可用时返回空列表 */ }
    return names.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }
  return { KEY, BACKUP_KEY, load, backup, save, clear, listProfiles, create };
});

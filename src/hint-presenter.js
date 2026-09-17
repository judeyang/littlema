(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HintPresenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const COLORS = ['黄色','粉色','珊瑚红','天蓝色','紫色','绿色','橙色','青色','玫红','靛蓝','驼色','苹果绿','薄荷绿','薰衣草'];
  // puzzle.colorMap（可选）：区域 id → COLORS 索引，复刻关卡按映射报颜色名
  const groupName = (g, puzzle) => {
    const map = puzzle && Array.isArray(puzzle.colorMap) ? puzzle.colorMap : null;
    const idx = map && Number.isInteger(map[g.index]) ? map[g.index] : g.index;
    return g.kind === 'region' ? `${COLORS[idx] || `区域 ${g.index + 1}`}区域` : `第 ${g.index + 1} ${g.kind === 'row' ? '行' : '列'}`;
  };
  const cellName = (i, n) => `第 ${Math.floor(i / n) + 1} 行第 ${i % n + 1} 列`;
  const cellsName = (cells, n) => {
    const rows = new Map();
    [...new Set(cells)].sort((a, b) => a - b).forEach(i => {
      const row = Math.floor(i / n) + 1;
      if (!rows.has(row)) rows.set(row, []);
      rows.get(row).push(i % n + 1);
    });
    return [...rows].map(([r, cols]) => `第 ${r} 行第 ${cols.join('、')} 列`).join('；');
  };
  function conflictReason(a, b, puzzle) {
    const n = puzzle.size, ar = Math.floor(a / n), br = Math.floor(b / n);
    if (ar === br) return '同行';
    if (a % n === b % n) return '同列';
    if (puzzle.regions[a] === puzzle.regions[b]) return '同色区域';
    if (Math.abs(ar - br) === 1 && Math.abs(a % n - b % n) === 1) return '斜角相邻';
    throw new Error('缺少有效冲突关系');
  }
  function explain(step, puzzle) {
    const groups = step.groups.map(g => groupName(g, puzzle)).join('、');
    const targets = (step.targetGroups || []).map(g => groupName(g, puzzle)).join('、');
    switch (step.ruleId) {
      case 'single': return `${groups}的其他位置（${cellsName(step.premises.filter(p => p.kind === 'exclude').map(p => p.cell), puzzle.size) || '无'}）均已排除，只剩${cellName(step.conclusion.place[0], puzzle.size)}，所以这里必须有马。`;
      case 'placed-exclusion': {
        const source = step.sourceCells[0], reasons = new Map();
        for (const i of step.conclusion.exclude) {
          const reason = conflictReason(source, i, puzzle);
          if (!reasons.has(reason)) reasons.set(reason, []);
          reasons.get(reason).push(i);
        }
        return `${cellName(source, puzzle.size)}有马，因此排除：${[...reasons].map(([reason, cells]) => `${cellsName(cells, puzzle.size)}（与这匹马${reason}）`).join('；')}。`;
      }
      case 'region-line-lock':
      case 'region-subset-lock': return `${groups}的全部候选（${cellsName(step.sourceCells, puzzle.size)}）仅位于${targets}。${step.groups.length} 个区域各需要一匹马，恰好占满这些行或列，因此排除其中其他区域的位置：${cellsName(step.conclusion.exclude, puzzle.size)}。`;
      case 'line-region-lock':
      case 'line-subset-lock': return `${groups}的全部候选（${cellsName(step.sourceCells, puzzle.size)}）仅属于${targets}。这些行或列各需要一匹马，恰好占满这些区域，因此排除区域中位于所选行或列之外的位置：${cellsName(step.conclusion.exclude, puzzle.size)}。`;
      case 'common-conflict': {
        const cases = step.conclusion.exclude.map(target => {
          const reasons = new Map();
          for (const source of step.sourceCells) {
            const reason = conflictReason(source, target, puzzle);
            if (!reasons.has(reason)) reasons.set(reason, []);
            reasons.get(reason).push(source);
          }
          return `${cellName(target, puzzle.size)}：${[...reasons].map(([reason, cells]) => `候选 ${cellsName(cells, puzzle.size)} 与它${reason}`).join('；')}`;
        });
        return `${groups}必须有一匹马，目前候选为 ${cellsName(step.sourceCells, puzzle.size)}。无论选哪一个，以下位置都不能放马：\n${cases.join('\n')}。`;
      }
      case 'bounded-contradiction': {
        const c = step.contradiction.conflict;
        const reason = c.kind === 'empty-group' ? `${groupName(c.group, puzzle)}没有任何候选` : `已确定的位置发生冲突（${c.cells.map(i => cellName(i, puzzle.size)).join('、')}）`;
        return `假设${cellName(step.contradiction.assumedCell, puzzle.size)}有马。\n${step.contradiction.steps.map((s, i) => `第 ${i + 1} 步：${explain(s, puzzle)}`).join('\n')}\n这样会导致${reason}。因此假设不成立，该格可以排除。`;
      }
      default: return '当前规则没有可展示的解释。';
    }
  }
  function fullExplanation(result, puzzle) {
    const root = result.proof, all = new Map((result.prerequisites || []).map(s => [s.id, s]));
    const selected = [], visited = new Set(), visiting = new Set(), labels = new Map();
    const visit = step => {
      if (visited.has(step.id)) return;
      if (visiting.has(step.id)) throw new Error('前置原因循环');
      visiting.add(step.id);
      for (const p of step.premises) {
        if (all.has(p.by)) visit(all.get(p.by));
        else if (!/^input:(place|exclude):\d+$/.test(p.by || '')) throw new Error('缺失前置原因');
      }
      visiting.delete(step.id); visited.add(step.id);
      if (step !== root) selected.push(step);
    };
    visit(root);
    const order = new Map((result.prerequisites || []).map((s, i) => [s.id, i]));
    selected.sort((a, b) => order.get(a.id) - order.get(b.id));
    selected.forEach((s, i) => labels.set(s.id, `前置 ${i + 1}`));
    const refs = (step, scope = labels) => {
      const out = [...new Set(step.premises.map(p => {
        if (scope.has(p.by)) return scope.get(p.by);
        if (/^assumption:\d+$/.test(p.by || '')) return '本次假设';
        if (/^input:place:\d+$/.test(p.by || '')) return `${cellName(p.cell, puzzle.size)}已翻开有马`;
        if (/^input:exclude:\d+$/.test(p.by || '')) return `${cellName(p.cell, puzzle.size)}已判定无马`;
        throw new Error('缺失步骤来源');
      }))];
      return out.length ? `\n依据：${out.join('、')}。` : '';
    };
    const renderProof = (proof, prefix) => {
      if (!proof.contradiction) return `${explain(proof, puzzle)}${refs(proof)}`;
      const scope = new Map(labels), { assumedCell, steps, conflict } = proof.contradiction;
      const paragraphs = [`假设${cellName(assumedCell, puzzle.size)}有马。下面只是假设中的推理，不会在真实棋盘放马。`];
      steps.forEach((s, i) => {
        const name = `${prefix}第 ${i + 1} 步`;
        paragraphs.push(`${name}：${explain(s, puzzle)}${refs(s, scope)}`);
        scope.set(s.id, name);
      });
      if (conflict.kind === 'empty-group') {
        const reasons = new Map();
        for (const p of proof.premises) if (p.kind === 'exclude') {
          reasons.set(p.cell, scope.get(p.by) || (/^input:exclude:/.test(p.by || '') ? '已判定无马的记录' : undefined));
        }
        for (const s of steps) for (const cell of s.conclusion.exclude) reasons.set(cell, scope.get(s.id));
        const entries = conflict.cells.map(cell => {
          if (!reasons.get(cell)) throw new Error('矛盾位置缺少排除原因');
          return `${cellName(cell, puzzle.size)}：已由${reasons.get(cell)}排除。`;
        });
        paragraphs.push(`为什么${groupName(conflict.group, puzzle)}没有候选？\n${entries.join('\n')}\n${groupName(conflict.group, puzzle)}必须有一匹马，但现在每个位置都被排除，产生矛盾。`);
      } else {
        const reason = conflict.kind === 'excluded-placement' ? '同时被要求有马和无马' : `同时有马，但二者${conflictReason(conflict.cells[0], conflict.cells[1], puzzle)}`;
        paragraphs.push(`产生矛盾：${conflict.cells.map(i => cellName(i, puzzle.size)).join('与')}${reason}。`);
      }
      paragraphs.push(`结论：撤销假设，${cellName(assumedCell, puzzle.size)}不能放马，可以标记 ✕。假设中的其他放马和排除不应用到真实棋盘。`);
      return paragraphs.join('\n\n');
    };
    const sections = [];
    if (selected.length) {
      sections.push('先说明已排除位置的原因（以下均由规则推导，不把手动叉号当作证明）：');
      selected.forEach(s => sections.push(`${labels.get(s.id)}：${renderProof(s, `${labels.get(s.id)}中的`)}`));
    }
    sections.push(`本次提示：${renderProof(root, '')}`);
    return sections.join('\n\n');
  }
  function conciseExplanation(result, puzzle) {
    // Validate all ancestry before summarizing; user marks are never proof.
    fullExplanation(result, puzzle);
    const proof = result.proof, n = puzzle.size;
    const brief = step => step.ruleId === 'single'
      ? `${step.groups.map(g => groupName(g, puzzle)).join('、')}只剩${cellName(step.conclusion.place[0], n)}，必须放马。`
      : explain(step, puzzle);
    if (!proof.contradiction) return brief(proof);
    const { assumedCell, steps, conflict } = proof.contradiction;
    const initialExcluded = new Set(JSON.parse(proof.before)[1]);
    const groups = steps.filter(s => s.ruleId === 'single').flatMap(s => s.groups);
    if (conflict.kind === 'empty-group') groups.push(conflict.group);
    const uniqueGroups = [...new Map(groups.map(g => [`${g.kind}:${g.index}`, g])).values()];
    const summary = uniqueGroups.map(g => {
      const cells = Array.from({length:n*n}, (_,i) => i).filter(i =>
        (g.kind === 'row' ? Math.floor(i/n) === g.index : g.kind === 'column' ? i%n === g.index : puzzle.regions[i] === g.index)
        && !initialExcluded.has(i));
      const remaining = g.kind === 'region' ? cellsName(cells,n)
        : `第 ${cells.map(i => g.kind === 'column' ? Math.floor(i/n)+1 : i%n+1).join('、')} ${g.kind === 'column' ? '行' : '列'}`;
      return `${groupName(g,puzzle)}只剩${remaining}`;
    });
    const lines = summary.length ? [`已证明的排除后：${summary.join('；')}。`] : [];
    lines.push(`假设${cellName(assumedCell,n)}有马：`);
    let number = 0;
    steps.forEach((step,index) => {
      // Keep exclusions used by a later step or the final contradiction only.
      const used = new Set(conflict.cells);
      steps.slice(index+1).forEach(s => s.premises.forEach(p => {
        if (p.by === step.id) used.add(p.cell);
      }));
      const exclude = step.conclusion.exclude.filter(i => used.has(i));
      if (!step.conclusion.place.length && !exclude.length) return;
      const needed = {...step, conclusion:{...step.conclusion,exclude}};
      lines.push(`${++number}. ${brief(needed)}`);
    });
    if (conflict.kind === 'empty-group') {
      lines.push(`${groupName(conflict.group,puzzle)}的候选全部被排除，与每${conflict.group.kind === 'row' ? '行' : conflict.group.kind === 'column' ? '列' : '个颜色区域'}必须有一匹马矛盾。`);
    } else {
      const reason = conflict.kind === 'excluded-placement' ? '同时被要求有马和无马' : `同时有马，但二者${conflictReason(conflict.cells[0],conflict.cells[1],puzzle)}`;
      lines.push(`矛盾：${conflict.cells.map(i => cellName(i,n)).join('与')}${reason}。`);
    }
    lines.push(`所以${cellName(assumedCell,n)}不能放马。以上只是假设，不改变棋盘。`);
    return lines.join('\n\n');
  }
  function toLegacyHint(result, puzzle) {
    if (result.proof) {
      let message;
      try { message = conciseExplanation(result, puzzle); }
      catch (error) { return { type: 'none', idxs: [], message: '这条提示的推理依据不完整，请保留本题后反馈。', reason: error.message }; }
      return { type: result.type === 'correction' ? 'error' : result.type,
        idx: result.targets[0], idxs: result.targets, proof: result.proof,
        prerequisites: result.prerequisites,
        message: result.type === 'correction' ? `这个 ✕ 需要撤销：${message}` : message };
    }
    const messages = { unknown: '本次分析达到预算上限，并不代表无解。请保留本题信息后反馈。',
      stalled: '当前支持的推理规则没有找到可解释的新结论，请保留本题信息后反馈。',
      contradiction: '已确认的棋盘事实存在矛盾，请重载本题后检查。',
      solved: '全部小马已经找到。', invalid: '棋盘数据不完整，无法生成可靠提示。' };
    return { type: 'none', idxs: [], message: messages[result.type] || '暂无可展示的提示。' };
  }
  return { COLORS, groupName, cellName, explain, fullExplanation, conciseExplanation, toLegacyHint };
});

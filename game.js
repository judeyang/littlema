/* ====================================================================
 * 小马快跑 · 半对实验室
 * --------------------------------------------------------------------
 * 规则：
 *  1. 每种颜色区域恰有一匹小马
 *  2. 每行每列恰好一匹小马
 *  3. 任意两匹小马不相邻（含八个方向）
 *
 * 交互：
 *  - 单击格子标记/取消候选（X）
 *  - 双击格子翻开：是小马则翻开；不是则扣星 + 变红
 *  - 2 颗星耗尽即失败；翻开全部小马即胜利
 * ==================================================================== */

(() => {
  'use strict';

  // ============================================================
  // 1. 配置常量
  // ============================================================
  const COLORS = [
    { name: 'yellow',  hex: '#f7d774', pattern: 'plain'  },
    { name: 'pink',    hex: '#f7b6c2', pattern: 'plain'  },
    { name: 'coral',   hex: '#f78b7b', pattern: 'plain'  },
    { name: 'sky',     hex: '#a8d8f0', pattern: 'plain'  },
    { name: 'purple',   hex: '#c8b8f0', pattern: 'plain'  },
    { name: 'green',    hex: '#a3e3b0', pattern: 'plain'  },
    { name: 'orange',   hex: '#f5b87a', pattern: 'plain'  },
    { name: 'teal',     hex: '#b8e3e0', pattern: 'plain'  },
    { name: 'magenta',  hex: '#f0a3c8', pattern: 'plain'  },
    { name: 'indigo',   hex: '#9fb8e8', pattern: 'plain'  }, // 第 10 色
    { name: 'camel',    hex: '#d9b38c', pattern: 'plain'  }, // 第 11 色（11×11 棋盘用）
    { name: 'apple',    hex: '#d0e8a4', pattern: 'plain'  }, // 第 12 色（12×12 棋盘用）
    { name: 'mint',     hex: '#c2ecd4', pattern: 'plain'  }, // 第 13 色（13×13 棋盘用）
    { name: 'lavender', hex: '#e2d4f5', pattern: 'plain'  }  // 第 14 色（14×14 棋盘用）
  ];

  function getCampaignRecord(level) {
    return (window.GameCampaign && window.GameCampaign.levels || []).find(item => item.level === level);
  }

  // ============================================================
  // 1.5 第一关分步新手引导（参考"连点两下放小马"教学流程）
  // 配套题目 v13-tutorial-n5：马位 (0,2)(1,4)(2,1)(3,3)(4,0)
  // ============================================================
  const TUTORIAL_KEY = 'pony-run-tutorial-v1';
  const TUTORIAL_ID = 'v13-tutorial-n5';
  const TUTORIAL_PLAN = [
    { id: 'place1', html: '<b class="tut-em">连点两下</b> 把小马放到格子里', highlight: [2], hand: 2,
      allow: { double: [2] } },
    { id: 'rule', html: '一种<b class="tut-em">颜色</b>只准放<b class="tut-em">一</b>匹小马', button: '明白了' },
    { id: 'exclude', html: '小马<b class="tut-em">四周</b>不能有另一匹小马', sub: '点击这些空格以排除他们',
      highlight: [1, 3, 6, 7, 8], allow: { singleExclude: [1, 3, 6, 7, 8] } },
    { id: 'exclude-line', html: '每行每列也各只有<b class="tut-em">一</b>匹小马',
      sub: '把这一行、这一列剩下的格子也排除掉',
      highlight: [0, 4, 12, 17, 22], allow: { singleExclude: [0, 4, 12, 17, 22] } },
    { id: 'place2', html: '只剩最后的<b class="tut-em">珊瑚红</b>格子了，连点两下放小马吧', highlight: [9], hand: 9,
      allow: { double: [9] } },
    { id: 'free', html: '最后两匹小马藏哪了，你找到了吗？', sub: '如需提示，请点击此处 &gt;', hintBtn: true, free: true },
  ];

  function puzzleFingerprint(puzzle) {
    return JSON.stringify({
      size: puzzle.size,
      regions: puzzle.regions,
      solution: puzzle.solution,
      colorMap: puzzle.colorMap || null
    });
  }

  function hasValidSavedFacts(saved, puzzle) {
    const max = puzzle.size ** 2;
    const horseCells = new Set(puzzle.solution.map((column, row) => row * puzzle.size + column));
    return saved.size === puzzle.size &&
      Array.isArray(saved.revealed) && saved.revealed.every(i => Number.isInteger(i) && i >= 0 && i < max && horseCells.has(i)) &&
      Array.isArray(saved.missed) && saved.missed.every(i => Number.isInteger(i) && i >= 0 && i < max && !horseCells.has(i)) &&
      Array.isArray(saved.candidates);
  }

  function canResume(saved, record) {
    const campaign = window.GameCampaign || {};
    if (!saved || !record || saved.level !== record.level || saved.puzzleId !== record.puzzleId ||
        !hasValidSavedFacts(saved, record.puzzle)) return false;
    const currentFingerprint = puzzleFingerprint(record.puzzle);
    if (saved.campaignVersion === campaign.campaignVersion) {
      if (typeof saved.puzzleFingerprint === 'string') return saved.puzzleFingerprint === currentFingerprint;
      // 独立试玩包未升级题库接口，继续兼容其合法旧 schema 存档。
      return ['pony-run-four-test-v12', 'pony-run-four-pair-test-v12'].includes(window.ProgressStore && window.ProgressStore.KEY);
    }
    const compatibility = campaign.resumeCompatibility;
    if (!compatibility || saved.campaignVersion !== compatibility.campaignVersion) return false;
    const frozen = Array.isArray(compatibility.records) && compatibility.records.find(item =>
      item.level === saved.level && item.puzzleId === saved.puzzleId
    );
    return Boolean(frozen && frozen.fingerprint === currentFingerprint &&
      (saved.puzzleFingerprint === undefined || saved.puzzleFingerprint === currentFingerprint));
  }

  // 单格区域（推理起点）难度策略：
  // 构造式生成器（generateRegions）优先只给 1 个单格起点，多次尝试失败才退让到 2 个。
  // 数据验证（构造式 + R1-R6 基本规则求解）：5x5~9x9 全部 100% 可解，
  // 且不再需要"假设检验"式试错，推理起点从旧版的 2~5 个大幅减少，谜题更耐推。

  // 关卡每关获胜后连胜归零，本关连胜累计
  const MAX_MISSES = 2;        // 最多允许翻开错误次数（等价 2 颗星）

  // ============================================================
  // 2. 谜题生成算法
  // ============================================================
  /**
   * 生成满足行/列/相邻约束的小马位置
   * 约束：每行 1 匹、每列 1 匹、任意两匹不相邻（八方向）
   * 返回：长度为 n 的数组 horses[r] = c
   */
  function generateHorsePositions(n) {
    // 多次随机尝试，超出限制则用确定性回溯
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = backtrackHorses(n, /*randomize*/ true);
      if (result) return result;
    }
    return backtrackHorses(n, /*randomize*/ false);
  }

  function backtrackHorses(n, randomize) {
    const cols = new Array(n).fill(-1); // cols[r] = c
    const usedCols = new Set();

    function canPlace(row, col) {
      if (usedCols.has(col)) return false;
      // 只检查上一行：因为按行递增放置
      // - 行约束：每行只放一个，所以下上行肯定不会冲突
      // - 相邻约束：3x3 范围内冲突 ⇒ 检查上一行的 3 个格子
      if (row > 0) {
        const prev = cols[row - 1];
        if (prev >= 0 && Math.abs(prev - col) <= 1) return false;
      }
      return true;
    }

    function backtrack(row) {
      if (row === n) return cols.slice();
      const order = randomize
        ? shuffle([...Array(n).keys()])
        : [...Array(n).keys()];
      for (const c of order) {
        if (canPlace(row, c)) {
          cols[row] = c;
          usedCols.add(c);
          const r = backtrack(row + 1);
          if (r) return r;
          usedCols.delete(c);
          cols[row] = -1;
        }
      }
      return null;
    }

    return backtrack(0);
  }

  /**
   * 基于小马位置，划分棋盘为 n 个颜色区域（构造式生成）
   * 每个区域包含恰好 1 匹小马，且连通（4 邻接）
   *
   * 可解性设计（对比旧版"随机生长+事后验证"的根本升级）：
   *  先随机确定"推理顺序" h1..hn，再让每个格子的归属满足：
   *    格 x 只能分给区域 Rk，其中 k > e(x)
   *    （e(x) = x 最早被第几步的小马排除：同行/同列/3×3 邻域）
   *  这样轮到第 k 步时，Rk 的其他格都已被前 k-1 匹马排除，
   *  Rk 的唯一候选必是它的小马 → 推理像多米诺一样逐级连锁，
   *  仅用基本规则（唯一候选 + 排除）即可解全盘，起点只需 1 个单格区域。
   */
  function generateRegions(n, horses) {
    const total = n * n;
    // 两级难度策略：优先 1 个单格起点（150 次内找不到退让到 2 个，再不行不限）
    const tiers = [1, 2, Infinity];
    let lastSolvable = null;

    for (const maxSingles of tiers) {
      for (let k = 0; k < 200; k++) {
        const regions = generateRegionsV3Once(n, horses);
        if (!regions) continue;
        // 必须可解（构造保证，这里兜底校验）
        if (!solveByLogic(n, horses, regions)) continue;
        lastSolvable = regions;
        const counts = new Array(n).fill(0);
        regions.forEach(r => counts[r]++);
        const singles = counts.filter(c => c === 1).length;
        if (singles <= maxSingles) return regions;
      }
    }
    // 理论上到不了这里；兜底返回最近一个可解划分
    return lastSolvable;
  }

  function generateRegionsV3Once(n, horses) {
    const total = n * n;
    const ord = shuffle([...Array(n).keys()]);      // ord[k] = 第 k+1 步推理的马所在行
    const stepOf = new Array(n);                    // stepOf[row] = 1-based 推理步数
    ord.forEach((row, k) => { stepOf[row] = k + 1; });

    // e(x)：每个非马格最早被哪一步的小马排除
    const e = new Array(total).fill(Infinity);
    for (let x = 0; x < total; x++) {
      const xr = Math.floor(x / n), xc = x % n;
      for (let r = 0; r < n; r++) {
        const step = stepOf[r], hc = horses[r];
        if (xr === r || xc === hc || (Math.abs(xr - r) <= 1 && Math.abs(xc - hc) <= 1)) {
          if (step < e[x]) e[x] = step;
        }
      }
    }

    const regionOf = new Array(total).fill(-1);
    const regCells = Array.from({ length: n }, () => []);
    for (let r = 0; r < n; r++) {
      regionOf[r * n + horses[r]] = r;
      regCells[r].push(r * n + horses[r]);
    }

    // 轮流 BFS 生长：第 k+1 步的区域只能认领 e < k+1 的相邻未分配格
    let claims = true;
    while (claims) {
      claims = false;
      for (let k = 1; k < n; k++) {
        const row = ord[k];
        const myCells = regCells[row];
        const pool = [];
        for (const cell of myCells) {
          for (const nb of neighbors(cell, n)) {
            if (regionOf[nb] !== -1) continue;
            if (e[nb] < k + 1 && !pool.includes(nb)) pool.push(nb);
          }
        }
        if (pool.length > 0) {
          const pick = pool[Math.floor(Math.random() * pool.length)];
          regionOf[pick] = row;
          regCells[row].push(pick);
          claims = true;
        }
      }
    }

    // 剩余格子：分给相邻的可行区域（保持形状自然），否则随机可行区域
    for (let x = 0; x < total; x++) {
      if (regionOf[x] !== -1) continue;
      const adjRegions = [];
      for (const nb of neighbors(x, n)) {
        const reg = regionOf[nb];
        if (reg !== -1 && e[x] < stepOf[reg] && !adjRegions.includes(reg)) {
          adjRegions.push(reg);
        }
      }
      if (adjRegions.length > 0) {
        const pick = adjRegions[Math.floor(Math.random() * adjRegions.length)];
        regionOf[x] = pick;
        regCells[pick].push(x);
      } else {
        const valid = [];
        for (let r = 0; r < n; r++) if (e[x] < stepOf[r]) valid.push(r);
        if (valid.length === 0) return null;   // 防御（理论上不可能）
        const pick = valid[Math.floor(Math.random() * valid.length)];
        regionOf[x] = pick;
        regCells[pick].push(x);
      }
    }

    // 连通性校验（4 邻接 BFS），不连通则整体重来
    for (let r = 0; r < n; r++) {
      const set = new Set(regCells[r]);
      const seen = new Set([regCells[r][0]]);
      const queue = [regCells[r][0]];
      while (queue.length > 0) {
        const cur = queue.pop();
        for (const nb of neighbors(cur, n)) {
          if (set.has(nb) && !seen.has(nb)) { seen.add(nb); queue.push(nb); }
        }
      }
      if (seen.size !== set.size) return null;
    }
    return regionOf;
  }

  /**
   * 逻辑可解性求解器：模拟玩家纯推理（不靠蒙）解谜
   * 推理规则（与 findHint 引擎一致）：
   *   R1 某区域只剩 1 个未排除格 → 该格是小马
   *   R2 某行   只剩 1 个未排除格 → 该格是小马
   *   R3 某列   只剩 1 个未排除格 → 该格是小马
   *   R4 已确定的小马 → 排除同行/同列/3×3 邻域/同区域所有格
   * 从零知识开始迭代，能推出全部 n 匹小马则返回 true
   */
  function isLogicallySolvable(n, horses, regions) {
    return solveByLogic(n, horses, regions);
  }

  // ============================================================
  // 2.5 技巧关生成（10×10 高关卡）：构造式骨架 + 扰动变异
  // ------------------------------------------------------------
  // V3 构造式谜题只靠唯一候选即可通关，进阶技巧（区域占领/反证）
  // 永远没有出场机会。这里在可解骨架上随机挪动少量格子破坏纯连锁，
  // 每步保持"全规则可解"，并用轻量模拟器筛选出真正需要进阶技巧的谜题。
  // ============================================================

  // 某区域是否 4 连通
  function regionConnected(regionOf, n, reg) {
    let start = -1, size = 0;
    for (let i = 0; i < n * n; i++) {
      if (regionOf[i] !== reg) continue;
      size++;
      if (start === -1) start = i;
    }
    if (start === -1) return false;
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const cur = q.pop();
      for (const nb of neighbors(cur, n)) {
        if (regionOf[nb] === reg && !seen.has(nb)) { seen.add(nb); q.push(nb); }
      }
    }
    return seen.size === size;
  }

  // 尝试一次扰动：把非马格从 A 挪到相邻区域 B（保持两侧连通）
  function perturbRegionOnce(regionOf, n, horses) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = Math.floor(Math.random() * n * n);
      const xr = Math.floor(x / n);
      if (x === xr * n + horses[xr]) continue;      // 小马所在格不动
      const A = regionOf[x];
      const nbrRegions = [];
      for (const nb of neighbors(x, n)) {
        if (regionOf[nb] !== A && !nbrRegions.includes(regionOf[nb])) {
          nbrRegions.push(regionOf[nb]);
        }
      }
      if (nbrRegions.length === 0) continue;
      const B = nbrRegions[Math.floor(Math.random() * nbrRegions.length)];
      regionOf[x] = B;
      if (regionConnected(regionOf, n, A) && regionConnected(regionOf, n, B)) return true;
      regionOf[x] = A;                               // 破坏连通 → 回退
    }
    return false;
  }

  // 轻量模拟求解：按提示引擎的优先级推进，返回触发的进阶技巧次数
  function simulateAdvancedUsage(n, horses, regions) {
    const result = PuzzleLogic.solve({ size: n, regions }, {}, { maxTier: 3 });
    const usage = { T8: 0, T9: 0, T11: 0 };
    for (const step of result.trace) {
      if (['region-line-lock', 'line-region-lock'].includes(step.ruleId)) usage.T8++;
      if (['region-subset-lock', 'line-subset-lock'].includes(step.ruleId)) usage.T9++;
      if (step.ruleId === 'bounded-contradiction') usage.T11++;
    }
    return { solved: result.status === 'solved', usage };
  }

  // 技巧关区域生成：V3 骨架 + moves 次保持可解的扰动；
  // 筛选"模拟求解至少需要 minAdvanced 次进阶技巧"的划分。
  // tier 越高扰动越狠（moves 越多），单格起点也允许被扰动掉（0~1 个）。
  function generateTechniqueRegions(n, horses, minAdvanced, tier) {
    // 12×12 及以上：扰动次数略降、候选数提高，否则筛选太严导致生成慢、成功率低
    const MOVES = tier >= 3 ? (n >= 12 ? 10 : 18) : (n >= 12 ? 10 : (n >= 10 ? 12 : 6));
    const CANDIDATES = tier >= 3 ? (n >= 12 ? 12 : 8) : (n >= 12 ? 6 : 4);
    const maxSingles = tier >= 3 ? (n >= 12 ? 2 : 1) : 2;
    let fallback = null;
    for (let cand = 0; cand < CANDIDATES; cand++) {
      const regions = generateRegions(n, horses);
      if (!regions || !isLogicallySolvable(n, horses, regions)) continue;
      let applied = 0;
      for (let m = 0; m < MOVES * 3 && applied < MOVES; m++) {
        const saved = regions.slice();
        if (!perturbRegionOnce(regions, n, horses)) continue;
        if (isLogicallySolvable(n, horses, regions)) applied++;
        else regions.splice(0, regions.length, ...saved);
      }
      if (applied < MOVES) continue;
      const counts = new Array(n).fill(0);
      regions.forEach(r => counts[r]++);
      const singles = counts.filter(c => c === 1).length;
      if (singles > maxSingles) continue;
      fallback = regions;
      const sim = simulateAdvancedUsage(n, horses, regions);
      const adv = sim.usage.T8 + sim.usage.T9 + sim.usage.T11;
      if (sim.solved && adv >= minAdvanced) {
        return regions;                             // 命中：达到该档难度要求
      }
    }
    return fallback;                                // 全退化 → 返回最后一个可解划分
  }

  // ============================================================
  // 2.6 关卡变换：随机旋转 / 镜像
  // ------------------------------------------------------------
  // 对"小马位置 + 区域划分"整体做 0/90/180/270° 旋转与可选镜像。
  // 行/列唯一、区域单马、连通性、可解性全部保持不变，纯粹换一种呈现，
  // 让同一难度档的关卡看起来姿态各异。
  // ============================================================
  function transformPuzzle(n, horses, regions, rot, mirror) {
    const idxOf = (r, c) => r * n + c;
    const tf = (r, c) => {
      for (let k = 0; k < rot; k++) {
        const nr = c, nc = n - 1 - r;               // 顺时针 90°
        r = nr; c = nc;
      }
      if (mirror) c = n - 1 - c;
      return [r, c];
    };
    const newHorses = new Array(n);
    for (let r = 0; r < n; r++) {
      const [tr, tc] = tf(r, horses[r]);
      newHorses[tr] = tc;
    }
    const newRegions = new Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const [tr, tc] = tf(r, c);
        newRegions[idxOf(tr, tc)] = regions[idxOf(r, c)];
      }
    }
    return { horses: newHorses, regions: newRegions };
  }


  /**
   * 清晰版逻辑求解器
   */
  function solveByLogic(n, horses, regions) {
    return PuzzleLogic.solve({ size: n, regions }, {}, { maxTier: 3 }).status === 'solved';
  }

  // 工具：4 邻接
  function neighbors(idx, n) {
    const r = Math.floor(idx / n);
    const c = idx % n;
    const out = [];
    if (r > 0)      out.push((r - 1) * n + c);
    if (r < n - 1)  out.push((r + 1) * n + c);
    if (c > 0)      out.push(r * n + (c - 1));
    if (c < n - 1)  out.push(r * n + (c + 1));
    return out;
  }

  // 工具：洗牌（Fisher–Yates）
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ============================================================
  // 3. 游戏状态管理
  // ============================================================
  const Game = {
    level: 1,
    streak: 0,
    stars: MAX_MISSES,
    size: 5,
    horses: [],       // horses[r] = c
    regions: [],      // 长度 n*n 的数组，每个值为区域索引 0..n-1
    candidates: new Set(),  // 标记为候选的格子 idx
    revealed:   new Set(),  // 已翻开小马的格子 idx
    missed:     new Set(),  // 翻开错误变红的格子 idx
    showingAnswer: false,
    status: 'playing', // 'playing' | 'won' | 'lost'

    // ---- 启动 ----
    start() {
      this.bindUI();
      // 玩家档案：默认"玩家"沿用原始 key；其他名字各自独立保存（本机多人）。
      // 若环境注入了隔离存储（试玩包/测试），直接沿用，不走档案逻辑。
      const ambientKey = window.ProgressStore && window.ProgressStore.KEY;
      if (ambientKey && ambientKey !== 'pony-run-progress-v11') {
        this.profile = 'isolated';
        this.profileStore = window.ProgressStore;
      } else {
        this.profile = this.resolveProfile();
        this.profileStore = ProgressStore.create(this.profileKey(this.profile));
      }
      this.updatePlayerChip();
      // URL hash 跳关：index.html#l=8 直接进入第 8 关（用于测试/挑战指定关卡）
      const m = location.hash.match(/l=(\d+)/);
      const forcedLevel = Boolean(m);
      if (forcedLevel) this.level = Math.max(1, parseInt(m[1], 10) || 1);
      const stored = this.profileStore.load();
      const saved = forcedLevel ? { status: 'empty' } : stored;
      let backupResult = { status: 'ok' };
      let resume = null;
      if (saved.status === 'ok') {
        this.level = saved.data.level;
        const record = getCampaignRecord(this.level);
        if (canResume(saved.data, record)) resume = saved.data;
      }
      const needsBackup = stored.raw && (forcedLevel || stored.status !== 'ok' || !resume ||
        stored.data.campaignVersion !== window.GameCampaign.campaignVersion ||
        typeof stored.data.puzzleFingerprint !== 'string');
      if (needsBackup) backupResult = this.profileStore.backup(stored.raw);
      this.newRound(resume ? { resume } : { fresh: true });
      const notices = [];
      if (!forcedLevel && saved.status === 'invalid') notices.push(`${saved.reason}，已从当前关重新开始。`);
      else if (!forcedLevel && saved.status === 'ok' && !resume) notices.push('存档与当前题面不一致，已从当前关重新开始。');
      if (backupResult.status !== 'ok') notices.push(`${backupResult.reason}，本次进度不会保存。`);
      if (notices.length) {
        setTimeout(() => this.toast(notices.join(''), 3800), 600);
      }

      // #demo 模式：等棋盘渲染后自动演示（用于截图回归）；分步引导进行时不演示
      if (location.hash.includes('demo') && !(this.tut && this.tut.active)) {
        this.runDemo();
      }

      // #answer 模式：开局就显示全部小马（用于截图回归 "显示解" 修复）
      if (location.hash.includes('answer')) {
        setTimeout(() => {
          this.showingAnswer = true;
          this.render();
        }, 100);
      }

      // #hint 模式：自动标记候选后触发查看提示（用于截图回归 "提示" 修复）
      if (location.hash.includes('hint')) {
        setTimeout(() => {
          const horseSet = new Set(this.horses.map((c, r) => r * this.size + c));
          // 标记几个候选：故意在某行/某列/某区域都留一个未排除的格子，制造"唯一候选"场景
          // 简单做法：标记大部分格子（除了小马），保留几行/列的多数格子让 findHint 触发
          for (let i = 0; i < this.size * this.size; i++) {
            if (horseSet.has(i)) continue;
            if (Math.random() < 0.5) this.candidates.add(i);
          }
          this.render();
          setTimeout(() => this.showHint(), 200);
        }, 100);
      }
      // #sticky 模式：模拟"长按→松手→悬停滑过"的连续标记流程（回归测试用）
      if (location.hash.includes('stickytest')) {
        setTimeout(() => {
          const board = this.boardEl;
          const center = (idx) => {
            const r = board.children[idx].getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          };
          const fire = (type, p) => board.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, button: 0,
            clientX: p.x, clientY: p.y
          }));
          const n = this.size;
          const path = [n + 0, n + 1, n + 2, n + 1]; // 第2行：0列→1列→2列→1列
          const p0 = center(path[0]);
          fire('pointerdown', p0);                    // 按下不动
          setTimeout(() => {
            fire('pointerup', p0);                    // 400ms 后松手 → 应进入连续标记模式
            setTimeout(() => {
              for (const idx of path.slice(1)) fire('pointermove', center(idx)); // 悬停滑过
              this.render();
            }, 120);
          }, 400);
        }, 300);
      }

      // #clicktest 模式：真实事件序列回归 单击切换 / 双击翻开 / 双击翻错
      if (location.hash.includes('clicktest')) {
        setTimeout(() => {
          const board = this.boardEl;
          const center = (idx) => {
            const r = board.children[idx].getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          };
          const fire = (type, p) => board.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, button: 0,
            clientX: p.x, clientY: p.y
          }));
          const click = (idx) => { const p = center(idx); fire('pointerdown', p); fire('pointerup', p); };
          const n = this.size;
          const horseA = 0 * n + this.horses[0];          // 第1行的小马
          const horseB = 1 * n + this.horses[1];          // 第2行的小马
          const notHorse = [];
          for (let i = 0; i < n * n && notHorse.length < 3; i++) {
            const isHorse = this.horses.some((c, r) => r * n + c === i);
            if (!isHorse) notHorse.push(i);
          }
          const [A, , C] = notHorse;                       // A: 单击两次应互相抵消；C: 双击翻错
          // 1) 单击 A → 标记
          click(A);
          setTimeout(() => click(A), 900);                 // 2) 再单击 A → 取消标记
          setTimeout(() => { click(horseA); click(horseA); }, 1500); // 3) 双击小马 → 翻开
          setTimeout(() => { click(C); click(C); }, 2300); // 4) 双击非马 → 翻错扣星
        }, 300);
      }
    },

    // ---- 自动化演示：标记候选、翻开小马、翻开错误 ----
    runDemo() {
      setTimeout(() => {
        // 1) 标记 3 个候选（不包括小马位置）
        const horseSet = new Set(this.horses.map((c, r) => r * this.size + c));
        const sample = [];
        for (let i = 0; i < this.size * this.size && sample.length < 3; i++) {
          if (!horseSet.has(i)) sample.push(i);
        }
        sample.forEach(idx => this.candidates.add(idx));

        // 2) 翻开第一匹小马（成功）
        const firstHorseIdx = this.horses[0] * this.size + this.horses[0]; // 注意这里是 c 不是 r
        // 修正：horses[r]=c，idx = r*size + c
        const realIdx = 0 * this.size + this.horses[0];
        this.revealed.add(realIdx);

        // 3) 翻开一个错误位置（扣星 + 变红）
        for (let i = 0; i < this.size * this.size; i++) {
          if (!horseSet.has(i) && !sample.includes(i)) {
            this.missed.add(i);
            this.stars = 1;
            break;
          }
        }

        this.render();
      }, 200);
    },

    // ---- 绑定 UI 事件 ----
    bindUI() {
      this.btnClear = document.getElementById('btn-clear');
      this.btnHint  = document.getElementById('btn-hint');
      this.btnAuto  = document.getElementById('btn-auto');
      this.modal    = document.getElementById('modal');
      this.modalPrimary   = document.getElementById('modal-primary');
      this.modalSecondary = document.getElementById('modal-secondary');
      this.modalEmoji = document.getElementById('modal-emoji');
      this.modalTitle = document.getElementById('modal-title');
      this.modalDesc  = document.getElementById('modal-desc');

      this.btnClear.addEventListener('click', () => this.clearMarks());
      this.btnHint.addEventListener('click',  () => this.showHint());
      this.btnAuto.addEventListener('click', () => this.toast(
        '玩法说明\n· 单击格子：打 / 取消候选标记\n· 双击格子：翻开（是小马得分，翻错扣星）\n· 按住滑动：连续批量打标，再点一下结束',
        6000
      ));

      // 底纹开关：状态持久化，关闭时棋盘只显示纯色块
      this.btnPattern = document.getElementById('btn-pattern');
      this.patternLabel = document.getElementById('pattern-label');
      const savedPattern = localStorage.getItem('skymate-patterns');
      this.applyPatternState(savedPattern !== 'off');
      this.btnPattern.addEventListener('click', () => {
        const next = document.body.classList.contains('patterns-off'); // 当前关 → 点击后开
        this.applyPatternState(next);
        localStorage.setItem('skymate-patterns', next ? 'on' : 'off');
      });

      // 玩家档案：切换/创建/关闭
      const playerChip = document.getElementById('player-chip');
      if (playerChip) playerChip.addEventListener('click', () => this.openProfileModal());
      const profileClose = document.getElementById('profile-close');
      if (profileClose) profileClose.addEventListener('click', () => this.closeProfileModal());
      const profileModal = document.getElementById('profile-modal');
      if (profileModal) profileModal.addEventListener('click', e => {
        if (e.target === profileModal) this.closeProfileModal();
      });
      const profileAdd = document.getElementById('profile-add');
      if (profileAdd) profileAdd.addEventListener('click', () => {
        const input = document.getElementById('profile-input');
        this.switchProfile(input ? input.value : '');
      });
      const profileInput = document.getElementById('profile-input');
      if (profileInput) profileInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.switchProfile(profileInput.value);
      });

      this.modalPrimary.addEventListener('click',   () => this.onModalPrimary());
      this.modalSecondary.addEventListener('click', () => this.onModalSecondary());
    },

    // ---- 底纹开关状态 ----
    applyPatternState(on) {
      document.body.classList.toggle('patterns-off', !on);
      if (this.patternLabel) this.patternLabel.textContent = on ? '底纹 开' : '底纹 关';
      if (this.btnPattern) this.btnPattern.classList.toggle('off', !on);
    },

    // ---- 新一轮 ----
    newRound(options = {}) {
      this.dismissHint();
      this.stars = MAX_MISSES;
      this.candidates.clear();
      this.revealed.clear();
      this.missed.clear();
      this.showingAnswer = false;
      this.status = 'playing';
      const record = getCampaignRecord(this.level);
      if (!record) {
        this.status = 'error';
        const count = (window.GameCampaign && window.GameCampaign.levels || []).length;
        this.toast(`第 ${this.level} 关资源尚未准备好，目前可测试 ${count} 关。`, 4000);
        return;
      }
      this.size = record.puzzle.size;
      this.regions = record.puzzle.regions.slice();
      this.horses = record.puzzle.solution.slice();
      // 可选 colorMap：区域 id → COLORS 索引，用于复刻特定配色的参考关卡
      this.colorMap = Array.isArray(record.puzzle.colorMap) ? record.puzzle.colorMap : null;
      this.puzzleId = record.puzzleId;
      this.campaignVersion = window.GameCampaign.campaignVersion;
      this.puzzleFingerprint = puzzleFingerprint(record.puzzle);
      const resumed = options.resume && canResume(options.resume, record);
      if (resumed) {
        this.stars = Number.isInteger(options.resume.stars) ? Math.max(0, Math.min(MAX_MISSES, options.resume.stars)) : MAX_MISSES;
        this.streak = Number.isInteger(options.resume.streak) ? Math.max(0, options.resume.streak) : 0;
        this.revealed = new Set(options.resume.revealed);
        this.missed = new Set(options.resume.missed);
        this.candidates = new Set(options.resume.candidates);
        this.status = this.revealed.size === this.size ? 'won' : this.stars <= 0 ? 'lost' : 'playing';
        if (this.status === 'lost') {
          this.streak = 0;
          this.showingAnswer = true;
        }
      }

      // 重置交互状态（清掉可能残留的连续标记模式/拖动状态）
      if (this._drag) {
        if (this._drag.stickyTimer) clearTimeout(this._drag.stickyTimer);
        Object.assign(this._drag, {
          downIdx: null, dragMode: false, dragAction: null, lastDragIdx: null,
          stickyTimer: null, stickyActive: false, stickyAction: null, stickyLastIdx: null
        });
      }

      this.render();
      this.hideModal();
      if (resumed && this.status !== 'playing') this.showModal(this.status === 'won' ? 'win' : 'lose');

      // 第一关分步新手引导（仅全新开局、非存档恢复时启动）
      this.maybeStartTutorial(!options.resume);

      // 开局引导：根据固定题目的真实画像给出简短提示
      // #hint 测试模式下跳过，避免覆盖推理提示的 toast；分步引导进行时不重复弹
      if (!location.hash.includes('hint') && !(this.tut && this.tut.active)) {
        const counts = new Array(this.size).fill(0);
        this.regions.forEach(r => counts[r]++);
        const singles = counts.filter(c => c === 1).length;
        const tip = singles === 0
          ? '💡 这关没有送出的单格答案，先观察区域和行列之间的限制'
          : singles === 1
            ? '💡 有 1 种颜色区域只有一格——那里必定藏着小马，从它开始推理'
            : `💡 有 ${singles} 种颜色区域只有一格——那里必定藏着小马，从它们开始推理`;
        setTimeout(() => { this.toast(tip, 4200); }, 500);
      }
      // 第 2 关轻量划动手势提示（一次性）
      if (this.level === 2 && this.status === 'playing' && !this.wasSwipeTipShown()) {
        setTimeout(() => { this.toast('小马四周不能有小马：按住并划动格子，可以批量排除', 4200); }, 900);
        try { localStorage.setItem('pony-run-swipe-tip-v1', 'shown'); } catch (e) { /* 忽略 */ }
      }
      this.saveProgress();
    },

    wasSwipeTipShown() {
      try { return localStorage.getItem('pony-run-swipe-tip-v1') === 'shown'; } catch (e) { return true; }
    },

    // ---- 分步新手引导 ----
    maybeStartTutorial(isFresh) {
      if (!isFresh) return; // 从存档恢复时不重启引导
      if (this.puzzleId !== TUTORIAL_ID || this.status !== 'playing') return;
      if (typeof document === 'undefined' || !document.getElementById) return; // Node 测试环境
      let done = true;
      try { done = localStorage.getItem(TUTORIAL_KEY) === 'done'; } catch (e) { /* 存储不可用视为已完成 */ }
      if (done) return;
      this.tut = { active: true, step: 0 };
      this.buildTutorialLayer();
      this.tutorialShowStep();
    },
    // 引导 UI 全部用文档流/格子内相对定位：气泡插在棋盘正前方（天然在棋盘上方）、
    // 副提示在棋盘后方、光圈/手指挂进目标格子内部。
    // 不做任何 getBoundingClientRect 坐标计算——预览面板缩放/滚动/iframe 下都不会偏移。
    buildTutorialLayer() {
      this.tutorialCleanupDom();
      const board = document.getElementById('board');
      if (!board) return;
      const top = document.createElement('div');
      top.id = 'tut-top';
      top.innerHTML = '<div class="tut-bubble"><span class="tut-text"></span><button class="tut-ok"></button></div>';
      const bottom = document.createElement('div');
      bottom.id = 'tut-bottom';
      bottom.innerHTML = '<div class="tut-sub"></div>';
      board.before(top);
      board.after(bottom);
      top.querySelector('.tut-ok').addEventListener('click', () => this.tutorialNext());
      this.tutorialTop = top;
      this.tutorialBottom = bottom;
      this.tutorialRing = document.createElement('div');
      this.tutorialRing.className = 'tut-ring';
      this.tutorialHand = document.createElement('div');
      this.tutorialHand.className = 'tut-hand';
      this.tutorialHand.textContent = '👆';
    },
    tutorialCleanupDom() {
      for (const sel of ['#tut-top', '#tut-bottom', '#tut-layer']) {
        const el = document.querySelector(sel);
        if (el) el.remove();
      }
      if (this.tutorialRing) { this.tutorialRing.remove(); this.tutorialRing = null; }
      if (this.tutorialHand) { this.tutorialHand.remove(); this.tutorialHand = null; }
      document.querySelectorAll('.tut-glow-cell').forEach(el => el.classList.remove('tut-glow-cell'));
      const btn = document.getElementById('btn-hint');
      if (btn) btn.classList.remove('tut-pulse');
    },
    tutorialShowStep() {
      const top = this.tutorialTop, bottom = this.tutorialBottom;
      if (!top || !this.tut.active) return;
      const step = TUTORIAL_PLAN[this.tut.step];
      if (!step) { this.finishTutorial(); return; }
      const bubble = top.querySelector('.tut-bubble');
      top.querySelector('.tut-text').innerHTML = step.html;
      bubble.style.display = 'block';
      const ok = top.querySelector('.tut-ok');
      ok.style.display = step.button ? 'inline-block' : 'none';
      if (step.button) ok.textContent = step.button;
      const sub = bottom.querySelector('.tut-sub');
      sub.style.display = step.sub ? 'block' : 'none';
      if (step.sub) sub.innerHTML = step.sub;
      if (step.hintBtn) {
        const btn = document.getElementById('btn-hint');
        if (btn) btn.classList.add('tut-pulse');
      }
      this.tutorialDecorate();
    },
    // render() 每次重绘棋盘后会调用：重挂格子高亮，把光圈/手指挂进目标格子
    tutorialDecorate() {
      if (!this.tut || !this.tut.active) return;
      const step = TUTORIAL_PLAN[this.tut.step];
      if (!step) return;
      const boardEl = document.getElementById('board');
      if (!boardEl) return;
      document.querySelectorAll('.tut-glow-cell').forEach(el => el.classList.remove('tut-glow-cell'));
      if (step.highlight) {
        for (const idx of step.highlight) {
          const cell = boardEl.children[idx];
          if (cell) cell.classList.add('tut-glow-cell');
        }
      }
      if (this.tutorialRing) this.tutorialRing.remove();
      if (this.tutorialHand) this.tutorialHand.remove();
      if (step.hand != null && boardEl.children[step.hand] && this.tutorialRing) {
        const cell = boardEl.children[step.hand];
        cell.appendChild(this.tutorialRing);
        cell.appendChild(this.tutorialHand);
      }
    },
    tutorialTap(idx, isDouble) {
      const step = TUTORIAL_PLAN[this.tut.step];
      if (!step || !step.allow) return;
      if (step.allow.double && isDouble && step.allow.double.includes(idx)) {
        this.revealCell(idx);
        if (this.status !== 'playing') { this.finishTutorial(); return; }
        this.tutorialNext();
      } else if (step.allow.singleExclude && !isDouble && step.allow.singleExclude.includes(idx)) {
        // 引导期只加不减：避免单击把（放马时自动排除产生的）已有标记误取消
        if (!this.candidates.has(idx)) { this.candidates.add(idx); this.render(); }
        if (step.allow.singleExclude.every(i => this.candidates.has(i))) this.tutorialNext();
      }
    },
    tutorialNext() {
      if (!this.tut || !this.tut.active) return;
      this.tut.step++;
      const btn = document.getElementById('btn-hint');
      if (btn) btn.classList.remove('tut-pulse');
      if (this.tut.step >= TUTORIAL_PLAN.length) { this.finishTutorial(); return; }
      this.tutorialShowStep();
    },
    finishTutorial() {
      if (!this.tut || !this.tut.active) return;
      this.tut = { active: false, step: -1 };
      try { localStorage.setItem(TUTORIAL_KEY, 'done'); } catch (e) { /* 忽略 */ }
      this.tutorialCleanupDom();
      this.tutorialTop = null;
      this.tutorialBottom = null;
    },

    // ---- 校验谜题合法性 ----
    isValidPuzzle() {
      // 单格推理起点：普通/技巧关至少 1 个（保证有突破口）；
      // 大师关（≥20 级）允许 0 个（开局无突破口才是挑战）；至多 2 个（不送分）
      const counts = new Array(this.size).fill(0);
      this.regions.forEach(r => counts[r]++);
      const singles = counts.filter(c => c === 1).length;
      const minSingles = this.level >= 20 ? 0 : 1;
      return singles >= minSingles && singles <= 2;
    },

    saveProgress() {
      if (this.status === 'error' || !this.puzzleId || !window.ProgressStore) return;
      const store = this.profileStore || window.ProgressStore; // 未走 start() 的试玩环境用注入的存储
      store.save({ level: this.level, puzzleId: this.puzzleId, campaignVersion: this.campaignVersion,
        puzzleFingerprint: this.puzzleFingerprint, size: this.size, stars: this.stars, streak: this.streak, status: this.status,
        revealed: [...this.revealed], missed: [...this.missed], candidates: [...this.candidates] });
    },

    // ---- 本机多人档案 ----
    // 默认档案"玩家"直接沿用原始 key（旧进度零迁移自动延续）；
    // 其他玩家用 pony-run-progress-v11:<名字> 各自独立。
    profileKey(name) {
      return name === '玩家' ? 'pony-run-progress-v11' : 'pony-run-progress-v11:' + String(name).replace(/:/g, '_');
    },
    resolveProfile() {
      let name = null;
      try { name = localStorage.getItem('pony-run-profile'); } catch (e) { /* 存储不可用 */ }
      return name || '玩家';
    },
    updatePlayerChip() {
      if (typeof document === 'undefined') return; // Node 测试环境无 DOM
      const el = document.getElementById('player-name');
      if (el) el.textContent = this.profile || '玩家';
    },
    openProfileModal() {
      const list = document.getElementById('profile-list');
      if (!list) return;
      list.innerHTML = '';
      const names = ProgressStore.listProfiles();
      if (!names.includes(this.profile)) names.push(this.profile);
      for (const name of names) {
        const btn = document.createElement('button');
        btn.className = 'profile-item' + (name === this.profile ? ' current' : '');
        let meta = '';
        try {
          const raw = localStorage.getItem(this.profileKey(name));
          if (raw) { const d = JSON.parse(raw); if (Number.isInteger(d.level)) meta = `第 ${d.level} 关`; }
        } catch (e) { /* 忽略坏档案 */ }
        btn.innerHTML = `<span></span><span class="profile-meta">${meta}</span>`;
        btn.insertBefore(document.createTextNode(name), btn.firstChild);
        btn.addEventListener('click', () => this.switchProfile(name));
        list.appendChild(btn);
      }
      document.getElementById('profile-modal').classList.add('show');
      const input = document.getElementById('profile-input');
      if (input) { input.value = ''; }
    },
    closeProfileModal() {
      const el = document.getElementById('profile-modal');
      if (el) el.classList.remove('show');
    },
    switchProfile(name) {
      const clean = String(name || '').trim().slice(0, 12);
      if (!clean) { this.toast('名字不能为空'); return; }
      if (clean === this.profile) { this.closeProfileModal(); return; }
      try { localStorage.setItem('pony-run-profile', clean); } catch (e) { /* 忽略 */ }
      location.reload(); // 整页重载：以新档案读档，状态最干净
    },

    // ---- 格子点击 / 双击 ----
    onCellTap(idx, isDouble) {
      if (this.status !== 'playing') return;
      if (this.tut && this.tut.active) return this.tutorialTap(idx, isDouble); // 引导期只允许引导动作
      if (this.showingAnswer) this.toggleAnswer(); // 先关答案预览

      if (this.missed.has(idx)) return; // 翻开错误的格子不能改

      if (isDouble) {
        // 双击 = 翻开
        this.revealCell(idx);
      } else {
        // 单击 = 切换候选标记
        if (this.candidates.has(idx)) this.candidates.delete(idx);
        else this.candidates.add(idx);
        this.render();
      }
    },

    revealCell(idx) {
      const r = Math.floor(idx / this.size);
      const c = idx % this.size;
      const isHorse = (this.horses[r] === c);

      if (isHorse) {
        this.revealed.add(idx);
        this.candidates.delete(idx);
        this.render();

        if (this.revealed.size === this.size) {
          this.status = 'won';
          this.streak++;
          if (this.tut && this.tut.active) this.finishTutorial(); // 引导中通关：收尾并写完成标记
          setTimeout(() => this.showModal('win'), 400);
        }
      } else {
        this.missed.add(idx);
        this.candidates.delete(idx);
        this.stars--;
        this.render();

        // 抖动只在翻错的这一刻播放一次（WAAPI 直接驱动元素，
        // 之后的重渲染不会重播——否则点其他格子时红格 X 会一直晃）
        const el = this.boardEl && this.boardEl.children[idx];
        if (el) {
          el.animate(
            [
              { transform: 'translateX(0)' },
              { transform: 'translateX(-4px)' },
              { transform: 'translateX(4px)' },
              { transform: 'translateX(-3px)' },
              { transform: 'translateX(3px)' },
              { transform: 'translateX(0)' }
            ],
            { duration: 400, easing: 'ease' }
          );
        }

        if (this.stars <= 0) {
          this.status = 'lost';
          this.streak = 0;
          this.showingAnswer = true; // 失败后展示答案位置
          this.render();
          setTimeout(() => this.showModal('lose'), 700);
        }
      }
    },

    // ---- 清除所有候选标记 ----
    clearMarks() {
      if (this.status !== 'playing') return;
      this.candidates.clear();
      this.render();
      this.toast('已清除所有候选标记');
    },

    // 完整文字解释；再次点击收起，棋盘变化后失效，不自动标记或落马。
    showHint() {
      if (this.status !== 'playing') return;
      if (this.tut && this.tut.active) {
        // 引导最后一步：点提示即视为学会，收尾引导
        const step = TUTORIAL_PLAN[this.tut.step];
        if (step && step.hintBtn) this.finishTutorial();
      }
      if (this._hintOpen) { this.dismissHint(); return; }
      const result = this.findHint();

      this.toast(result.message, result.proof ? 0 : 5000);
      this._hintOpen = Boolean(result.proof);
      if (this.btnHint) this.btnHint.setAttribute('aria-expanded', String(this._hintOpen));

      // 高亮相关格子（支持多个）
      const idxs = result.idxs || [result.idx];
      for (const i of idxs) {
        const cellEl = this.boardEl && this.boardEl.children[i];
        if (cellEl) {
          cellEl.animate(
            [
              { boxShadow: '0 0 0 0 rgba(255,122,69,0.7)' },
              { boxShadow: '0 0 0 8px rgba(255,122,69,0)' }
            ],
            { duration: 600, iterations: 2 }
          );
        }
      }
    },

    // 推理引擎主体
    findHint() {
      const puzzle = { size: this.size, regions: this.regions };
      if (this.colorMap) puzzle.colorMap = this.colorMap;
      const result = PuzzleLogic.hint(puzzle, {
        placed: this.revealed, excluded: this.missed
      }, this.candidates);
      return HintPresenter.toLegacyHint(result, puzzle);
    },

    // 工具：该区域是否已有已翻开的小马
    regionHasRevealedHorse(region) {
      const n = this.size;
      for (let r = 0; r < n; r++) {
        const hi = r * n + this.horses[r];
        if (this.revealed.has(hi) && this.regions[hi] === region) return true;
      }
      return false;
    },

    // ---- 显示/隐藏完整答案 ----
    toggleAnswer() {
      this.showingAnswer = !this.showingAnswer;
      this.render();
      this.toast(this.showingAnswer ? '已显示全部小马' : '已隐藏答案');
    },

    // ---- 模态框 ----
    showModal(kind) {
      if (kind === 'win') {
        const nextRecord = getCampaignRecord(this.level + 1);
        this.modalEmoji.textContent = '🎉';
        this.modalTitle.textContent = '胜利！';
        this.modalDesc.textContent = nextRecord
          ? `进入第 ${nextRecord.level} 关 · 棋盘变为 ${nextRecord.puzzle.size}×${nextRecord.puzzle.size}`
          : `已完成全部 ${(window.GameCampaign && window.GameCampaign.levels || []).length} 关`;
        this.modalPrimary.textContent   = nextRecord ? '下一关' : '完成';
        this.modalSecondary.textContent = '重玩本关';
      } else {
        this.modalEmoji.textContent = '💔';
        this.modalTitle.textContent = '失败';
        this.modalDesc.textContent  = '小马藏得太深，再试一次吧';
        this.modalPrimary.textContent   = '重玩本关';
        this.modalSecondary.textContent = '返回第 1 关';
      }
      this.modal.classList.add('show');
    },

    hideModal() {
      this.modal.classList.remove('show');
    },

    onModalPrimary() {
      if (this.status === 'won') {
        const nextRecord = getCampaignRecord(this.level + 1);
        if (nextRecord) {
          this.level = nextRecord.level;
          this.newRound();
        } else {
          this.hideModal();
        }
      } else {
        // 重玩本关
        this.newRound();
      }
    },

    onModalSecondary() {
      if (this.status === 'won') {
        // 重玩本关
        this.newRound();
      } else {
        // 返回第 1 关
        this.level = 1;
        this.streak = 0;
        this.newRound();
      }
    },

    // ---- Toast ----
    dismissHint() {
      if (!this._hintOpen) return;
      this._hintOpen = false;
      clearTimeout(this._toastTimer);
      const el = document.getElementById('hint-toast');
      el.classList.remove('show', 'hint-detail');
      if (this.btnHint) this.btnHint.setAttribute('aria-expanded', 'false');
    },

    toast(msg, duration = 1500) {
      this.dismissHint();
      const el = document.getElementById('hint-toast');
      el.textContent = duration === 0 ? `${msg}\n\n读完可再次点击“查看提示”收起。` : msg;
      el.classList.toggle('hint-detail', duration === 0);
      el.scrollTop = 0;
      el.classList.add('show');
      clearTimeout(this._toastTimer);
      if (duration > 0) this._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
    },

    // ---- 渲染 ----
    render() {
      this.dismissHint();
      // 顶栏
      document.getElementById('level-num').textContent = this.level;
      document.getElementById('streak-num').textContent = this.streak;

      // 星
      const starsEl = document.getElementById('stars');
      const lostStars = MAX_MISSES - this.stars;
      starsEl.innerHTML = '';
      for (let i = 0; i < MAX_MISSES; i++) {
        const s = document.createElement('span');
        s.className = 'star' + (i < lostStars ? ' lost' : '');
        s.textContent = '★';
        starsEl.appendChild(s);
      }

      // 信息条
      document.getElementById('remaining-horses').textContent = this.size - this.revealed.size;
      document.getElementById('revealed-count').textContent = this.revealed.size;

      // 棋盘
      this.renderBoard();
      this.tutorialDecorate(); // 引导期：重挂高亮与气泡位置
      this.saveProgress();
    },

    renderBoard() {
      const boardEl = document.getElementById('board');
      this.boardEl = boardEl;
      boardEl.style.gridTemplateColumns = `repeat(${this.size}, 1fr)`;
      boardEl.innerHTML = '';

      const frag = document.createDocumentFragment();
      const cellFont = this.size <= 5 ? 28 : this.size <= 6 ? 24 : this.size <= 7 ? 21 : this.size <= 8 ? 18 : 16;

      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          const idx = r * this.size + c;
          const cell = document.createElement('div');
          cell.className = 'cell';
          const regionIdx = this.regions[idx];
          const isHorse = (this.horses[r] === c);

          // 底纹样式类：每种颜色一个专属纹理，同色系也能靠纹理区分（色盲友好）
          // colorMap 存在时按映射取色（复刻参考关卡配色）
          const colorIdx = (this.colorMap && Number.isInteger(this.colorMap[regionIdx]))
            ? this.colorMap[regionIdx] : regionIdx;
          cell.classList.add('pat-' + (colorIdx % COLORS.length));
          cell.style.fontSize = cellFont + 'px';

          if (this.revealed.has(idx)) {
            cell.classList.add('revealed');
          } else if (this.missed.has(idx)) {
            cell.classList.add('missed');
          } else if (this.candidates.has(idx)) {
            cell.classList.add('candidate');
          }

          // 答案模式：只在"未揭开的小马位置"显示小马（已揭开的本来就有 🐴）
          if (this.showingAnswer && isHorse && !this.revealed.has(idx)) {
            cell.classList.add('answer');
          }

          cell.dataset.idx = idx;
          cell.dataset.row = r;
          cell.dataset.col = c;

          frag.appendChild(cell);
        }
      }
      boardEl.appendChild(frag);

      // 绑定点击/双击（用事件委托 + timer 区分单击双击）
      this.attachCellEvents(boardEl);
    },

    attachCellEvents(boardEl) {
      // 重新绑定前清理
      if (this._clickTimer) {
        clearTimeout(this._clickTimer);
        this._clickTimer = null;
      }
      // 移除旧监听（renderBoard 会重建 DOM 并重新绑定）
      if (this._peHandlers) {
        for (const [type, fn] of Object.entries(this._peHandlers)) {
          boardEl.removeEventListener(type, fn);
        }
      }

      // ==========================================================
      // Pointer Events 交互：
      //   · 单击                           → 切换候选标记
      //   · 双击                           → 翻开
      //   · 按住拖动（滑过多个格子）       → 连续标记 / 连续取消
      //   · 按住不动 350ms（触摸板友好）   → 进入"连续标记模式"：
      //     松手后移动鼠标/手指即可连续标记，再点一下结束
      // ==========================================================
      const DRAG_THRESHOLD = 8;   // px，超过判定为拖动
      const DOUBLE_MS      = 320; // 双击时间窗口
      const STICKY_DELAY   = 350; // 按住不动 → 连续标记模式

      // 交互状态存实例级：render() 会重建棋盘并重新绑定事件，
      // 局部闭包变量会在重绑后丢失进行中的拖动/长按状态
      if (!this._drag) {
        this._drag = {
          downIdx: null, startX: 0, startY: 0,
          dragMode: false, dragAction: null, lastDragIdx: null,
          stickyTimer: null, stickyActive: false,
          stickyAction: null, stickyLastIdx: null
        };
      }
      const S = this._drag;

      const cellFromPoint = (x, y) => {
        const el = document.elementFromPoint(x, y);
        const cell = el && el.closest ? el.closest('.cell') : null;
        return cell ? +cell.dataset.idx : null;
      };

      const endSticky = () => {
        S.stickyActive = false;
        S.stickyAction = null;
        S.stickyLastIdx = null;
        boardEl.classList.remove('sticky-marking');
      };

      const enterSticky = () => {
        S.stickyTimer = null;
        if (S.downIdx == null || S.dragMode || this.status !== 'playing') return;
        S.stickyActive = true;
        // 起始格状态决定本次是"标记"还是"取消"
        S.stickyAction = this.candidates.has(S.downIdx) ? 'unmark' : 'mark';
        this.applyDragAction(S.downIdx, S.stickyAction);
        S.stickyLastIdx = S.downIdx;
        boardEl.classList.add('sticky-marking');
        // 防止松手时又触发一次单击切换
        if (this._clickTimer) { clearTimeout(this._clickTimer); this._clickTimer = null; }
        this._lastClickedIdx = null;
        this._lastClickTime = 0;
        this.toast('连续标记中：移动鼠标/手指选择，再点一下结束', 1800);
      };

      const clearStickyTimer = () => {
        if (S.stickyTimer) { clearTimeout(S.stickyTimer); S.stickyTimer = null; }
      };

      const onDown = (e) => {
        if (this.status !== 'playing') return;
        if (e.button !== undefined && e.button !== 0) return; // 仅左键/触摸
        // 连续标记模式下，下一次按下 = 结束模式（本次点击不产生其他效果）
        if (S.stickyActive) { endSticky(); return; }
        S.dragMode = false;
        S.dragAction = null;
        S.lastDragIdx = null;
        S.startX = e.clientX;
        S.startY = e.clientY;
        S.downIdx = cellFromPoint(e.clientX, e.clientY);
        if (S.downIdx == null) return;
        // 捕获指针：鼠标拖出棋盘也能继续接收 move/up
        try { boardEl.setPointerCapture(e.pointerId); } catch (_) {}
        // 触摸板友好：按住不动 STICKY_DELAY 后自动进入连续标记模式
        clearStickyTimer();
        S.stickyTimer = setTimeout(enterSticky, STICKY_DELAY);
      };

      const onMove = (e) => {
        // 连续标记模式：不需要按住，悬停滑过即标记
        if (S.stickyActive) {
          const idx = cellFromPoint(e.clientX, e.clientY);
          if (idx != null && idx !== S.stickyLastIdx) {
            this.applyDragAction(idx, S.stickyAction);
            S.stickyLastIdx = idx;
          }
          return;
        }
        if (S.downIdx == null || this.status !== 'playing') return;
        const idx = cellFromPoint(e.clientX, e.clientY);
        if (idx == null) return;

        if (!S.dragMode) {
          const dist = Math.hypot(e.clientX - S.startX, e.clientY - S.startY);
          if (dist > DRAG_THRESHOLD && idx !== S.downIdx) {
            // 进入拖动模式：起始格状态决定本次拖动是"标记"还是"取消"
            S.dragMode = true;
            clearStickyTimer();
            if (this._clickTimer) { clearTimeout(this._clickTimer); this._clickTimer = null; }
            this._lastClickedIdx = null;
            this._lastClickTime = 0;
            S.dragAction = this.candidates.has(S.downIdx) ? 'unmark' : 'mark';
            this.applyDragAction(S.downIdx, S.dragAction);
            S.lastDragIdx = S.downIdx;
          }
        } else if (idx !== S.lastDragIdx) {
          this.applyDragAction(idx, S.dragAction);
          S.lastDragIdx = idx;
        }
      };

      const onUp = (e) => {
        clearStickyTimer();
        // 连续标记模式保持激活，等下一次按下结束
        if (S.stickyActive) {
          S.downIdx = null;
          S.dragMode = false;
          return;
        }
        if (S.downIdx == null) return;
        const idx = S.downIdx;
        const wasDrag = S.dragMode;
        S.downIdx = null;
        S.dragMode = false;

        if (wasDrag) {
          this._lastClickedIdx = null; // 拖动结束，不触发单击/双击
          this._lastClickTime = 0;
          return;
        }

        // 非拖动：区分单击 / 双击
        const now = Date.now();
        if (this._lastClickedIdx === idx && this._lastClickTime &&
            (now - this._lastClickTime) < DOUBLE_MS) {
          if (this._clickTimer) { clearTimeout(this._clickTimer); this._clickTimer = null; }
          this._lastClickedIdx = null;
          this._lastClickTime = 0;
          this.onCellTap(idx, /*double*/ true);
        } else {
          if (this._clickTimer) clearTimeout(this._clickTimer);
          this._lastClickedIdx = idx;
          this._lastClickTime = now;
          this._clickTimer = setTimeout(() => {
            this.onCellTap(idx, /*double*/ false);
            this._lastClickedIdx = null;
          }, 220);
        }
      };

      const onCancel = () => {
        clearStickyTimer();
        S.downIdx = null;
        S.dragMode = false;
      };

      this._peHandlers = {
        pointerdown: onDown,
        pointermove: onMove,
        pointerup: onUp,
        pointercancel: onCancel
      };
      for (const [type, fn] of Object.entries(this._peHandlers)) {
        boardEl.addEventListener(type, fn);
      }
    },

    // 拖动经过格子时的统一动作（已翻开/翻错的格子跳过）
    applyDragAction(idx, action) {
      if (this.status !== 'playing') return;
      if (this.tut && this.tut.active) return; // 引导期禁用拖动批量标记
      if (this.revealed.has(idx) || this.missed.has(idx)) return;
      if (action === 'mark') this.candidates.add(idx);
      else this.candidates.delete(idx);
      this.render();
    }
  };

  // 启动游戏
  window.addEventListener('DOMContentLoaded', () => Game.start());

  // #demo 时把 Game 暴露到 window，方便自动化测试与调试
  if (location.hash.includes('demo')) {
    window.Game = Game;
  }
})();

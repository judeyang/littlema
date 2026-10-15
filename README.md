# 小马快跑

原生 HTML、CSS、JavaScript 网格逻辑游戏。每行、每列、每个颜色区域各有一匹马，任意两匹马不能相邻（包括斜角）。

## 运行

在浏览器打开 index.html。单击标记，双击翻开，拖动连续标记，长按后移动可连续标记。也可以在项目目录运行 `python3 -m http.server 8765 --bind 127.0.0.1`，访问 http://127.0.0.1:8765/。

## 文档

“查看提示”显示关键候选、推理步骤与结论，已证明的历史排除合并说明。长提示可滚动阅读，再次点击原按钮收起；棋盘操作、重玩或换关后旧提示失效，不会自动放马或打叉。

前 5 关不限时、提示不限；后续常规题 180 秒／2 次提示，复杂题 300 秒／3 次，第 77 关起的复杂题 480 秒／3 次。复杂度由题目的推理档位、评分和挑战用途决定，不仅按棋盘大小。超时仍可继续解题、不扣星；阅读有效推理和切到后台时暂停。刷新续接剩余时间与提示额度，主动重玩才补满。只有一条新的有效证明扣 1 次，收起／重看同条证明／无有效提示不扣。额度用完后可以继续推理，或在确认弹窗中选择重玩。

- [项目规则](AGENTS.md)
- [当前进度](ROADMAP.md)
- [施工清单](goals/20260915-1249-difficulty-v1-1.md)
- [获批设计](docs/difficulty-design.md)
- [推理接口与可信边界](docs/logic-api.md)
- [倒计时与提示额度规则](docs/timed-hints.md)
- [产题试验与样本审计](docs/production-audit.md)

## 验证

四区域独立试玩：http://localhost:8765/index.html#pack=four 。复用原界面，当前有一题；使用 `pony-run-four-test-v12` 独立存档，不覆盖主线。返回原地址可继续主线。

四题挑战回落试玩：http://localhost:8765/index.html#pack=four-pair 。按顺序提供开局四区域、隐藏四区域挑战、同关系轻松题和不同答案布局参考题。使用 `pony-run-four-pair-test-v12` 独立存档，旧单题试玩也保持不变。

全表节奏复核：`node scripts/audit-campaign-rhythm.cjs`。重新分析实际题目，逐一检查所有 `recoveryOfLevel`，输出 JSON；有明确错误时退出码为 1，评分差值与同技巧练习警告仍需人工判断。此命令只读，不替换关卡。

使用本机 Node 执行 `node --test tests/*.test.cjs`。测试覆盖 100 关连续唯一 ID、当前题库唯一解与证明回放、每条结论独立裁判、提示禁止读取答案、错误标记、2～4 联合锁、首关自由操作、双击、胜利存档，以及计时／提示额度恢复。前 30 关和后续每 5 关题跑八方向，其余题至少恒等方向。存档兼容测试包含独立旧版本样本，不表示当前前 30 关仍与旧题相同。提示与生成校验共用 src/logic-engine.js，提示接口不接收答案。

离线产题与审计：`node scripts/generate-puzzles.cjs /absolute/output.json 1000 20260915`，再执行 `node scripts/audit-puzzles.cjs /absolute/output.json`。输出保存 seed、配置、版本及拒绝原因；这不会自动替换当前游戏关卡。

开发审题包位于 data/development-samples.json，包含 30 道零单格样本和 6 对同尺寸技巧比较。当前本机题库位于 data/campaign.js，版本 v1.3-local-100.1，共 100 关，棋盘从 5×5 到 14×14，第 20 关起每 5 关一个挑战并后接回落，100 为最终挑战。当前前 30 关已经更换，不是 v1.1 冻结版本；66 题含单格颜色区域，6 题使用短反证（20、25、35、80、95、100）。旧第 31 关参考题保存在 data/reference-level-66.json，不占正式关位；四区域试玩包仍与主线隔离。

当前 v1.3 产题脚本为 `scripts/build-campaign-v13.cjs`，读取本机 `.tmp/pool-v13/campaign-v12-extract.json` 候选输入并直接写题库。`scripts/build-campaign-100.cjs` 及 [v1.2 清单](goals/20260915-1533-difficulty-v1-2.md) 是此前版本的生产流程；当前游戏只读取已生成的题库文件。

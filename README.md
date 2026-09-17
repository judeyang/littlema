# 小马快跑

原生 HTML、CSS、JavaScript 网格逻辑游戏。每行、每列、每个颜色区域各有一匹马，任意两匹马不能相邻（包括斜角）。

## 运行

在浏览器打开 index.html。单击标记，双击翻开，拖动连续标记，长按后移动可连续标记。也可以在项目目录运行 `python3 -m http.server 8765 --bind 127.0.0.1`，访问 http://127.0.0.1:8765/。

## 文档

“查看提示”显示关键候选、推理步骤与结论，已证明的历史排除合并说明。长提示可滚动阅读，再次点击原按钮收起；棋盘操作、重玩或换关后旧提示失效，不会自动放马或打叉。

- [项目规则](AGENTS.md)
- [当前进度](ROADMAP.md)
- [施工清单](goals/20260915-1249-difficulty-v1-1.md)
- [获批设计](docs/difficulty-design.md)
- [推理接口与可信边界](docs/logic-api.md)
- [产题试验与样本审计](docs/production-audit.md)

## 验证

四区域独立试玩：http://localhost:8765/index.html#pack=four 。复用原界面，当前有一题；使用 `pony-run-four-test-v12` 独立存档，不覆盖主线。返回原地址可继续主线。

四题挑战回落试玩：http://localhost:8765/index.html#pack=four-pair 。按顺序提供开局四区域、隐藏四区域挑战、同关系轻松题和不同答案布局参考题。使用 `pony-run-four-pair-test-v12` 独立存档，旧单题试玩也保持不变。

全表节奏复核：`node scripts/audit-campaign-rhythm.cjs`。重新分析实际题目，逐一检查所有 `recoveryOfLevel`，输出 JSON；有明确错误时退出码为 1，评分差值与同技巧练习警告仍需人工判断。此命令只读，不替换关卡。

使用本机 Node 执行 `node --test tests/*.test.cjs`。测试覆盖 100 关连续唯一 ID、前 30 关冻结记录、70 个新增题的八方向唯一解与证明回放、每条结论独立裁判、提示禁止读取答案、错误标记、2～4 联合锁与经典脚本接入。提示与生成校验共用 src/logic-engine.js，提示接口不接收答案。

离线产题与审计：`node scripts/generate-puzzles.cjs /absolute/output.json 1000 20260915`，再执行 `node scripts/audit-puzzles.cjs /absolute/output.json`。输出保存 seed、配置、版本及拒绝原因；这不会自动替换当前游戏关卡。

开发审题包位于 data/development-samples.json，包含 30 道零单格样本和 6 对同尺寸技巧比较。当前本机题库位于 data/campaign.js，包含 100 关正式主线：前 30 关保持 v1.1 原记录，第 31～100 关按三段渐进基线、14 个高峰和峰后回落编排。旧第 31 关参考题保存在 data/reference-level-66.json，不占正式关位；四区域试玩包仍与主线隔离。

100 关生产脚本为 `scripts/build-campaign-100.cjs`。它只在显式提供 `CAMPAIGN100_TASK_ROOT` 时读取任务证据，例如 `CAMPAIGN100_TASK_ROOT=/absolute/task node scripts/build-campaign-100.cjs verify`；`inventory`、`build`、`verify` 分别准备候选索引、生成待安装题库和执行完整准入验证，`search66` 仅在现有短反证候选不足时使用。最新施工清单见 [v1.2](goals/20260915-1533-difficulty-v1-2.md)。

# 倒计时与提示额度实施约定

2026-09-27 用户批准开始修改。范围：修首关自由步骤、双击、连胜漏存；增加软倒计时和每次挑战的提示额度。保持现有页面主体、规则与 100 题数据，不修改多人档案、不重新编排关卡、不提交／发布。

## 行为与验收

- 前 5 关不计时、提示不限；其他常规题 180 秒／2 次提示。
- 高峰用途题，或 required tier（allowedTier）至少 3，或工程评分至少 45，视作复杂题：300 秒／3 次。第 77 关起同时满足复杂题条件则 480 秒／3 次。仅按关号或尺寸放大不能单独获得长时间。
- 时间到只显示“已超时，可继续”，不扣星、不判失败；胜败仍由原规则判断。
- 阅读有效推理提示、后台隐藏与首关引导时暂停。收起／棋盘操作后恢复，后台返回不补扣隐藏期间时间。按实际经过毫秒结算，不按回调次数计秒。
- 保存剩余时间和已获得的提示结论键；刷新沿用，不补满。旧存档缺少字段时首次初始化；无效字段裁剪到合法范围。新一轮／主动重玩才重置。
- 仅展示有效证明的新推理才消耗 1 次；同结论重看、收起、无有效推理不扣。额度耗尽仍允许重看已获得结论；不生成新推理、不自动放马。
- 新提示额度耗尽时复用现有弹窗，提供“继续推理”和“重玩本关”，明确重玩会清除本次棋盘进度；确认弹窗期间暂停计时。不增加新的操作栏。
- 首关自由步骤允许正常点击和拖动；自由步骤文本显示实际剩余匹数。双击等待与识别均用 320 ms。先设置胜利状态／连胜再渲染保存。
- 使用纯模块单测和原 game.js 的隔离 VM 回归：计时边界、暂停、后台、刷新、重玩、额度、旧存档、获胜／失败／末关。再跑全套现有测试、语法和题库哈希检查。
- 真实浏览器必须复用既有 Chrome；无法连接就如实保留未验，不新建浏览器或把 VM 当真实触摸验证。

## C1 子任务合同（Sol）

目标：实现纯计时／额度模块，主 Agent 同时处理 game.js、页面、存档接入和集成测试。项目 /Users/yanglin/WorkBuddy/2026-09-09-14-45-50，阅读 AGENTS.md。当前题库 v1.3-local-100.1。

独占写入：src/round-challenge.js、tests/round-challenge.test.cjs。禁止修改其他文件、题库、服务、Git、真实浏览器存档；有其他工作者，不覆盖他人改动；不得继续委派。

确定接口：浏览器全局 RoundChallenge 与 CommonJS 双导出。

- policyFor(record)：返回 {seconds, hintLimit}，不限次数用 null；按上方确定条件计算。
- create(record, saved)：返回 {policy, remainingMs, hintKeys: Set}；saved 是可缺省的 {remainingMs,hintKeys: string[]}，时间有限、非负、最多政策总额；键去重，仅非空字符串，长度最多 2048，列表最多 hintLimit（不限最多 1000）；无效时间用政策总额，不读取答案。
- advance(state, deltaMs)：有效非负毫秒从剩余扣除，夹到 0，不处理暂停（主程序负责）；返回剩余毫秒。
- remainingHints(state)：返回剩余次数或 null。
- hintKey(result)：无有效 proof 返回 null；有效键只含 ruleId、groups、targetGroups、conclusion 的稳定序列化，索引／组排序去重，不含 before、premises、solution。无 place／exclude 的证明视为无效。
- claimHint(state,key)：有效已获得键返回 true 不扣；额度足够则记录并 true；无效或用尽 false。
- snapshot(state)：返回 JSON 可保存的 {remainingMs,hintKeys:[...]}。

验收：三档政策、教学不限、超时不负数、坏值／负增量、重复结论不扣（顺序／前提变化同键）、用尽拒绝新键且旧键可看、序列化恢复、重玩重置；仅运行自身测试与语法检查。交付 Outcome／Evidence／Artifacts or changed files／Verification／Unresolved／Needs branch。主 Agent 检查实际改动并复跑。

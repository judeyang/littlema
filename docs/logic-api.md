# 证明底座接口

逻辑引擎版本：1.1.0。使用原生经典脚本，顺序为 puzzle-core → logic-engine → hint-presenter → game。Node 使用 CommonJS。

## 输入与可信边界

Puzzle 为 `{size, regions}`，regions 是行优先的一维区域编号数组。输入不包含答案。可信事实为 `{placed, excluded}`，来自已经确认的马与翻错格。玩家手动 ✕ 通过 hint 的 userMarks 参数单独传入，不缩小可信候选。

Core.countSolutions 独立逐行枚举。默认 limit=2，只有 status=complete、count=1、truncated=false 才是唯一解。unknown 是预算不足，不是无解。Core.validateSolution 只供判题、开发裁判，不参与生成解释。

Logic.solve 返回状态、trace、state。基础排除穷尽后，依次检查单锁、双联合、三／四联合、共同冲突和单层反证。反证最多 3 个基础传播步骤，不允许嵌套。反证预算失败不查答案兜底。

## 证明与应用

ProofStep 包含 before 局面指纹、premises 事实来源、sourceCells、groups、conclusion。联合锁额外记录 targetGroups；反证记录假设格、嵌套基础证明和具体冲突对象。索引均为零基，展示转换为一基。

Logic.verifyStep 从当前可信局面重新推导，拒绝过期及被修改的证明；Logic.replay 逐步校验整条轨迹。Logic.applyStep 是引擎内部的可信步骤应用函数，不接受任意外部输入；任何持久化或跨界传来的证明必须先 verifyStep。UI 不可直接把玩家编辑当作 proof。

hint 返回当前一条有效操作及 prerequisites。已手动标记的正确排除可在后台证明后跳过，但依赖链保留。若证明某个被标记的位置为马，返回 correction。没有可解释新步骤时返回 stalled／unknown／solved 等实际状态。

## 验证边界

Node 独立解数裁判核对每个候选结论，并检查前提、回放、篡改和预算。Game 接入以 VM 测试验证脚本与数据契约；VM 不证明浏览器绘制、触摸和布局。相关 UI 验收在 G4 单独进行。

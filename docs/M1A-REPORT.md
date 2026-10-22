# M1a 实施报告（host 核心）

> 日期：2026-10-22
> 范围：M1a 第一切片——四阶段状态机、审批、树记忆、预算核算、模型指南、host 工具与命令。
> 结论：**host 核心可编译、可测试、可打包**；派发接线、压缩验证与 client 尚未完成。

## 1. 交付内容

| 模块 | 作用 |
|---|---|
| `src/types.ts` | 阶段、模式状态、任务树、记忆记录、预算、DCR、交班结构 |
| `src/config.ts` | `Config` schema（Schemastery）+ 交叉校验；D4 默认值全部可配 |
| `src/phases.ts` | P0–P3 规则、交付件必填小节（中英别名）、实现门禁、DCR 上限 |
| `src/state.ts` | 纯 reducer：模式开关、计划、提交/批准/拒绝、DCR、任务更新、压缩标记 |
| `src/memory.ts` | sidecar JSONL：decisions/artifacts 全树、findings 分支、promote、supersedes、路径安全 |
| `src/budget.ts` | 纯预算核算：每子步数/token、树总量、80% warn / 100% stop、确定性 exceeded |
| `src/guidance.ts` | 阶段规范、动态状态块、压缩后 handoff、模式通知、审批理由 |
| `src/dispatch.ts` | 子 Agent brief 渲染、扇出/阶段/DCR 检查、文件归属冲突 |
| `src/guard.ts` | 工具门禁：P0/P1 写实现、子会话集成命令、跨会话文件归属 |
| `src/tools.ts` | `longhaul_status` / `_plan` / `_submit` / `_dispatch` / `_memory` / `_change` |
| `src/index.ts` | Cordis 插件入口：guidance、工具、`/longhaul`、状态、子派发、预算事件、门禁、压缩调度 |

## 2. 验证

```text
pnpm typecheck   exit 0
pnpm test        exit 0 — 11 files / 98 tests
pnpm build       exit 0 — lib/*.js + lib/*.d.ts
node import      exports: Config, apply, inject, name; name=longhaul
```

测试分布：

- `state.spec.ts` 12：模式、计划、闸门、拒绝、DCR、压缩标记、预算观察。
- `phases.spec.ts` 10：阶段顺序、必填小节/别名、实现门禁、DCR 上限。
- `memory.spec.ts` 6：JSONL、分支可见性、promote、supersedes、损坏行。
- `budget.spec.ts` 19：计数、不可变、warn/stop、树上限、确定性排序。
- `config.spec.ts` 6：默认值、范围校验、phase 路由完整性。
- `guidance.spec.ts` 12：policy/state/handoff/notice。
- `dispatch.spec.ts` 17：brief、拒绝条件、归属冲突。
- `guard.spec.ts` 9：交付件路径、集成命令、阶段写门禁、归属拒绝。
- `tools.spec.ts` 4：dispatch 参数整形、拒绝传播、status 报告、子会话记忆 ACL。
- `integration/compaction.spec.ts` 1：真实 Session + Cordis 事件总线 + 假压缩后端；验证 `turn/end` 触发一次 `compactNow`，且 handoff 在压缩之后注入、状态落盘为 `compactPending=false`。
- `integration/plugin.spec.ts` 2：真实 Cordis 组合下注册 6 个工具、section、命令；status 读盘。

## 3. 已实现的验收点（对照 DESIGN §5）

- 未批准 P1 前禁止实现：`phases.canImplement` + `longhaul_submit` 阶段检查 + `tools/pre-execute` 写门禁（只允许 `.longhaul/` 交付件）。
- 每阶段交付件 + 审批：`longhaul_submit` 校验文件与小节，`ctx.approval.request` 仅 `allowed-once` 推进。
- 退出/恢复：state.json 原子写 + 插件记录；`/longhaul off` 保留状态。
- 子只读本分支 findings / decisions 全树 / 跨树拒绝：memory 分支 ACL + root 命名空间；子会话可 append finding，decisions/promote 仅 root。
- 预算超限停止并汇报：`subagent/start`/`step/start`/`assistant/message.usage` 已接线；80% 提醒、100% `dispose` 并在父会话通知。
- 自动派发：`longhaul_dispatch` 调 `ctx.subagents.startActivation`，brief + 结构化 outputSchema + 扇出/归属/DCR 检查；父保持集成门禁。
- 设计变更环：`longhaul_change` request/decide/list，批准后 designVersion+1、compactPending。

## 4. 未完成 / 已知问题

1. **压缩只做了结构验证**：`turn/end` 调度、`compactNow` 调用、handoff 顺序与状态落盘已有集成测试（假压缩后端）；真实 `compaction-basic` 的摘要质量与失败重试仍需 Desktop 真会话 spike。
2. **模型策略未接线**：默认 `inherit`，`sessionController.selectModel` 未调用（spike 2 未做）。
3. **state.json 校验较浅**：只校验 version/rootSessionId，嵌套字段损坏会在使用处暴露；后续加结构校验。
4. **子会话工具重复派发**：plan 中 running 任务允许再次 dispatch（用于恢复），但会生成第二个 writer；M1b 加单写者锁。
5. **自定义 message source**：`longhaul` 作为新 source kind 声明；不带插件的读取方按未知 kind 透传。
6. **`appendPluginRecord` 的外部调用**：DSH 的 `verify-plugin-record-callers` 仅约束本仓库；外部插件使用处于文档灰色区，记录为 ignorable 并可能被迁移丢弃，权威状态仍是 sidecar。
7. **预算事件在子 Agent 释放后**：`childRoots` 缓存保证 `subagent/end` 能结算；冷恢复的新子会话依赖 live lineage。

## 5. 下一步（M1a 收尾 → M1b）

1. 真实会话跑压缩 spike，记录 `compactNow` 的结果与 handoff 顺序。
2. 客户端 chip、风险确认、设置页（M1b）。
3. 模型路由接线（默认仍 inherit，spike 2 后再开）。
4. 单写者锁与任务恢复策略。

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
| `src/tools.ts` | `longhaul_status` / `_plan` / `_submit` / `_memory` / `_change` |
| `src/index.ts` | Cordis 插件入口：guidance section/context、工具、`/longhaul`、状态持久化、插件记录、阶段末压缩调度 |

## 2. 验证

```text
pnpm typecheck   exit 0
pnpm test        exit 0 — 8 files / 82 tests
pnpm build       exit 0 — lib/*.js + lib/*.d.ts
node import      exports: Config, apply, inject, name; name=longhaul
```

测试分布：

- `state.spec.ts` 10：模式、计划、闸门、拒绝、DCR、压缩标记。
- `phases.spec.ts` 10：阶段顺序、必填小节/别名、实现门禁、DCR 上限。
- `memory.spec.ts` 6：JSONL、分支可见性、promote、supersedes、损坏行。
- `budget.spec.ts` 19：计数、不可变、warn/stop、树上限、确定性排序。
- `config.spec.ts` 6：默认值、范围校验、phase 路由完整性。
- `guidance.spec.ts` 12：policy/state/handoff/notice。
- `dispatch.spec.ts` 17：brief、拒绝条件、归属冲突。
- `integration/plugin.spec.ts` 2：真实 Cordis 组合下注册 5 个工具、policy/state section、命令；`longhaul_status` 从磁盘读状态。

## 3. 已实现的验收点（对照 DESIGN §5）

- 未批准 P1 前禁止实现：`phases.canImplement` + `longhaul_submit` 的阶段检查；工具层写实现文件的 pre-execute 门禁**尚未接线**（下一步）。
- 每阶段交付件 + 审批：`longhaul_submit` 校验文件与小节，`ctx.approval.request` 仅 `allowed-once` 推进。
- 退出/恢复：state.json 原子写 + 插件记录；`/longhaul off` 保留状态。
- 子只读本分支 findings / decisions 全树 / 跨树拒绝：memory 分支 ACL + root 命名空间；子会话工具接入待 M1b。
- 预算超限停止并汇报：核算模块完成；**事件接线未做**，当前报告为 0。
- 设计变更环：`longhaul_change` request/decide/list，批准后 designVersion+1、compactPending。

## 4. 未完成 / 已知问题

1. **派发未接线**：`dispatch.ts` 只有纯策略与 brief；尚未注册 `longhaul_dispatch` 工具、未调用 `ctx.subagents.startActivation`、未处理子结果合并。
2. **预算事件未接线**：未订阅 `session/event` 的 `step/start` 与 `assistant/message.usage`，子会话预算仍是 0；`startChild` 未接 `subagent/start`。
3. **阶段末压缩未实测**：`turn/end` + `agent.runMaintenance` + `compactNow` 已按设计接线，但尚未在真实会话验证（设计 §7.8 的 spike 1）。
4. **模型策略未接线**：默认 `inherit`，`sessionController.selectModel` 未调用（spike 2 未做）。
5. **子会话记忆未开放**：`longhaul_memory` 在子会话直接拒绝（M1a 收窄）；M1b 接入 branch append。
6. **写实现门禁未接线**：`tools/pre-execute` 尚未拒绝 P0/P1 的实现写入；当前依赖 guidance 与 deliverable 检查。
7. **state.json 校验较浅**：只校验 version/rootSessionId，嵌套字段损坏会在使用处暴露；后续加结构校验。
8. **自定义 message source**：`longhaul` 作为新 source kind 声明；不带插件的读取方按未知 kind 透传（设计已确认可接受）。
9. **`appendPluginRecord` 的外部调用**：DSH 的 `verify-plugin-record-callers` 仅约束本仓库；外部插件使用处于文档灰色区，记录为 ignorable 并可能被迁移丢弃，权威状态仍是 sidecar。

## 5. 下一步（M1a 收尾）

1. 接线 `longhaul_dispatch` + `startActivation`（brief、outputSchema、扇出/归属检查）。
2. 订阅 `subagent/start`、`step/start`、`assistant/message.usage`，喂 `budget` 并在 80/100% 提醒/中断。
3. `tools/pre-execute`：P0/P1 拒绝实现写入；子会话拒绝集成命令。
4. 用真实会话跑压缩 spike，记录 `compactNow` 的结果与 handoff 顺序。
5. 子会话 `longhaul_memory`（append-only findings）与 root promote。

# 变更日志

[English](CHANGELOG.md) | [简体中文](CHANGELOG.zh-CN.md)

## 0.1.0 — 未发布

- 四阶段 host 核心：P0 需求 → P1 设计 → P2 开发 → P3 发布，含可持久化状态 reducer、
  交付件章节检查、一次性阶段审批。
- 模型工具：`longhaul_status`、`longhaul_plan`、`longhaul_task`、`longhaul_submit`、
  `longhaul_dispatch`、`longhaul_memory`、`longhaul_change`；以及 `/longhaul on|off|status`。
- 子 Agent 派发：自包含 brief、结构化子结果、扇出/归属/DCR 检查、仅父会话集成。
- 工具闸门：P1 通过前阻塞实现写入、拒绝子会话集成命令、强制跨会话文件归属。
- 闸门硬化：P0/P1 的 shell 写入默认拒绝，只保留保守只读 allowlist；`apply_patch`
  在 P2 前拒绝；状态不可读时 fail-closed；P2 子会话只能写自己 plan 任务拥有的文件。
- 计划生命周期：P0 提交前必须有计划；修改必须用 `mode: "revise"` 并给原因；遗留 P1
  会话可用 `mode: "recover"` 恢复一次缺失计划。
- 工作路径改为使用会话 `workingDirectory` 服务，而不是不可变的 session header 目录。
- 任务树：`longhaul` projection 携带计划目标、计划版本和每个任务
  （状态/文件/依赖/owner）；`dsh-better-sidebar` 增加「长任务」tab，显示阶段闸门与
  任务树；`longhaul_task` 在 P2/P3 更新任务状态/owner。tab 为只读，并增加带交付件链接
  的阶段 stepper、可展开任务详情、更新时间与 evidence 计数/最近记录。chip 旁的
  **任务** 按钮可打开 tab；从 chip 开启模式时会自动打开。
- 记忆：从持久化 plan 重建派发子会话的归属，子会话结算后根会话仍能列出并 promote 其
  findings；`longhaul_memory` 新增 `append_artifact`，记录 workspace-relative 证据。
- 树形记忆：append-only sidecar JSONL、全树 decisions/artifacts、分支 findings、
  父会话 promote、supersession 版本。
- 预算核算：每个子会话的 step/token、全树上限、80% 警告 / 100% 停止。
- 阶段引导 section、每轮状态上下文、压缩后 handoff，以及带每任务上限的设计变更请求（DCR）。
- 客户端入口：composer「长任务」chip、双语标签、原生风险确认，以及用于实时阶段状态的
  `longhaul` session projection。
- 修复：chip 不再让 composer 槽位崩溃（`useInput` 需要 selector）；模式入口不再在
  open turn 之外调用 `approval.request()`。
- Config schema 带 D4 默认值与阶段模型路由（默认 `inherit`）。

## 0.0.0 — 2026-10-22

- 初始脚手架：Cordis 插件入口、`cordis.patch.yml`、build/typecheck/test 脚本、CI
  与设计交接。尚无行为（M0）。

# 变更日志

[English](CHANGELOG.md) | [简体中文](CHANGELOG.zh-CN.md)

## 0.1.0 — 未发布

- 四阶段 host 核心：P0 需求 → P1 设计 → P2 开发 → P3 发布，含可持久化状态 reducer、
  交付件章节检查、一次性阶段审批。
- 模型工具：`longhaul_status`、`longhaul_plan`、`longhaul_submit`、`longhaul_dispatch`、
  `longhaul_memory`、`longhaul_change`；以及 `/longhaul on|off|status`。
- 子 Agent 派发：自包含 brief、结构化子结果、扇出/归属/DCR 检查、仅父会话集成。
- 工具闸门：P1 通过前阻塞实现写入、拒绝子会话集成命令、强制跨会话文件归属。
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

# dsh-longhaul

[English](README.md) | [简体中文](README.zh-CN.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的长任务模式插件。

一个会话级模式，按“人做长任务”的方式推进：**需求 → 设计 → 开发 → 发布**。每个阶段闸门都提交交付件等待审批，并配套树形记忆（`decisions` / `findings` / `artifacts`）、预算约束下的子 Agent 派发，以及仅父会话可执行的集成闸门。

> 状态：**0.1.0 候选版本**。插件已提供四阶段状态机、`longhaul_*` 工具
> （status/plan/submit/dispatch/memory/change）、`/longhaul on|off|status`、带原生风险确认的
> composer「长任务」chip、可持久化模式状态、带分支 ACL 的树记忆、预算核算与停止规则、
> 结构化 brief 的子 Agent 派发、工具阶段/文件归属闸门、模型引导，以及设计变更回路。
> chip 与模式开关已在真实 Desktop 验收；`typecheck`、110 个测试、`build` 均通过。
> `npm publish` 之前还剩：设置页、真实会话压缩验收、发布/CI 执行。
> 见 [docs/RELEASE.zh-CN.md](docs/RELEASE.zh-CN.md)。

## 安装（开发）

```sh
pnpm install
pnpm build
```

管理 Desktop profile 前必须完全退出 DeepSeek Harness Desktop，然后从源码检出运行 DSH CLI
（或使用已安装应用里的 `resources\runtime\cli\bin\dsh.cmd`）：

```sh
pnpm dsh plugin --profile desktop add C:\path\to\dsh-longhaul
# 卸载
pnpm dsh plugin --profile desktop remove dsh-longhaul
```

之后启动 Desktop，在插件页确认插件出现。Desktop 运行期间管理 profile 可能在 profile 根目录
`cordis.yml` 留下镜像行；见 [docs/M0-REPORT.md](docs/M0-REPORT.md)。

## 使用

```text
/longhaul on        # 为当前根会话开启长任务模式
/longhaul status    # 阶段、计划、预算、待审批项
/longhaul off       # 退出模式；持久化状态与记忆保留
```

模型随后按 P0 需求 → P1 设计 → P2 开发 → P3 发布推进。
每个闸门都需要交付件文件和一次性审批（`longhaul_submit`）；P1 通过前实现写入保持阻塞。
发现按分支隔离，决策全树共享，且只有父会话可提升。开发期提出的设计变更走
`longhaul_change`，只重跑受影响的任务。

## 兼容性与发布

- DSH `0.2.1-rc.x`（`engines.dsh: ">=0.2.1-rc.1 <0.3.0"`），Cordis `4.0.5`，Node `^22.19 || >=24`。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm pack --dry-run` 是发布闸门；
  CI 在 Node 22 与 24 上运行。
- tarball 包含 `lib/`、`client.js`、`cordis.patch.yml`、`locale/*.json`、README 与 LICENSE。
- 发布命令：在干净的 `main` 上执行 `npm publish --access public`；包名在 npm 上未被占用，
  不需要 scope。

## 设计

- [docs/README.md](docs/README.md) — 文档索引与语言切换。
- [docs/HANDOVER.md](docs/HANDOVER.md) — 决策记录 D1–D9、架构、里程碑、风险。
- [docs/DESIGN.md](docs/DESIGN.md) — M0 调研答案、M1 设计、已批准的四阶段模型。
- [docs/decisions.md](docs/decisions.md) — 决策日志（继承 D1–D9，记录 D10–D23）。
- [docs/findings/M0-research.md](docs/findings/M0-research.md) — M0 分支发现。
- [docs/M0-REPORT.md](docs/M0-REPORT.md) — 安装/卸载命令与证据。
- [docs/M1A-REPORT.md](docs/M1A-REPORT.md) — host 核心实现与验证。
- [docs/M1B-REPORT.md](docs/M1B-REPORT.md) — composer chip、风险确认与 projection。
- [docs/RELEASE.zh-CN.md](docs/RELEASE.zh-CN.md) — 发布闸门、发布步骤与已知限制。

## 许可证

MIT

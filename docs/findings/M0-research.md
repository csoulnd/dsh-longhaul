# M0 分支发现（findings）

> 规则：每条 finding 只属于产出它的分支；父可以把结论 **promote** 到 [decisions.md](../decisions.md) 或 [DESIGN.md](../DESIGN.md)。
> 来源：2026-10-22 M0 调研的 5 条只读研究分支（R1–R5），由父汇总。findings 不进入模型可见面，除非 promote 后写进设计/决策。
> 证据路径相对于 DSH fork `C:\data\project\thirdpart\deepseek-harness`。

## R1 模式入口与客户端 UI

- F1.1 第三方**无法**注册新的 permission preset；`registerAuto` 是唯一运行期入口且只服务保留 id `auto`。
  - 证据：`packages/interaction/permission-presets/src/index.ts:307-317`；`docs/subsystems/permission-presets.md:49`；`README.md:135`。
- F1.2 `PresetSpec` 只有 sandbox/approval + name/description；无 icon、badge、行为扩展位。
  - 证据：`packages/interaction/permission-presets/src/index.ts:64-73`；`packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:28-38,49-51`。
- F1.3 仅 `danger-full-access` 与 `auto` 有产品级风险确认；自定义 preset 没有。
  - 证据：`ui-permission-presets/src/client/index.ts:94-104`；`PermissionSelect.tsx:133-138`。
- F1.4 客户端插件通过 `dsh.client` + `exports["./client"]` 被 `packages/client/modules` 发现；`inject` 仅信息性。
  - 证据：`packages/client/modules/src/index.ts:844-879`；`packages/util/package-manifest/src/types.ts:81-93`。
- F1.5 可用槽位：composer dock/input、session header actions/corner、settings section/item、plugins item、shell overlay、sidebar toggle badge；**没有**通用会话状态徽章槽。
  - 证据：`docs/subsystems/slots.md:118-187`；`packages/client/ui-slots/src/client/slot-catalog.ts:655,1136,1425,1623,1687,2842,3197,3348,4436`。
- F1.6 第三方 client 文案必须走 `ctx.locale.register`（非类型化重载可用）；`locale/*.json` 只用于 Plugins 页元数据。
  - 证据：`packages/client/locale/src/client/index.ts:389,399`；`packages/boot/app-boot/src/package-meta.ts:128`。
- F1.7 `@deepseek-ai/dsh-permission-presets` 与 `@deepseek-ai/dsh-experimental-auto-review` 都已发布，但 API 预发布、无稳定性承诺。
  - 证据：两包 `package.json` 的 `publishConfig`；根 `AGENTS.md`；`packages/experimental/AGENTS.md`。

**promote**：Q1/Q8 结论 → DESIGN §1；D10/D16。

## R2 指令注入与 preset

- F2.1 `ctx.systemPrompt.section` 的 `text` 可为函数，每个 step 重新求值；返回 `''` 即关闭。
  - 证据：`packages/core/system-prompt/src/index.ts:53-76,478,290-295,662`。
- F2.2 动态值应放 `systemPrompt.context()`；循环以带来源的 `user/message` 快照落盘，只在渲染变化时重发。
  - 证据：`packages/core/system-prompt/src/index.ts:513,582`；`packages/core/agent-loop/src/agent.ts:427-440`。
- F2.3 plan-mode 是「配置 prose + 日志化开关 + projection + pre-step 追加」的标准先例。
  - 证据：`packages/plan/plan-mode/src/index.ts:45-54,136-168,196-213,216-224,463-474`。
- F2.4 第三方插件可以注册 preset（`ctx.agentPresets.register` 或 bundle 里放 `@deepseek-ai/dsh-agent-preset` 行）；但 preset 只能用于**新会话**，已开始的会话锁定。
  - 证据：`packages/preset/agent-preset-registry/src/index.ts:81,349-354`；`packages/preset/agent-preset/src/index.ts:12-29`；`packages/api/session-controller/src/agent.ts:543-547`。
- F2.5 preset 里的子行按声明插件的 `baseUrl` 解析，第三方 npm 包可用；发布 service 的子行需要 `isolate`。
  - 证据：`packages/preset/agent-preset-registry/src/mount.ts:204-216`。
- F2.6 `appendPluginRecord` 写的是 ignorable、不进模型面的记录；**不能**作为模型可见指令的日志依据。
  - 证据：`packages/core/session/src/index.ts:469-512,839-855`；`packages/core/session/src/surface.ts:306`。
- F2.7 无法从日志推导的开关状态必须显式记录（事件或 notice）；否则违反 model-visible ⟺ logged。
  - 证据：`docs/architecture.md:124`；plan-mode 的两条路径。

**promote**：Q2 结论 → DESIGN §1；D12；§3.8。

## R3 审批、会话事件、session-query、goal

- F3.1 `ctx.approval.request()` 可在 open turn 内以任意 `toolName` 调用；只有 `allowed-once` 授权；`never` 在服务内拒绝；无 answerer → `unavailable`。
  - 证据：`packages/interaction/user-approval/src/index.ts:215,84-92,275,283`；`types.ts:32`。
- F3.2 审批只写 `approval/asked|decided` 审计事件，不持久化 grant；`displayReason` 不落盘。
  - 证据：`packages/interaction/user-approval/src/index.ts:225-232`；`types.ts:44-58,72`。
- F3.3 第三方要求的 required session 事件会让读日志整份拒绝；只能写 `ignorable:true`（plugin record）。
  - 证据：`packages/session/session-persistence/src/storage-contract.ts:69-80`；`.agents/notes/implemented/architecture/2026-08-30-retain-ignorable-external-session-events.md:41`。
- F3.4 plugin record 跨恢复保留，但迁移只 best-effort；不参与文本检索。
  - 证据：`packages/core/session/tests/plugin-records.spec.ts:133-148`；`packages/session-query/session-query/src/extraction.ts:15-44`。
- F3.5 session-query 可列事件、读事件、按 parent/cwd 过滤、查 lineage；cwd 相等只是同一逻辑会话的 header 兼容条件，不是可见性规则。
  - 证据：`packages/session-query/session-query/src/index.ts:269,355,174,206,327`；`src/sources.ts:11-24`。
- F3.6 goal 可程序化 `create`；没有「推进一轮」的服务 API；driver 注入 goal 消息推进，且加载时 disarm 全部 goal。
  - 证据：`packages/goal/goal/src/index.ts:303,613`；`packages/goal/goal-round-driver/src/index.ts:190-208,449-452`。
- F3.7 driver 无预算配置、每轮等待子 Agent、goal 是 per-session；子会话不能创建/完成 goal。
  - 证据：`goal-round-driver/src/index.ts:177-181`；`tool-goal/src/authority.ts:80-118`。
- F3.8 headless 默认 `ask` + 无 answerer = 工具被拒；`danger-full-access` 下 `never` 直接拒绝；ACP 只在带 callId 时应答。
  - 证据：`packages/interaction/user-approval/src/index.ts:283`；`packages/core/tools/src/index.ts:1770-1773`；`packages/acp/acp/src/index.ts:159-177`。

**promote**：Q3/Q4/Q7 结论 → DESIGN §1；D11/D15；§3.3/§3.4/§3.10。

## R4 派发、预算、观察、门禁

- F4.1 `startActivation` 要求父 Agent 存活且 provider 已注册；brief = `request.prompt`；`outputSchema` 安装结构化输出工具。
  - 证据：`packages/subagent/subagent/src/index.ts:255-284`；`types.ts:136-183`；`structured.ts:19-155`。
- F4.2 子会话审批固定 `never` + 来源 `delegation`；子无法走人工审批。
  - 证据：`packages/subagent/subagent/src/child-agent.ts:243-253,273-274`。
- F4.3 无 per-child 步数/token/时间预算；只有 depth、maxActiveSubagents、单请求 maxTokens。
  - 证据：`packages/subagent/subagent/src/index.ts:187-190`；`core/agent/src/runtime-types.ts:33-34`。
- F4.4 步数/token 可从 `step/start` 与 `assistant/message.usage` 统计；无聚合服务。
  - 证据：`packages/core/session/src/types.ts:289-302,342-350`。
- F4.5 中止：`interrupt()`（keepInbox）与 `activation.dispose()`；无内建超时。
  - 证据：`packages/subagent/subagent/src/manager.ts:219-227,1094-1184`。
- F4.6 父可观察 `subagent/start|end`、`activation.result`、settlement 消息、`list_agents`。
  - 证据：`packages/subagent/subagent/src/index.ts:150-167,292-294`；`manager.ts:1186-1206`；`tool-subagent-control/src/list-agents.ts:55-57`。
- F4.7 子「禁止 build/commit」没有内建机制；可用 prompt、`tools.restrict`、`tools/pre-execute` deny、preset 组合；都可被直接调用绕过。
  - 证据：`packages/core/tools/src/index.ts:697-706,724-732,608-612`；`child-agent.ts:171-175`。
- F4.8 无跨会话文件归属/写锁；只有 fs-local 的进程内 FIFO 与 stale-version。
  - 证据：`packages/fs/fs-local/src/index.ts:101-131,216-218,268-274`。

**promote**：Q5/Q6 结论 → DESIGN §1；D13/D14；§3.5–3.7；C3。

## R5 打包、安装、发布

- F5.1 可安装 bundle 的最小清单：`type:module` + `main` + `files` + `dsh.bundle.patch`；client 另需 `exports["./client"]` + `dsh.client.platform='web'`。
  - 证据：`docs/user/develop/basic/publish.md:33-44,56-62,120-134`；`~/.dsh/profiles/desktop/node_modules/dsh-better-sidebar/package.json`；`dsh-remote/package.json`。
- F5.2 `dsh plugin` 是 pnpm 直通；desktop 走 `runProfilePnpm`，成功后对账 `dsh.profile.bundles`；失败只恢复 `package.json` 与 lock。
  - 证据：`apps/cli/src/args.ts:187-202`；`apps/cli/src/plugin.ts:70-97`；`plugin-manager/src/operations.ts:88-113,285-537`。
- F5.3 desktop profile 的 CLI 管理要求 profile 已初始化并**完全退出 Desktop**；没有 rollback 动词。
  - 证据：`apps/cli/src/plugin.ts:10-14`；`plugin-manager/README.md:104`；`client/ui-plugin-manager/README.md:36,52-53,174`。
- F5.4 bundle patch 的 `insert` 追加行；无 `remove`，移除用 `disabled: true`；patch 覆盖整键。
  - 证据：`docs/user/develop/basic/publish.md:120-134`；`vendor/include/src/index.ts:57-127`。
- F5.5 版本：安装运行时 `0.2.1-rc.2`，cordis `4.0.5`；npm 上 `dsh-*` 的 `latest` 仍为 0.0.1-rc.1，`next` 为 0.2.1-rc.2；`dsh-longhaul` 未注册。
  - 证据：本机 `resources/runtime/versions.json`；`pnpm view` 实测（2026-10-22）。
- F5.6 `dsh.client.inject` 不排序激活；client bundle 由 `packages/client/modules` 从 Loader 条目发现。
  - 证据：`packages/client/modules/src/index.ts:844-879`；`packages/client/AGENTS.md`。

**promote**：Q9/Q10 结论 → DESIGN §1；D17/D18；§2；§6。

## 未决问题（M1 前需回答）

- O1 `plugin:longhaul/state` 记录在 `SESSION_FORMAT_VERSION` 升级时是否稳定保留？（当前证据：best-effort，sidecar 兜底）
- O2 子会话工具限制能否用 preset 的 `tools` 组合在 `startActivation` 时一次性施加（`agentPreset` 需 provider 支持）？
- O3 `/longhaul` 命令在已开始的会话里是否可见、能否跨 turn 持久（command 注册作用域）？
- O4 Web 端是否会转发插件发起的 `approval/request`（非工具调用）？若不转发，阶段审批必须始终包在工具里。
- O5 `dsh-better-sidebar` 的 tsdown 配置未随包发布，第三方 client 构建需要自建等价配置（M1b 验证）。

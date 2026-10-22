# dsh-longhaul 设计文档（M0 结论 + M1 增补）

> 版本：v0.2（2026-10-22，M0 调研完成，待审批）
> 上位决策：[HANDOVER.md](HANDOVER.md) 的 D1–D9 不可重新讨论。本文只做增补、记录冲突与实现选择。
> 证据：DSH fork `C:\data\project\thirdpart\deepseek-harness`（0.2.1-rc.2）；已安装桌面版同版本。
> 过程记录：[M0-REPORT.md](M0-REPORT.md)；新决策：[decisions.md](decisions.md)；分支发现：[findings/M0-research.md](findings/M0-research.md)。

## Status

- [x] M0 — 安装/卸载验证 + 十问答案 + 设计增补（文档审查完成；D10–D18 待最终批准）
- [ ] M1 — 模式 + 阶段状态机（**M1a host 核心完成**：阶段机/审批/记忆/预算/派发/门禁/命令；压缩实测、模型路由、client、子会话记忆待做）
- [ ] M2 — 树记忆
- [ ] M3 — 派发 + 预算
- [ ] M4 — 阶段交付件审批
- [ ] M5 — 发布

---

## 0. M0 结论（先看这里）

1. **空壳可安装、可卸载、安装后可解析**：`dsh plugin --profile desktop add` 成功把包以 `link:` 依赖装进 desktop profile，并把 `dsh-longhaul` 追加到 `dsh.profile.bundles`；卸载后 `package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、`node_modules` 与安装前逐字节一致。详见 [M0-REPORT.md](M0-REPORT.md)。
2. **十个问题全部有答案**（见 §1）。其中三项结论直接改变实现路线：
   - 第三方包**没有**通用的「当前会话模式」注册 API；权限选择器只有一个保留位 `auto`，且与 auto-review 争用。
   - 第三方**不能**安全地新增 required-on-read 的 session 事件类型；只能用 `plugin:` 前缀的 ignorable 记录。
   - DSH **没有**任何内建的步数/token/时间预算、文件归属或写锁；这些必须由插件自己实现。
3. **建议的 M1 路线**：插件自有模式入口（`/longhaul` 命令 + composer chip）＋ `systemPrompt` 动态 section 注入 ＋ sidecar 树记忆 ＋ 直接调用 `ctx.subagents.startActivation()` 派发 ＋ 自建预算/归属/门禁。不占用 permission picker，不用 goal-round-driver 当引擎。
4. **D7 需要一次显式确认**：D7 说「切到长任务模式即可，不再加开关」。DSH 的既有模式入口就是 permission picker，但第三方无法注册。因此「长任务模式」只能表现为插件自有入口（命令/客户端控件），这是**一个新开关**，但不是「额外开关」——它本身就是模式开关。记为冲突 C1（§4），不修改 D7。
5. **M0 空壳没有注册可见入口**：M0 的定义是「可安装空壳 + 十问 + 设计增补」；模式入口属于 M1。这是对 HANDOVER §7「只注册一个入口」的收窄，已记入 decisions D18，待批准。
6. **2026-10-22 追加并已批准**：阶段模型改为需求/设计/开发/交付四闸门，阶段末压缩上下文、设计变更环、按阶段选择模型强度（默认 inherit）。见 [§7](#7-阶段模型2026-10-22-已批准)；对应 decisions D19–D23。

---

## 1. M0 十问答案

### Q1 第三方包如何贡献一个「当前会话模式」入口？

**结论：没有受支持的通用注册面。**

- 权限模式（permission preset）是 DSH 唯一的「模式选择器」。服务 `ctx.permissionPresets`（`packages/interaction/permission-presets/src/index.ts:180`）导出的唯一运行期注册方法是 `registerAuto(admit)`（同文件 `:307-317`），只服务保留 id `auto`；第二次注册直接抛错。文档明确写着「Callers cannot publish another preset through a generic contribution API」（`docs/subsystems/permission-presets.md:49`）。
- `PresetSpec` 只有 `sandbox` 与 `approval` 两个机制旋钮，加可选 `name`/`description`（同文件 `:64-73`）；客户端只对 `danger-full-access` 和 `auto` 给图标、EXP 徽章与风险确认（`packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:28-38,49-51,133-138`）。第三方 id 只有 label/description。
- 静态路线存在：bundle patch 覆盖 `id: permission` 行的 config，把自定义 preset 写进表里（patch 会整体替换 config，必须重述全部 preset，`docs/user/develop/basic/publish.md:131-134`）。它是**全局配置**，不是「仅本会话」；而且会随 DSH 新增内置 preset 而漂移。
- auto-review 先例正是 `registerAuto` + `tools/pre-execute`（`packages/experimental/auto-review/src/index.ts:127,684-723`），它占用了唯一保留位。

**对设计的影响**：M1 不碰 permission picker。模式入口做成插件自有面：host 侧 `/longhaul on|off|status` 命令 + 客户端 composer chip；状态由插件记录，不改变会话权限。保留一个可选实验（D10 之外的后续版本）：用 bundle patch 增加 `longhaul` preset，仅作为「快捷切权限」而非模式开关。

### Q2 如何按会话注入模式指令？能否随开关动态生效？

**结论：可以，且是 DSH 设计好的路径；用 `systemPrompt.section` 动态 provider。**

- `ctx.systemPrompt.section({name, order, text})`（`packages/core/system-prompt/src/index.ts:478`）；`text` 可以是函数，每个 step 的 `assemble()` 重新求值（`:66,662`）。返回 `''` 即关闭该 section，空 section 在渲染时丢弃（`:290-295`）。plan-mode 正是这么做的（`packages/plan/plan-mode/src/index.ts:216-224`）。
- `AssembleContext` 带 `agent`（`packages/core/agent/src/runtime-types.ts:18-23`），provider 可以读 `context.agent.session` 判定模式。
- 稳定 prose 放 section；预算/阶段/记忆计数这类**变化值**放 `ctx.systemPrompt.context()`（`:513`），由循环以 `user/message` 形式发带来源的快照（`packages/core/agent-loop/src/agent.ts:427-440`），避免每步改写 system prompt。
- 「model-visible ⟺ logged」：section 内容在渲染时随 `system/message` 落盘（`agent-loop/src/agent.ts:416-424`），不需要额外事件；开关本身若不是日志可推导的，必须记录原因。plan-mode 用 `plan/mode` 事件（`:45-54,196-213`）+ 一次 `agent.inject` notice（`:463-474`）。
- 第三方**不能**照抄 `plan/mode` 这种 required 事件（见 Q4）。替代：`plugin:longhaul/state` ignorable 记录 + 释放型 `user/message` notice（`source:{kind:'plugin', plugin:'longhaul', form:'notice'}`）。notice 进入模型可见面，保证重建；记录用于审计与机器状态。

**对设计的影响**：M1 注册一个 `longhaul:policy` section（order=700，位于 PLAN_POLICY=500 与工具段 1000 之间），prose 来自 Config；再注册 `longhaul:state` context 输出阶段/预算/归属摘要。开关时发一条 notice 并写 plugin record。

### Q3 能否程序化发起审批（阶段交付件）？

**结论：可以，但必须在一个打开的 turn 内，且只有 `allowed-once` 算通过。**

- `ctx.approval.request({agent, toolName, callId?, reason?, displayReason?, signal?})`（`packages/interaction/user-approval/src/index.ts:215`），返回 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`（`types.ts:32`）。
- `toolName` 是自由字符串，可以传 `longhaul_submit`；`callId` 可省略。限制是必须在 open turn 内（`:84-92,217-223`），所以从工具体、`tools/pre-execute`、`agent/pre-step` 里调用都可以，空闲/后台不行。
- `never` 策略在服务内部直接拒绝，任何 `prepend` answerer 都绕不过（`:275`）；`ask` 且没有 answerer 时返回 `unavailable`（`:283`），fail-closed。审批只有一次性授权，不落持久 grant；`approval/asked`/`approval/decided` 只是日志审计（`:225-232`）。
- 工具调用路径同样走这个 seam（`packages/core/tools/src/index.ts:1735-1775`）。

**对设计的影响**：阶段审批实现为模型调用 `longhaul_submit` 工具；工具内部先落盘交付件，再 `ctx.approval.request`，`allowed-once` 才推进状态机。headless 下 `unavailable` 必须报错而不是静默推进。审批结果另外写入 sidecar，作为可审计的项目记录。

### Q4 自定义 session 事件类型是否可行、持久化、可被 sessionQuery 读到？

**结论：类型可以 merge，但运行时不可安全使用；只能用 ignorable 的 `plugin:` 记录。**

- `SessionEventMap` 是 merge-extensible（`packages/core/session/src/types.ts:494-517`），类型层面第三方可以声明。
- 但允许列表 `KNOWN_SESSION_EVENT_TYPES` 由本仓库的 map 生成（`known-event-types.ts:9-22`），挂载插件不能扩展。读路径对不在列表且 `ignorable !== true` 的事件**整份日志拒绝**（`packages/session/session-persistence/src/storage-contract.ts:69-80`）。也就是说，一旦写出 required 事件，插件自己的下一次恢复就失败。
- 官方第三方机制是 plugin record：`appendPluginRecord(session, 'plugin:<name>', data)`，强制 `ignorable:true`（`packages/core/session/src/index.ts:492-512,839-855`）；跨 fork/恢复/重开保留，但格式迁移只 best-effort 保留，可能丢失。**不进入模型面**。
- sessionQuery 能读原始事件（`listEvents`/`readEvent`），但文本检索对未知类型返回空（`packages/session-query/session-query/src/extraction.ts:15-44`），不会被索引。

**对设计的影响**：decisions/findings/artifacts 的权威存储改为 sidecar JSONL（`~/.dsh/longhaul/<rootSessionId>/`），并在会话里写 `plugin:longhaul/*` 记录作为审计锚点；**不新增 required 事件**。HANDOVER §4.2 的「若 M0 确认支持自定义事件则改事件存储」按此判定为否。

### Q5 派发时如何注入子 Agent 的 brief？

**结论：父直接调用 `ctx.subagents.startActivation()`，自己渲染 brief；不要包装工具。**

- `startActivation(spec)`（`packages/subagent/subagent/src/index.ts:255-284`）要求 `spec.request.parent` 是**当前存活的 Agent**，并找一个已注册 provider（spawn/fork）。
- brief 就是 `request.prompt: ContentBlock[]`，作为子会话第一条 user message 投递（`manager.ts:459-469`）。DSH 会在可见 `send_message` 时自动追加返回指引（`manager.ts:461-463`），子会自动回报父。
- `outputSchema` 会给子安装 `structured_output` 工具与终止守卫（`structured.ts:19-155`），父拿到 `SubagentResult.structured`。
- 也可以做 pre-step 替换或工具 shadow，但都更绕；直接调用服务最干净，也便于父在同一处做预算、扇出、文件归属检查。
- 子无法审批：子会话固定 `approvalPolicy:'never'`、来源 `delegation`（`child-agent.ts:243-253,273-274`）。

**对设计的影响**：`longhaul_dispatch` 工具由父调用，渲染自包含 brief（目标/交付物/文件归属/接口契约/验收命令/预算/禁止事项/返回 JSON schema），走 `startActivation`。子不获得派发工具。

### Q6 预算钩子：usage/turn/step 事件、取消与超时；如何中止子 Agent？

**结论：DSH 没有内建预算，必须自建；但有完整的观测与中止原语。**

- 事件：`turn/start|end`、`step/start|end`（`packages/core/session/src/types.ts:289-302`）、`tool/call|result`（`:362,376`）、`assistant/message` 上的 `usage`（`:342-350`）。没有 usage 投影或聚合服务。
- 计数：数 `step/start`；token 读 `assistant/message.usage`（input/output/cache 分开）。子作用域内 `child.ctx.on('session/event', ...)` 可实时计数（manager 自身也这么做，`activation.ts:130-143`）。
- 中止：`ctx.subagents.interrupt(sessionId, authority)` 内部 `agent.cancel({kind:'parent'},{keepInbox:true})`（`manager.ts:219-227`）；`activation.dispose()` 做完整 teardown（`manager.ts:1094-1184`）。没有内建超时，需要插件自己的计时器。
- 硬限制只有：`maxDepth`（默认 1，`index.ts:190`）、`maxActiveSubagents`（默认 8，`:187`）、单请求 `maxTokens`。
- 冷恢复会丢掉 activation 级旋钮，预算计数必须持久化到 sidecar（`descriptor.ts:14-19`）。

**对设计的影响**：预算模块按子树维护 `steps/tokens/turns/startedAt`，落 sidecar；80% 提醒子收敛（`sendMessage`），100% `interrupt` + 记录；父汇总未完成项。`maxActiveSubagents` 是全局 service 配置，M1 不覆盖它，改用插件自己的 fan-out 计数器（默认 6）。

### Q7 goal 能否程序化创建/推进？能否与 goal-round-driver 组合？

**结论：能创建，不能直接「推进一轮」；不建议把 driver 当长任务引擎。**

- `ctx.goals.create(agent, {objective, maxGoalRounds})` 是普通方法（`packages/goal/goal/src/index.ts:303`），追加 `goal/change` 并 arm。
- 推进轮次没有服务 API；driver 通过注入 `source.kind='goal'` 的 user message 实现（`packages/goal/goal-round-driver/src/index.ts:190-208`），只有被接纳的 goal 消息才推进 `roundsStarted`。
- driver 无配置、无 token/时间预算，只有 `maxGoalRounds`；加载时会 disarm 所有既有 goal（`:449-452`）；每轮会等待子 Agent 完成（`:177-181`），长任务会卡住；goal 是 per-session，子会话的工作对父不可见。
- 子会话不能创建/完成 goal（`tool-goal/src/authority.ts:80-118`）。

**对设计的影响**：v0 不用 goal 作为阶段推进引擎；阶段推进只认 `longhaul_submit` 的审批结果。可选：M1 用 goal 只做「可观测的长期目标」，不依赖 driver 推进。若未来要用，必须先解决预算与 per-session 可见性。

### Q8 客户端 UI：徽章/状态、设置页、`dsh.client.inject` 槽位、i18n？

**结论：可以，但需要独立 client 构建；没有通用「会话状态徽章」槽位。**

- 清单：`dsh.client { platform:'web', inject?, immediately?, external? }` + `exports["./client"]`；由 `packages/client/modules/src/index.ts:844-879` 发现，缺 `./client` 会直接报错。`inject` 只是信息性的，不负责激活顺序。
- 浏览器契约：模块注册 `window.__ModuleLoader__.load({id, factory(require){...}})`，返回 `{inject, apply(ctx)}`。
- 可用槽位（owner 声明）：`conversation.composer.dock`、`conversation.input.left|right|activity`、`conversation.session.header.actions|corner`、`settings.general.item`、`settings.section`、`plugins.item`、`shell.overlay`、`sidebar.toggle.badge`。没有会话级「模式徽章」专用槽；用 header corner 或 composer dock。
- i18n：`ctx.locale.register(ns, {zh,en})`（`packages/client/locale/src/client/index.ts:389`）或非类型化重载（`:399`）；slot 注册传 `locale`，渲染时得到 `t`。第三方用非类型化重载。产品文案必须走字典（repo 内由 `verify-client-ui-i18n` 强制）。
- 构建：`dsh-better-sidebar` 用 `tsc` 出类型 + `tsdown` 出 client bundle（其 package.json `scripts.build`），`files` 里带 `lib/client.js` 与 lazy chunks。client 改动需要重新构建产物，不能只改 TS 源。

**对设计的影响**：M1b 用 `conversation.input.left` 放 chip（阶段 + 预算），`settings.section` 放预算/风险设置；`shell.overlay` 放模式开启风险确认（D5）。文本 zh/en 字典化。

### Q9 独立包如何构建与发布？

**结论：ESM + `tsc`（host）+ `tsdown`（client）；peer 对齐 0.2.1-rc.2。**

- 最小可安装 bundle：`type:module` + `main` + `files` + `dsh.bundle.patch`（`docs/user/develop/basic/publish.md:33-44`）；patch 一条 `insert` 行即可。
- 有 client 时再加 `exports["./client"]` 与 `dsh.client.platform='web'`，二者必须一致（`scripts/verify-cordis-config.ts:106-119`）。
- `engines.dsh` 用 SemVer 范围；peer 依赖共享的 `@deepseek-ai/*` 包，同时放 `devDependencies`。类型导入尽量 `import type`，避免运行期重复实例。
- 版本事实：桌面版与 fork 都是 `0.2.1-rc.2`；`@deepseek-ai/cordis` npm latest = 4.0.5；`@deepseek-ai/dsh-*` npm `latest` 仍是 0.0.1-rc.1，`next` 才是 0.2.1-rc.2——peer 范围要写 `^0.2.1-rc.1`，并在 README 说明只支持 0.2.x 运行时。
- `dsh-longhaul` 在 npm 上 404（可注册），`publishConfig.access=public`。
- 版本从 `0.1.0` 起；`files` 带 `lib`、`cordis.patch.yml`、`locale/*.json`；CI Node 22/24 + `pnpm pack` 校验。

**对设计的影响**：M0 的 `tsconfig.json` 只覆盖 host；M1 增加 `tsconfig.build.json`/`tsdown.config.ts`、`locale/`、图标与 `exports["./client"]`。`package.json` 增加 `engines.dsh` 与真实 `peerDependencies`。

### Q10 已安装桌面版的安装/升级路径与回滚？

**结论：CLI 是 pnpm 直通 + profile bundle 对账；desktop profile 要求 Desktop 完全退出；没有回滚动词。**

- `dsh plugin` 把参数原样转给 pnpm（`apps/cli/src/args.ts:187-202`）；desktop 走 `runProfilePnpm`（`apps/cli/src/plugin.ts:70-97`），成功后把新 bundle 追加到 `dsh.profile.bundles`，移除时从 bundles 删除并恢复 `package.json`/`pnpm-lock.yaml`（`plugin-manager/src/operations.ts:88-113,285-537`）。
- 本地目录安装为 `link:`（实测 `dsh-longhaul 0.0.0 <- ..\..\..\..\..\data\project\dsh-longhaul`），peer 警告属预期（link 不解析 peer；运行时靠安装域）。
- 回滚：没有 `rollback` 动词；失败运行只恢复 manifest 与 lock，已下载模块保留；Plugins 页 Update = 卸载 + 安装，失败后处于未安装状态。只能靠固定版本 + 保留上一版 tarball 手工回装。
- **实测残留**：在 Desktop 运行中执行 CLI 卸载，`package.json`/lock/bundles 已还原，但 `node_modules\dsh-longhaul` junction 与 profile 根 `cordis.yml` 中的 `- id: longhaul` 行仍在（由运行中的 Desktop 镜像写入）。按 DSH 自身提示，desktop profile 的 CLI 管理必须在 Desktop 完全退出后执行（`apps/cli/src/plugin.ts:10-14`）；本次已手工清理并验证 profile 与安装前逐字节一致。
- 升级路径：Plugins 页或 CLI 卸载后重装；安装新版本前先看 `pendingBuilds`/版本兼容策略（`engines.dsh` 优先，`includePrerelease`）。

**对设计的影响**：README 必须写清「退出 Desktop → CLI 安装/卸载 → 重启」；提供 `scripts/verify-install.ps1`（M1）做可复现检查；发布说明写不支持原地升级/回滚。

---

## 2. 安装验证记录（摘要）

完整命令、时间戳与文件对比见 [M0-REPORT.md](M0-REPORT.md)。

| 步骤 | 结果 |
|---|---|
| `dsh plugin --profile desktop add C:\data\project\dsh-longhaul` | exit 0；依赖 `dsh-longhaul link:C:/data/project/dsh-longhaul`；`dsh.profile.bundles` 追加 `dsh-longhaul`；lock 新增 link 条目 |
| 模块解析 | `node -e "import('.../lib/index.js')"` → `apply,inject,name`，`name='longhaul'`，`inject=[]` |
| `dsh plugin --profile desktop remove dsh-longhaul` | exit 0；deps/bundles/lock 还原 |
| 清理残留（junction + cordis.yml 行） | 完成；`package.json`/`pnpm-lock.yaml`/`cordis.yml`/`cordis.patch.yml`/`node_modules` 与安装前逐字节一致 |
| 环境说明 | 本机 PATH 无 pnpm、fork 无 `node_modules`；使用桌面版自带 CLI（0.2.1-rc.2，内置 pnpm 11.28.5），未修改 fork |

**未验证项**：安装后「模式入口可见」需要重启 Desktop 且 M1 才有入口；本次按 M0 收窄不注册入口。

---

## 3. M1 设计增补

### 3.1 状态模型

- 模式作用域：**根会话**（`session.header.parentSession === undefined`）。命名空间 `longhaul:<rootSessionId>`。
- 持久状态：`~/.dsh/longhaul/<rootSessionId>/state.json`（原子写）：
  - `mode: 'off' | 'on'`、`stage: 'S0'...'S5'`、`taskTree`、`budget`、`fileOwners`、`pendingApproval`、`milestones`、`version`。
- 会话内审计：`appendPluginRecord(session, 'plugin:longhaul/state', {mode, stage, ...})`（ignorable，不进入模型面）；模式开关另发一条 `user/message` notice，保证模型可见面可重建。
- 恢复顺序：最新 `plugin:longhaul/state` 记录 → sidecar → 默认 off。记录丢失时 sidecar 为准，并在 UI 标注「审计记录缺失」。

### 3.2 阶段机（S0–S5）

```
S0 Plan → S1 Analyze → S2 Design → S3 Implement → S4 Test → S5 Ship
```

- 只允许相邻推进；任何推进必须同时满足：交付件文件已落盘 + `longhaul_submit` 审批返回 `allowed-once` + 状态记录成功。
- 拒绝：停留原阶段，记录 reason，返回结构化拒绝给模型；不允许自动重试超过 2 次。
- 回退：S4 失败回 S3；S3 发现设计缺陷回 S2；每次回退写一条 `finding` 与状态记录。
- **反许愿式编程执行点**：`tools/pre-execute` 在 `stage < S3` 时拒绝写实现文件（允许写 `.longhaul/` 交付件目录）；`stage === S3` 但 plan 未批准时同样拒绝。
- 交付件路径：`<workspace>/.longhaul/deliverables/NN-<stage>.md`（可配置），内容模板由配置提供。

### 3.3 交付件与审批

- 工具 `longhaul_submit(stage, deliverablePath?, summary)`：
  1. 校验阶段与文件存在、非空、含必需小节（模板校验）。
  2. 写 sidecar `artifacts` + `plugin` 记录。
  3. `ctx.approval.request({agent, toolName:'longhaul_submit', reason, displayReason:{zh,en}})`。
  4. 仅 `allowed-once` 推进；`rejected/cancelled/unavailable` 都返回失败并保持阶段。
- 审批不落持久 grant；恢复后如处于「已提交未审批」状态，重新请求。
- headless：`unavailable` → 明确报错「没有审批通道」，不推进（D6 的 fail-closed）。

### 3.4 树记忆与 ACL

存储：`~/.dsh/longhaul/<rootSessionId>/{decisions,artifacts}.jsonl` + `findings/<sessionId>.jsonl`。
记录字段：`{id, authorSessionId, time, version, tags, supersedes?, text, evidence?}`；不可变，更新 = 追加新版本 + `supersedes`。

| 层 | 读 | 写 |
|---|---|---|
| decisions | 全树 | 仅根/父；子只能 promote 请求（写 finding 由父转正） |
| findings | 自己 + 后代（本分支） | 作者 append-only |
| artifacts | 全树 | 父/集成子 |

- 实现：读时按会话祖先链过滤；写时校验 `authorSessionId` 与目标路径；跨树（root 不同）一律拒绝。
- 子不能修改他人记录：文件按作者分片，父 promote 时写 decisions 并保留 `sourceFindingId`。
- 注入：`systemPrompt.context` 只注入摘要（decisions 最近 N 条、本分支 findings 最近 M 条），完整内容通过 `longhaul_memory` 工具按需读取。

### 3.5 派发与 brief

- 工具 `longhaul_dispatch(tasks[])`：校验 fan-out、depth、文件归属，渲染 brief，调用 `ctx.subagents.startActivation({provider:'spawn', request:{parent, prompt, outputSchema, maxDepth}})`。
- brief 固定小节：目标、交付物、文件归属（精确路径/glob）、接口契约、验收命令、预算、禁止事项、返回 JSON schema（`summary` ≤ 800 字、`files`、`tests`、`blockers`、`evidence`）。
- 子返回结构化结果；父汇总并写 artifacts。
- 子不获得 `longhaul_dispatch` / `longhaul_submit` / 集成工具；通过子 ctx 的 `tools/pre-execute` 守卫 + 指令双保险。

### 3.6 预算与核算

配置默认（D4）：`childSteps: 60`、`fanout: 4–6`（默认 6）、`maxDepth: 1`、`totalSteps?`、`tokenBudget?`。
- 计数：子会话 `step/start`；`assistant/message.usage` 累加 input/output/cacheRead；父每 5s 或事件驱动更新 sidecar。
- 80%：`sendMessage` 提醒子收敛；100%：`interrupt` + 记录 `budget-exhausted`；父汇总未完成项。
- 超总预算：停止派发，只允许父做集成与汇报。
- 报告：`longhaul_status` 输出子树步数/token/子数/剩余；数字必须能对上子会话日志（验收项）。

### 3.7 集成门禁与文件归属

- 只允许父/集成子：`build`、`verify`、`git commit`、`git push`、`npm publish`。实现：`tools/pre-execute` 对子会话的 shell 工具做命令匹配拒绝；父不受限。
- 文件归属：父维护 `fileOwners: path → sessionId`；派发前检查重叠，冲突拒绝；工具执行时若路径属于他人则拒绝。
- 已知缺口：DSH 无跨会话写锁，fs-local 只有进程内 FIFO + stale-version 检查（`packages/fs/fs-local/src/index.ts:101-131,216-218`）。插件层归属是**协作约束**，不是安全边界；验收只要求「冲突被拒绝」，不承诺杜绝竞态。

### 3.8 指令注入

- section：`longhaul:policy`，order 700；prose 来自 Config（阶段规则、交付件要求、预算纪律、记忆 ACL、门禁）。
- context：`longhaul:state`，输出 `stage / remaining steps / active children / pending approval`。
- 模式关闭时 section 返回 `''`；开启后下一步的 `system/message` 快照即包含 policy。
- 开启/关闭发 notice（zh/en），内容固定、可审计。

### 3.9 客户端 UI（M1b）

- chip：`conversation.input.left`，显示 `Long Haul · S2`，点击打开状态面板；`shell.overlay` 打开 D5 风险确认（首次开启，一次）。
- 设置：`settings.section` 暴露预算、扇出、交付件目录；配置变更写 cordis 配置由 host 重新读取（M1 先只读展示）。
- 文案：`ctx.locale.register('longhaul', {zh, en})`；不硬编码。
- 构建：`tsdown` 出 `lib/client.js`（`window.__ModuleLoader__` 包装）；`package.json` 增加 `exports["./client"]`、`dsh.client`、`files`。
- 降级：client 不可用时 `/longhaul` 命令仍可完整操作模式（host-only）。

### 3.10 失败与恢复

- 模式状态机每一步先写 sidecar 再发事件；写失败即中止该步，不推进。
- 会话恢复：从 sidecar + plugin record 重建；若审批进行中，标记 `interrupted` 并要求重新提交。
- 预算/归属数据损坏：fail loud，停止派发，输出损坏路径，要求人工确认。
- 插件卸载：不删除 `~/.dsh/longhaul`（用户数据），README 提供清理命令。

### 3.11 配置项（全部来自 cordis Config，无硬编码）

`enabledByDefault`（默认 false）、`deliverableDir`、`stageTemplates`、`childStepBudget`、`fanout`、`maxDepth`、`totalStepBudget?`、`tokenBudget?`、`approvalTimeoutMs`、`integrationCommands`、`client.enabled`。

---

## 4. 与 D1–D9 的一致性与冲突

| 决策 | 状态 | 说明 |
|---|---|---|
| D1 树形治理 | 一致 | 根会话命名空间、父派发、depth 1、兄弟隔离 |
| D2 C 模型 | 一致 | decisions 全树只读、findings 分支、父 promote |
| D3 写权限 | 一致 | 子 append-only；decisions 仅父 |
| D4 预算默认 | 一致 | 60 步 / 扇出 6 / depth 1，全部 Config 可调 |
| D5 自动派发 + 风险说明 | 一致 | 模式开启时客户端风险确认；自动拆解派发 |
| D6 反许愿式编程 | 一致 | S2 批准前拒绝实现写入 |
| D7 模式入口 | **冲突 C1** | DSH 无第三方模式注册；改为插件自有入口（命令 + chip），见 §1 Q1 |
| D8 独立仓库 + 发布 | 一致 | 名称可用、发布清单见 Q9 |
| D9 v0 不做 | 一致 | 全局记忆、无人审批、模型分层均不做 |

**C1 记录（不改 D7）**：D7 的目标是「用户只做一次模式切换，不加第二个开关」。插件自有入口满足目标语义，但入口形态不是 permission picker。若未来 DSH 开放 preset 注册，再迁移。

---

## 5. M1 范围与验收（待批准后执行）

**M1a（host，先做）**
1. `src/{config,state,stages,memory,budget,dispatch,tools,guidance}.ts` + `tests/unit/*`。
2. bundle patch 注册插件行与工具；`/longhaul` 命令。
3. 真 Loader 组合测试（test-only `cordis.yml`）：插件挂载、section 注入、工具可见、模式开关落盘。
4. 验收：未批准计划前写实现被拒绝；每阶段交付件 + 审批；退出/恢复；预算超限停止并汇报；子只读本分支 findings；decisions 全树可见；跨树拒绝。

**M1b（client，随后）**
5. chip + 风险确认 + 设置页；zh/en；构建产物。
6. 验收：Desktop 重启后入口可见；模式切换有风险确认；状态与 host 一致。

**M1 完成定义**：上述验收 + `pnpm typecheck/test/build` + 安装/卸载复现 + 文档更新。

---

## 6. 风险

| 风险 | 等级 | 对策 |
|---|---|---|
| 上游 API 预发布、无兼容承诺 | 高 | peer 范围 + CI 版本矩阵 + 只 import type；升级前跑真 Loader 冒烟 |
| 无第三方模式 API（C1） | 中 | 自有入口 + 命令降级；跟踪 DSH 变更 |
| 审批在 headless 不可用 | 中 | fail-closed + 明确报错；文档写清 Web/ACP 前提 |
| plugin record 迁移可能丢 | 中 | sidecar 为权威；记录仅审计 |
| 预算只有步数近似 | 中 | token 也计；超限 abort；报告标注口径 |
| 文件归属非强锁 | 中 | 冲突拒绝 + 单写者调度 + 文档声明边界 |
| Desktop 运行中安装产生残留 | 中 | README 强制「退出 Desktop」；安装脚本检测进程 |
| token 放大（子会话重放） | 高 | 扇出/步数硬限 + 父集成 + brief 精简 |

---

## 7. 阶段模型（2026-10-22 已批准）

> 来源：项目负责人提出的三阶段模型（需求 / 设计 / 开发）与阶段末上下文压缩、分支合并、设计变更环。
> 结论：**思路成立，可以融入插件**；DSH 已有压缩、模型选择、会话 fork 的原语。需要把它落成 4 个阶段、1 个变更环和 3 条策略；其中「模型强度」越过 D9 的 v0 边界，需新决策。

### 7.1 为什么成立

1. 阶段特征确实不同：需求期是低频、纯对话、几乎不调工具；设计期是读代码 + 方案比较；开发期是高频工具调用 + 异常处理 + 集成。统一的预算、审批节奏和上下文策略对三者都不最优。
2. 成本证据支持「阶段末压缩」：上一轮实测中 cacheRead 占总 token 的 98.9%，子会话每步重放整段历史。需求/设计的长对话在阶段结束后继续留在上下文里，只会放大后续每一步的重放成本。
3. DSH 提供了原语，不需要改上游：
   - **压缩**：`ctx.compaction.compactNow(agent, signal)` 把一个区间的可见历史替换为一个摘要节点，原始事件仍留在日志里（`packages/compaction/compaction/src/index.ts:162-192`；`command-compact/src/index.ts:67`）。摘要器沿用会话自己的 system prompt 与消息前缀，只追加固定压缩指令，KV-cache 友好（`compaction-basic/src/summarizer.ts:27-28,75-111`）。
   - **模型选择**：`ctx.sessionController.selectModel({sessionId, provider, model, reasoningEffort})` 在会话内切换下一次请求的模型，并追加持久事件 `model/selection`（`packages/api/session-controller/src/commands.ts:157-191`；`agent.ts:339-342`）。
   - **分支**：`ctx.subagents.startActivation()` 支持 spawn（干净上下文）与 fork（继承父会话已完成轮次前缀，`subagent-fork-in-process/src/index.ts:34-68`）；`sessionController.fork()` 还能从任意事件前缀派生一个普通会话（`commands.ts:227-310`）。
4. 这与 D1–D3 不冲突：分支的 process 可以丢，但 decisions/findings/artifacts 仍然按 C 模型落盘；丢的是「聊天过程」，不是「结论」。

### 7.2 阶段与交付件

保留 4 个外部闸门，原 S0–S5 变成阶段内部子步骤：

| 阶段 | 交互方式 | 关键交付件 | 工具权限 | 上下文策略 | 模型角色 |
|---|---|---|---|---|---|
| P0 需求 | 对话、提问、澄清；**不写代码** | `00-requirements.md`（目标/范围/非目标/验收/约束/风险/预算）+ 任务计划（任务树、文件归属、里程碑） | 只读 + 提问 + 记忆 | 审批后压缩 + handoff | 强推理、低工具频率 |
| P1 设计 | 读代码、调研、方案对比；可写设计文档 | `01-design.md`（架构/模块/接口/数据模型/ACL/状态机/依赖选型/失败路径/测试策略）+ ADR | 只读 + 写交付件 + web | 审批后压缩 + handoff | 强推理、中工具频率 |
| P2 开发 | 自动派发、工具密集、异常处理、集成 | 代码 + `02-implementation.md`（变更清单、测试计划与证据、回滚方案）+ 工程日志 | 父：全工具；子：受限 + 禁止集成命令 | **保留细节**；只在压力/溢出时压缩；关键报错与决策进 findings | 父：强决策；子：快速执行，失败升级 |
| P3 交付 | 清单确认、发布 | 版本、CHANGELOG、发布记录、验收证据 | 仅父 | 最终摘要 | 强 |

- 「开发期包含测试」：测试作为 P2 的内部子状态（implement → verify → test → integrate），对外只有 P2 完成审批；不再单独设 S4 闸门。
- 每个交付件有模板与必填小节；缺小节不允许提交审批。
- 审批仍用 `longhaul_submit` + `ctx.approval.request`，只有 `allowed-once` 推进（D6 不变）。

### 7.3 上下文策略（核心）

阶段切换的固定顺序，缺一不可：

```
交付件落盘并通过结构校验
  → 追加交接消息（handoff，见下）
  → 等 agent 空闲
  → compactNow(agent)
  → 再追加一条 handoff（保证它在压缩之后，不被摘要覆盖）
  → 进入下一阶段
```

- 为什么不能只靠摘要：压缩指令是固定的（`summarizer.ts:63` 要求「忠实保留用户反馈与显式指令」），但摘要仍是模型生成，可能丢掉具体路径、命令、验收标准。**交付件文件才是权威**；handoff 消息只带指针与硬约束。
- handoff 内容（固定模板，写入 `user/message`，`source:{kind:'plugin', plugin:'longhaul'}`）：
  - 当前阶段、下一阶段、交付件绝对路径与版本；
  - 必读 decisions（id 列表）；
  - 未决问题与风险；
  - 本阶段验收命令；
  - 预算剩余。
- P0/P1 结束：`compactNow`（让后端选区间）。
- P2 结束：默认不压缩；若 token 超阈值，用 `compactNow` 保留近期窗口，工程细节已在 findings/artifacts 中。
- 压缩只改变「可见面」，日志仍完整保留，可被 `sessionQuery` 读回审计。对外话术是「过程从上下文退场」，不是「删除历史」。
- 触发时机：审批工具返回后设置 `pendingCompaction`，在 `turn/end` 上用 `agent.runMaintenance(() => compactNow(...))` 执行；若被新输入抢先，顺延到下一次 idle（`runtime-types.ts:202`）。

### 7.4 分支与合并

- 默认 `spawn`：父渲染 brief，子拿干净上下文；适合大多数开发任务，token 最省。
- 需要完整上下文的探索/重构才用 `fork`：子继承父已完成轮次前缀（`subagent-fork-in-process`），成本更高，必须显式在任务计划里声明。
- 分支结束：子返回结构化摘要 + findings；父做三件事——(a) 把结论 promote 到 decisions/设计文档；(b) 若设计文档变化，走 DCR（见 7.5）；(c) 更新任务树与文件归属。
- **不 fork 根会话做阶段切换**：`sessionController.fork()` 会生成新的 session id，破坏 `longhaul:<rootSessionId>` 命名空间、用户历史与预算核算。阶段切换用压缩，不用换会话。

### 7.5 设计变更环（DCR）

开发期发现设计问题，是正常路径，不是异常：

```
P2 执行 → 发现设计缺陷
  → longhaul_change_request(证据, 影响面, 建议)
  → 暂停受影响任务（未受影响的继续）
  → 回 P1 局部：更新 01-design.md + ADR（版本 +1）
  → 审批（设计变更）
  → 重新派发受影响任务
```

约束：
- DCR 必须带证据（失败命令/日志/反例）与影响面（文件、接口、测试）；
- 只回退受影响的任务，不做全量重跑；
- 每个任务最多 2 次 DCR，超过升级用户决策；
- 设计文档每次变更写 `supersedes`，保留历史；
- DCR 不计入「阶段失败」，但计入预算与审计。

### 7.6 模型强度策略（触碰 D9）

- 需求/设计：强模型 + 高 reasoning effort；工具少，成本可控。
- 开发：父用强模型做拆解、集成、冲突决策；子用快速模型做机械执行；连续失败/高不确定性时升级到强模型。
- 交付：强模型做验收与发布检查。
- 实现：
  - 父会话：`ctx.sessionController.selectModel({sessionId, provider, model, reasoningEffort})`（持久 `model/selection`）。
  - 子会话：`startActivation` 的 `agentOptions` 直接指定 provider/model/reasoningEffort。
  - 摘要：`compaction` 的 `summarizationProvider/summarizationModel` 可单独选便宜模型（`compaction-basic/src/config.ts:102`）。
- 边界：这是**静态阶段映射**，不是自演进；但 D9 明确 v0 不做「模型分层」。因此：
  - 默认 `modelPolicy.mode = 'inherit'`（不切模型），只保留配置与接口；
  - 开启 = 新决策 D21，需明确批准；
  - 任何切换都必须写进会话日志（`model/selection` 已自动记录）并可回滚。
  - **2026-10-22 批准**：D21 生效，默认 `inherit`；启用是显式配置，不改变默认行为。

### 7.7 与 D1–D9 的关系

| 决策 | 影响 |
|---|---|
| D1/D2/D3 | 不变；阶段模型只改流程，不改树治理与记忆 ACL |
| D4 | 不变；60 步/扇出 6/depth 1 仍是默认，P0/P1 工具少自然用不满 |
| D5 | 不变；风险确认仍在模式开启时 |
| D6 | **不冲突**：D6 只要求「计划/分析/设计批准前禁止实现、每阶段交付件 + 审批」；4 阶段满足，S0–S5 降为内部子步骤 |
| D7 | 不变；入口仍是自有命令 + chip |
| D8 | 不变 |
| D9 | **冲突 C4**：模型分层属于 v0 排除项；提案默认关闭，开启需 D21 |

### 7.8 落地拆分与先行 spike

**可直接进入 M1 的部分**
- 4 阶段状态机、交付件模板、审批、工具权限、预算、记忆；
- handoff 消息模板与落盘顺序；
- DCR 状态与任务暂停/恢复；
- 子 Agent 的 `agentOptions` 与 spawn/fork 选择。

**必须先 spike 的三件事**
1. `compactNow` 在 `turn/end` + `runMaintenance` 下的实际行为：是否稳定、失败如何回滚、摘要是否保留交付件指针（用真实会话录一次）。
2. `sessionController.selectModel` 的副作用：它会把选择保存为**全局默认模型**（`commands.ts:177`），阶段切换是否需要恢复原默认值；在 headless/TUI 组合里该服务是否存在。
3. `fork` 与 `spawn` 的成本/收益：fork 继承前缀的 token 代价 vs brief 的信息损失；至少用两个真实任务对比。

**验收补充**
- P0/P1 结束后，下一阶段的模型请求中不再包含阶段内的逐条对话（可用 `request/header` + 日志验证）；
- handoff 中的交付件路径与 decisions 在下一阶段可被模型正确引用；
- DCR 后只重跑受影响任务，设计文档版本递增；
- 模型策略关闭时，行为与「无该功能」完全一致。

### 7.9 风险

| 风险 | 对策 |
|---|---|
| 摘要丢关键约束 | 交付件为权威 + 压缩后 handoff + 必读 decisions |
| 压缩不可逆的错觉 | 日志仍保留；文档写明「可见面退场」；提供导出/检索 |
| 模型降档导致开发质量下降 | 默认 inherit；按任务类型灰度；失败升级 |
| 阶段切换时 agent 忙 | pendingCompaction + idle 重试；不阻塞用户输入 |
| DCR 无限循环 | 每任务 2 次上限 + 影响面审批 + 预算计入 |
| 需求期仍写代码 | P0/P1 用 `tools/pre-execute` 拒绝写实现文件（只允许交付件目录） |

---

## 8. 证据索引

- 模式/UI：`packages/experimental/auto-review/src/index.ts`；`packages/interaction/permission-presets/src/index.ts`；`packages/client/ui-permission-presets/src/client/*`；`docs/subsystems/permission-presets.md`；`docs/subsystems/slots.md`。
- 指令：`packages/core/system-prompt/src/index.ts`；`packages/plan/plan-mode/src/index.ts`；`packages/core/agent-loop/src/agent.ts`。
- 审批/事件/会话查询/goal：`packages/interaction/user-approval/src/*`；`packages/core/session/src/{types,index,known-event-types}.ts`；`packages/session/session-persistence/src/storage-contract.ts`；`packages/session-query/session-query/src/*`；`packages/goal/*`。
- 派发/预算：`packages/subagent/*`；`packages/core/agent/src/runtime-types.ts`；`packages/fs/fs-local/src/index.ts`。
- 打包/安装：`packages/boot/plugin-manager/src/*`；`apps/cli/src/{args,plugin}.ts`；`docs/user/develop/basic/publish.md`；`~/.dsh/profiles/desktop/node_modules/dsh-better-sidebar/package.json`。
- 安装实测：本机 `C:\Users\dai\.dsh\profiles\desktop`，2026-10-22 15:09–15:22。

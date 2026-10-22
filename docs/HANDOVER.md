# dsh-longhaul 交接文档

> 版本：v0.1（2026-10-22）  
> 来源：DeepSeek Harness 主会话（daimonkey 项目）设计与讨论  
> 目标读者：在新仓库中接手调研、设计与实现的工程师 / AI Agent  
> 本文档是**决策输入**，不是讨论稿；第 1 节已定事项不要重新论证。

---

## 0. 一句话

`dsh-longhaul` 是 DeepSeek Harness（DSH）的一个**长任务模式插件**：安装后，会话切换或开启「长任务」模式，即进入一种“像人一样工作”的状态——先计划、再分析、再设计、再实现与测试，每个阶段自动产出交付件并走审批；它会按会话树自动派发子 Agent、按预算约束、共享结构化记忆，而不需要用户频繁催促“去建子 Agent”。

它不是“记忆插件”，也不是“全局记忆”。记忆只是它治理能力的一部分。

---

## 1. 已定决策（不再讨论）

| # | 决策 | 说明 |
|---|---|---|
| D1 | **树形治理** | 派发权在父；记忆作用域 = 根会话；兄弟默认隔离；跨树不共享 |
| D2 | **记忆可见性 = C 模型** | 决策（decisions）全树只读；发现（findings）仅本分支；父可提升（promote） |
| D3 | **写权限** | 子 **append-only findings**；仅父可写 decisions；子不得修改他人结论 |
| D4 | **预算默认值** | 每子 60 步、扇出 4–6、depth 1（均可在配置中调整） |
| D5 | **v0 自动派发** | 模式开启后自动拆解/派发，不再逐步询问；但开启时必须弹出风险与代价说明 |
| D6 | **默认反“许愿式编程”** | 未通过计划/分析/设计审批前，禁止进入实现；每个阶段都要提交交付件并审批 |
| D7 | **模式入口** | 安装插件后，只切到「长任务模式」即可，不再额外加开关 |
| D8 | **独立仓库 + 发布** | 新 GitHub 仓库，目标是可发布 npm 包；DSH 源码 fork 位于 `C:\data\project\thirdpart\deepseek-harness` |
| D9 | **v0 不做** | 全局记忆、无人审批的全自动、模型分层/自演进（放 v1/v2） |

---

## 1.1 命名约定（2026-10-22 定稿）

| 层 | 名称 |
|---|---|
| npm 包 / GitHub 仓库 | `dsh-longhaul`（`csoulnd/dsh-longhaul`） |
| 模式 | 中文「长任务模式」；英文 `Long Haul` |
| 工具前缀 | `longhaul_*`（如 `longhaul_plan` / `longhaul_submit` / `longhaul_status`） |
| 记忆层 | `brief` / `decisions` / `findings` / `artifacts` |
| 阶段 | Plan → Analyze → Design → Implement → Test → Ship（对应计划/分析/设计/实现/测试/交付） |
| 命名空间 | `longhaul:<rootSessionId>`；存储 `~/.dsh/longhaul/<rootSessionId>/` |

> 选名理由：`long-haul` 直接表达“长周期任务”，短、独特、不与 DSH 现有 `workflow`/`goal`/`agent-team` 撞名；npm 与 GitHub 同名均可用。
## 2. 为什么做：本会话的真实成本证据

在 daimonkey 项目中，一次多 Agent 协作产生了以下数据（解析 `~/.dsh/sessions/.../session.v4.jsonl.zstd` 的 `usage` 事件）：

| 指标 | 数值 |
|---|---|
| 会话总数 | 31（28 子 + 1 主 + 2 空占位） |
| 总 token（含缓存读） | 441.8M |
| 子会话占比 | **83.7%** |
| 总步数 / 子会话平均步数 | 2,895 / **94** |
| 缓存读占比 | **98.9%** |
| 未缓存输入 / 输出 | 2.8M（0.64%） / 2.0M（0.46%） |
| Top5 会话占比 | 56.3% |
| 超 100 步的子会话 | 10 个（其中 2 个 > 200 步） |

结论（重要）：
1. 子 Agent 确实消耗大头，但主因是**每个子会话“每步重放整段历史”**（cacheRead），不是“没共享记忆”。
2. 记忆共享主要能减少：重复读规范、重复发现、决策漂移、返工；**不能**显著降低单会话历史重放。
3. 因此本插件必须同时做**编排与预算**（控步数、少开子会话、父统一集成），而不能只做记忆。

---

## 3. 产品定义

### 3.1 模式行为

开启「长任务模式」时：

1. 弹出一次性风险说明（进入模式前，不重复打扰）：
   - 会自动创建子 Agent、产生额外 token；
   - 会按阶段自动提交交付件等待审批；
   - 可能修改代码/文件，但构建、提交、发布仍受父节点门禁；
   - 可随时退出该模式。
2. 注入长任务工作规范（system guidance）：阶段、交付件、预算、树记忆、集成门禁。
3. 启动阶段状态机（见 3.2）。
4. 用户只描述目标；后续由模式驱动，不要求用户反复说“创建子 Agent”。

### 3.2 阶段化工作流（v0 核心）

```
S0 计划（Plan）
  → 交付件：目标、范围、任务树、文件归属、预算、验收标准、风险
  → 审批通过才进入 S1
S1 分析（Analyze）
  → 交付件：代码/数据调研结论、依赖与约束、未知项、影响面
  → 审批通过才进入 S2
S2 设计（Design）
  → 交付件：接口/数据模型/ACL/状态机/失败路径/里程碑拆分
  → 审批通过才进入 S3
S3 实现（Implement）
  → 按任务树自动派发子 Agent；父集成；每个子有 brief 与交付物
  → 交付件：变更清单、测试计划、回滚方案
S4 测试（Test）
  → 单元/集成/端到端/验收；证据（日志、截图、命令）
  → 不通过则回到 S3 修复，不允许“跳过”
S5 交付（Ship）
  → 版本、CHANGELOG、README、发布清单、npm/仓库发布
```

规则：
- **每个阶段结束自动提交交付件并请求审批**；审批通过才进入下一阶段。
- 没有计划审批，禁止写实现代码（反许愿式编程）。
- 阶段交付件落盘（建议 `deliverables/NN-stage.md`），可追溯、可回滚。
- 任何阶段失败：记录阻塞原因，回退到上一阶段或请求用户决策，不允许静默跳过。

### 3.3 自动派发与树治理

- 父 Agent 持有任务树与预算；子 Agent 默认不再派发（depth=1，可配置到 2）。
- 每个子必须拿到自包含 **brief**：目标、交付物、文件归属、接口契约、验收命令、预算、禁止事项。
- 父按任务树自动派发；扇出上限 4–6；同一文件同一时间只允许一个写者。
- 父负责集成：构建、`verify`、提交、发布只由父或指定集成子执行；子只跑局部测试。
- 子完成后返回结构化摘要（≤N 字）+ 证据路径，不贴长日志。

### 3.4 自演进路线（v1/v2，先留接口）

- v1：按任务类型选择 thinking effort（简单任务低档、复杂任务高档）。
- v1：按任务类型选择子 Agent 模型档位（DSH 的 subagent `agentOptions` 已支持 provider/model）。
- v2：从历史 run 统计中学习拆解粒度、预算与失败模式。
- 约束：任何自演进策略必须可解释、可关闭、可回滚；不得绕过阶段审批与预算。

### 3.5 非目标（v0）

- 不做全局记忆、不跨会话树共享。
- 不做无人审批的完全自治。
- 不做通用工作流引擎（复用 DSH `workflow` 的范式，不重造）。

---

## 4. 架构设计

### 4.1 会话树

- 根：主会话（root session id）。
- 节点：子 Agent 会话；DSH 已有 `parentSession` 与 `delegationDepth` 元数据。
- 命名空间：`longhaul:<rootSessionId>`。
- ACL：
  - 读 decisions：祖先链 + 后代（整棵树）
  - 读 findings：仅本分支（自己 + 自己的后代）
  - 写 decisions：仅根/父（promote）
  - 写 findings：任意节点只 append
- 跨树：拒绝。

### 4.2 记忆三层

| 层 | 内容 | 可见性 | 写入 |
|---|---|---|---|
| decisions | 约束、文件归属、接口契约、验收命令、阶段结论 | 全树只读 | 父 promote |
| findings | 子发现的坑、临时结论、失败原因 | 本分支 | 子 append |
| artifacts | 交付件路径、commit、测试证据 | 全树只读 | 父/集成子 |

存储建议：
- 优先 sidecar JSONL：`~/.dsh/longhaul/<rootSessionId>/{decisions,findings,artifacts}.jsonl`，带 `id/author/sessionId/time/version/tags`。
- 若 M0 确认 DSH 支持自定义 session event 类型并可从 `sessionQuery` 读取，则改为事件存储，便于 `session_search`/`session_reference` 复用。
- 每条记录不可变；更新 = 追加新版本 + `supersedes`。

### 4.3 预算与核算

- 预算维度：步数、工具调用数、子 Agent 数、token（输入+输出+缓存读分开计）。
- 超限行为：停止派发、要求子收敛汇报、父汇总“未完成项”。
- 核算：按子树累计 usage（父可从会话日志/usage 事件读取），输出报告。
- 默认：每子 60 步；扇出 4–6；depth 1；总预算由计划阶段声明并经审批。

### 4.4 集成门禁

- 只有父（或显式指定的集成子）可以：`--build`、`verify`、`git commit`、`git push`、发布。
- 子只能：读、改自己归属的文件、跑局部测试。
- 并发写冲突检测：父维护“文件 → 当前写者”，冲突即拒绝派发或串行化。

---

## 5. DSH 集成点（精确到包）

> 源码 fork：`C:\data\project\thirdpart\deepseek-harness`（pnpm monorepo，Cordis 插件框架）

### 5.1 插件加载与安装

- 插件是 Cordis 插件；独立 npm 包通过 profile 安装。
- 用户 profile：`~/.dsh/profiles/desktop`（或 `web`），`package.json` 的 `dsh.profile.bundles` 列出 bundle 顺序。
- 第三方插件示例：`dsh-better-sidebar`、`dsh-remote`（已在 desktop profile 中）。
- 插件包需声明：
  - `dsh.bundle.patch`: `./cordis.patch.yml`（安装时自动插入插件行）
  - `dsh.client.inject`: 客户端模块依赖（如需 UI）
- `cordis.patch.yml` 最小形态：
  ```yaml
  - insert:
      - id: longhaul
        name: 'dsh-longhaul'
  ```
- 安装（源码 checkout 内）：
  ```sh
  pnpm dsh plugin --profile desktop add <包名或本地路径>
  ```
  或发布后：
  ```sh
  pnpm dsh plugin --profile desktop add dsh-longhaul
  ```
  > M0 需确认：已安装桌面版是否有独立 `dsh` CLI，以及 profile 是 desktop 还是 web。

### 5.2 最接近的先例：auto-review（模式贡献）

- 包：`packages/experimental/auto-review`（`@deepseek-ai/dsh-experimental-auto-review`）
- 它做了一件与本插件同类的事：**向当前会话的权限选择器贡献一个仅本会话可用的模式**（Auto review），选中时弹风险确认，并通过 pre-execute 监听器改变行为。
- 关键文件：`cordis.patch.yml`、`src/index.ts`（依赖 approval/LLM/permission/session/tools 服务，注册 preset contribution + 监听器）。
- 结论：长任务模式可以复用“当前会话专用模式”的注册方式；但**它不止是权限模式**，还需要注入指令、挂工具、管理状态。M0 要确认注册 API 与 UI 扩展点。

### 5.3 其他相关包

| 包 | 用途 |
|---|---|
| `packages/preset/agent-preset` | 定义 Agent 子插件预设；可做 `longhaul` preset |
| `packages/interaction/permission-presets` | 权限模式选择器（sandbox + approval）；含 `auto` 预留 |
| `packages/goal/goal` + `goal-round-driver` | 无人值守的轮次推进；可做长任务心跳 |
| `packages/subagent/*` + `tool-subagent` | 派发；spawn/fork、depth、容量、结构化输出、续聊 |
| `packages/session-query/*` + `tool-session-query` | 会话历史检索；跨会话需 cwd 完全一致 |
| `packages/session-reference` | `@session` 引用快照（只读、不可信警告） |
| `packages/workflow` | 脚本化多 Agent 编排范式 |
| `packages/interaction/user-approval` | 一次性审批 seam（`ask`/`never`） |
| `packages/guard/*` | 重复工具提醒、超时策略等护栏 |
| `packages/core/system-prompt`、`agent-instructions` | 模式指令注入的可能挂载点 |
| `packages/boot/plugin-manager` | 插件安装/构建审批/清单 |

### 5.4 M0 必须回答的问题

1. 第三方包如何**贡献一个当前会话模式**（permission picker / composer menu）？需要哪些导出与版本？
2. 如何按会话**注入模式指令**（system prompt / agent-instructions / preset）？能否随模式开关动态生效？
3. 能否**程序化发起审批**（交付件审批），而不只是工具调用？若不能，用“在 `ask` 策略下的工具调用”实现。
4. 自定义 **session 事件类型**是否可行、是否持久化、能否被 `sessionQuery` 读到？否则用 sidecar。
5. 派发时如何**注入子 Agent 的 brief**？包装 `subagent` 工具、子 preset、还是 pre-turn listener？
6. 预算钩子：usage 事件、turn/step 事件、取消与超时；如何中止一个子 Agent？
7. `goal` 是否可以程序化创建/推进？与 `goal-round-driver` 的组合方式。
8. 客户端 UI：模式徽章/状态、设置页、`dsh.client.inject` 的具体槽位；i18n 约定。
9. 独立包的构建与发布：`tsdown`/`tsc`、exports、peerDeps、`publishConfig`、版本对齐（DSH 0.2.x）。
10. 已安装桌面版的插件安装/升级路径（CLI vs 设置页 Plugins），以及失败回滚。

---

## 6. 新仓库工程

### 6.1 仓库

- GitHub：`csoulnd/dsh-longhaul`（建议；若包名被占则 `@csoulnd/dsh-longhaul`）
- License：MIT（与 DSH 一致）
- Node：`^22.19.0 || >=24.0.0`；包管理器 pnpm
- 分支：`main` 保护；开发用 `feat/*`

### 6.2 目录

```
dsh-longhaul/
├─ package.json
├─ cordis.patch.yml
├─ tsconfig.json
├─ tsdown.config.ts            # 或 tsc，M0 定
├─ README.md / README.zh.md
├─ CHANGELOG.md
├─ LICENSE
├─ src/
│  ├─ index.ts                 # host 插件入口（Cordis）
│  ├─ client.ts                # 可选：客户端 UI
│  ├─ mode.ts                  # 模式注册/风险提示/指令注入
│  ├─ stages.ts                # S0-S5 状态机与交付件
│  ├─ memory.ts                # decisions/findings/artifacts + ACL
│  ├─ dispatch.ts              # 派发、扇出、depth、文件归属
│  ├─ budget.ts                # 预算与 usage 核算
│  ├─ tools.ts                 # 模型可见工具
│  └─ types.ts
├─ tests/
│  ├─ unit/                    # ACL/预算/状态机
│  ├─ integration/             # 假 provider + 子 Agent
│  └─ e2e/                     # 安装 + 模式切换
├─ docs/DESIGN.md
└─ .github/workflows/ci.yml
```

### 6.3 package.json 要点

```json
{
  "name": "dsh-longhaul",
  "version": "0.0.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": [] }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-permission-presets": "*",
    "@deepseek-ai/dsh-subagent": "*",
    "@deepseek-ai/dsh-session": "*",
    "@deepseek-ai/dsh-goal": "*",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/dsh-user-approval": "*"
  },
  "publishConfig": { "access": "public" },
  "engines": { "node": "^22.19.0 || >=24.0.0" }
}
```

> 版本号在 M0 对齐 DSH 发布版本；peerDependencies 用范围，避免锁死。

### 6.4 本地联调

1. 在 DSH fork 中构建（如需）：`pnpm install && pnpm build:lib`。
2. 在新仓库构建：`pnpm install && pnpm build`。
3. 安装到 profile：
   ```sh
   cd C:\data\project\thirdpart\deepseek-harness
   pnpm dsh plugin --profile desktop add C:\path\to\dsh-longhaul
   ```
4. 重启 DSH / 重新加载 profile，确认插件出现在 Plugins 页，模式入口可见。
5. 卸载：`pnpm dsh plugin --profile desktop remove dsh-longhaul`。

### 6.5 CI / 发布

- CI：typecheck + unit + integration；Node 22/24 矩阵；`pnpm pack` 校验。
- 发布：`npm publish --access public`（或 scoped）；打 tag；CHANGELOG。
- 兼容性矩阵：在 README 标注支持的 DSH 版本范围。

---

## 7. 里程碑与验收

### M0 调研 spike（1–2 天）
交付：`docs/DESIGN.md` 增补；可安装的空壳插件（只注册一个“长任务”入口，不改变行为）；M0 十问答案。
验收：在 desktop profile 安装成功；模式入口可见；卸载干净；不留副作用。

### M1 模式与阶段状态机
交付：模式开启风险弹窗；S0→S5 状态机；阶段交付件落盘；审批门禁。
验收：未批准计划前无法进入实现；每阶段有交付件与审批记录；退出模式可恢复。

### M2 树记忆
交付：decisions/findings/artifacts 存储与 ACL；brief 注入；promote 规则。
验收：子只读到自己分支 findings；决策全树可见；父可提升；跨树拒绝；有单测覆盖。

### M3 自动派发与预算
交付：按任务树派发；扇出/步数/depth 限制；父集成门禁；子树 token 报告。
验收：超预算停止并汇报；并发写冲突被拒；只有父能构建/提交；报告数字与日志一致。

### M4 阶段审批与恢复
交付：计划/分析/设计/实现/测试/交付六类交付件模板；审批通过才推进；失败回退。
验收：每阶段一次审批；拒绝不推进；中断后可恢复；审计可追溯。

### M5 发布
交付：README（中英）、DESIGN、CHANGELOG、示例、CI、npm 包。
验收：全新环境一条命令安装可用；卸载干净；CI 绿；版本可发布。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 自动派发放大 token | 预算硬约束；计划阶段声明总预算；超限停止 |
| 记忆污染/串味 | C 模型；子 append-only；父 promote；版本与 supersedes |
| 审批被绕过 | 阶段推进只认审批事件；权限 `never` 下拒绝；审计日志 |
| 并发写冲突 | 文件归属 + 单写者锁；冲突拒绝派发 |
| 插件 API 不稳定 | 对齐 DSH 版本；peerDeps 范围；M0 先做最小挂载验证 |
| 模式 UI 不可用 | 先 CLI/配置切换；UI 作为 M1 增量；保留降级 |
| 自演进失控 | 默认关闭；策略可解释、可回滚；不影响审批与预算 |
| 上游分叉漂移 | 记录依赖版本；CI 对 DSH 版本矩阵测试 |

---

## 9. 给新会话的交接提示词（可直接复制）

```
你是 dsh-longhaul 项目的负责人。这是一个独立的 DSH 插件仓库，目标是把“长任务模式”做成可发布的 npm 插件。

【必读】
1. 本仓库 README 与 docs/DESIGN.md（如尚未创建，先按交接文档创建）
2. DSH 源码 fork：C:\data\project\thirdpart\deepseek-harness
   - docs/cordis-primer.md、docs/config-catalog.md、docs/agent-lifecycle.md
   - packages/experimental/auto-review（模式贡献先例）
   - packages/interaction/permission-presets、packages/preset/agent-preset
   - packages/subagent/*、packages/goal/goal-round-driver、packages/session-query/*
   - 第三方插件示例：~/.dsh/profiles/desktop/node_modules/dsh-better-sidebar
3. 交接文档中的“已定决策 D1–D9”不可重新讨论；有异议先记录，不要擅自改。

【第一件事：M0 调研，不写业务代码】
回答交接文档 5.4 的十个问题，产出 docs/DESIGN.md 增补，并做一个“可安装的空壳插件”：
- 能在 desktop profile 安装/卸载
- 能注册一个“长任务模式”入口（先不实现行为）
- 记录安装/卸载命令与验证结果

【硬约束】
- 反许愿式编程：没有计划/分析/设计审批，不写实现代码
- 阶段交付件落盘并审批；每阶段结束提交证据
- 记忆：decisions 全树只读、findings 分支内、父 promote、子 append-only
- 预算：每子 60 步、扇出 4–6、depth 1；超限停止并汇报
- 只有父/集成子可以 build/verify/commit/publish
- 不修改 DSH 上游；本地 fork 用独立分支

【完成定义】
M0：安装/卸载可复现 + 十问答案 + DESIGN 增补
之后按 M1–M5 推进，每个里程碑先给计划再实现，测试与文档同步。
```

---

## 10. 附录：源码与证据

- DSH fork：`C:\data\project\thirdpart\deepseek-harness`（pnpm monorepo，`packageManager: pnpm@11.28.5`）
- 关键包路径：
  - `packages/experimental/auto-review`
  - `packages/interaction/permission-presets`
  - `packages/preset/agent-preset`
  - `packages/goal/goal-round-driver`
  - `packages/subagent/`
  - `packages/session-query/`
  - `packages/workflow/`
  - `packages/interaction/user-approval`
- 第三方插件示例：`~/.dsh/profiles/desktop/node_modules/dsh-better-sidebar`
- 会话用量证据：`~/.dsh/sessions/--C-Users-dai-.dsh-remote-workspaces-106.12.30.116-root-22-home--/*/session.v4.jsonl.zstd`
  - 逐帧解压后统计 `assistant/message.data.usage`
  - 本会话：31 sessions / 441.8M total / 子会话 83.7% / cacheRead 98.9%
- 插件安装命令（源码 checkout）：
  `pnpm dsh plugin --profile desktop add <包名或路径>`


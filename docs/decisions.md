# 决策记录（decisions）

> 规则：本文件**全树只读**，只有父/项目负责人可写。任何修改 = 追加一条新决策并标注 `supersedes`，不修改历史条目。
> D1–D9 来自 [HANDOVER.md](HANDOVER.md)，已定，不再讨论。M0 新增决策（D10–D18）待审批；批准后同样转为只读。

## 继承（不可改）

| # | 决策 |
|---|---|
| D1 | 树形治理：派发权在父；记忆作用域 = 根会话；兄弟默认隔离；跨树不共享 |
| D2 | 记忆可见性 = C 模型：decisions 全树只读；findings 仅本分支；父可 promote |
| D3 | 写权限：子 append-only findings；仅父可写 decisions；子不得修改他人结论 |
| D4 | 预算默认：每子 60 步、扇出 4–6、depth 1，均可配置 |
| D5 | v0 自动派发：模式开启后自动拆解/派发；开启时必须弹出风险与代价说明 |
| D6 | 默认反许愿式编程：计划/分析/设计审批前禁止实现；每阶段交付件 + 审批 |
| D7 | 模式入口：安装插件后，只切到「长任务模式」即可，不再额外加开关 |
| D8 | 独立仓库 + 发布：可发布 npm 包；DSH fork 位于 `C:\data\project\thirdpart\deepseek-harness` |
| D9 | v0 不做：全局记忆、无人审批全自动、模型分层/自演进 |

## M0/M1 新增

| # | 决策 | 理由 / 证据 |
|---|---|---|
| D10 | 模式入口采用**插件自有入口**（`/longhaul` 命令 + 客户端 composer chip），不占用 permission picker，不调用 `registerAuto` | 第三方无通用 preset 注册 API；`auto` 保留位与 auto-review 冲突（DESIGN §1 Q1） |
| D11 | 记忆权威存储 = **sidecar JSONL**；会话内只写 `plugin:longhaul/*` ignorable 记录作审计锚点；不新增 required 事件类型 | 第三方 required 事件会导致读日志整份拒绝（DESIGN §1 Q4） |
| D12 | 指令注入 = `systemPrompt.section` 动态 provider（order 700）+ `systemPrompt.context` 放变化值；开关发释放型 notice | plan-mode 同构先例；保证 model-visible ⟺ logged（DESIGN §1 Q2） |
| D13 | 派发 = 父直接调用 `ctx.subagents.startActivation()` 并渲染 brief；不包装/不 shadow 工具 | 最干净的注入点，同时可做预算/归属检查（DESIGN §1 Q5） |
| D14 | 预算自建：步数 + token 双计，80% 提醒、100% interrupt；fan-out 默认 6，depth 1，步数 60，全部 Config 可调 | DSH 无内建预算；`maxActiveSubagents` 全局配置不覆盖（DESIGN §1 Q6） |
| D15 | 阶段推进只认 `longhaul_submit` 的 `allowed-once`；v0 不以 goal-round-driver 为引擎 | driver 无预算、per-session、会等待子 Agent，且与阶段审批冲突（DESIGN §1 Q7） |
| D16 | 客户端 UI 用 `dsh.client` + `exports["./client"]` + tsdown；M1 先 host（命令可用），M1b 再上 chip/设置页 | 第三方 client 构建与槽位契约（DESIGN §1 Q8） |
| D17 | 包名 `dsh-longhaul`，版本 0.1.0；`engines.dsh: ">=0.2.1-rc.1 <0.3.0"`；peer `@deepseek-ai/cordis ^4.0.5` 与 0.2.1-rc.x | npm 名称未被占用；运行时版本 0.2.1-rc.2（DESIGN §1 Q9） |
| D18 | M0 空壳**不注册可见入口**；M0 验收 = 安装/卸载可复现 + 十问 + 设计增补。模式入口归 M1 | 本次任务把 M0 聚焦在调研；HANDOVER §7 的「只注册入口」收窄，待审批 |
| D19 | 阶段模型改为 **P0 需求 → P1 设计 → P2 开发（含测试）→ P3 交付**；S0–S5 降为阶段内部子步骤 | 三阶段特征差异大；D6 只约束「审批前禁止实现」，4 个闸门仍满足（DESIGN §7.2） |
| D20 | 上下文策略：P0/P1 审批通过后 **交付件落盘 → compactNow → 压缩后再注入 handoff**；P2 默认保留细节，只在压力/溢出时压缩 | 阶段末压缩降低后续 cacheRead；交付件为权威，handoff 兜底摘要损失（DESIGN §7.3） |
| D21 | 模型策略：**默认 `inherit`（不切模型）**；提供 phase→provider/model/reasoningEffort 配置；子 Agent 用 `agentOptions`，父会话用 `sessionController.selectModel`；启用需显式开启 | 静态阶段映射仍属 D9 排除的「模型分层」，默认关闭以守住 v0 边界（DESIGN §7.6，冲突 C4） |
| D22 | 设计变更环：P2 发现设计问题走 **DCR**（证据 + 影响面 + 设计文档版本 +1 + 审批），只重跑受影响任务；每任务最多 2 次 | 开发回改设计是正常路径，必须有变更控制与上限（DESIGN §7.5） |
| D23 | 分支默认 **spawn + brief**；需要完整上下文才用 **subagent fork**；不 fork 根会话做阶段切换；分支结果由父合并并更新设计文档 | 根 fork 会换 session id、破坏命名空间；fork 前缀重放成本高（DESIGN §7.4） |

> **状态（2026-10-22）**：D19–D23 **已批准生效**。D21 批准的是「配置与接口 + 默认 `inherit`」；部署启用模型切换属显式配置，不改变产品默认行为。D10–D18 仍待 M0 最终批准。

## 冲突记录（不改变已定决策）

- **C1（D7）**：DSH 没有第三方模式注册面；「只切一次」的目标语义由插件自有入口满足，但入口不是 permission picker。若上游开放 preset 注册，再迁移。
- **C2（D4）**：DSH `subagent` 服务的 `maxActiveSubagents` 默认 8，是全局配置；插件默认扇出 6 由自身计数器执行，不覆盖全局值。
- **C3（D2/D3）**：DSH 无跨会话写锁；文件归属是插件级协作约束，不是安全边界；违规只能拒绝工具调用，不能阻止直接文件系统写入。
- **C4（D9）**：D21 的静态阶段→模型映射属于 v0 排除的「模型分层」。本次只批准**接口与配置 + 默认 `inherit`**；产品默认仍不分层，部署显式启用才切换，且不改自演进。其余 D9 排除项（全局记忆、无人审批、自演进）不变。

## 变更流程

1. 新决策由父提出，写进本文件并标注状态「待批准」。
2. 阶段交付件审批通过后，状态改为「生效」，此条起只读。
3. 修订只能追加 `supersedes: D<n>` 的新条目；原条目保留。

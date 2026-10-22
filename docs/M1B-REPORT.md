# M1b 客户端入口实施报告

> 日期：2026-10-22
> 范围：composer chip、首次开启风险确认、客户端状态投影。
> 结论：入口与风险确认已实现并通过模块级校验；**未在真实 Desktop 中做视觉验收**。

## 1. 交付

| 文件 | 作用 |
|---|---|
| `client.js` | 手写浏览器模块：`window.__ModuleLoader__.load` 包装、`conversation.input.left` chip、风险确认面板、`/longhaul on|off` 命令调用 |
| `src/projection.ts` | host 侧 `longhaul` session projection：折叠 `plugin:longhaul/state` 记录，wire 出 `{mode, phase, designVersion, taskCount, pending, steps}` |
| `package.json` | `exports["./client"]`、`dsh.client { platform: 'web', inject }`、`files` 增加 `client.js` |
| `src/index.ts` | 注册 projection；插件记录补充 taskCount/pending/steps |

## 2. 行为

- **入口**：所有会话的 composer 左侧显示 `Long Haul` chip；这是模式入口，不占用 permission picker。
- **开启**：点击 chip → 风险确认（子 Agent、额外 token、阶段审批、父保留集成命令、可随时退出）→ 执行 `/longhaul on`。
- **运行中**：chip 显示 `长任务 · P1`，点击可退出（`/longhaul off`）。
- **状态**：由 host projection 折叠插件记录，不新增 RPC；断线重连/恢复后从日志重建。
- **i18n**：zh / en 字典随模块注册；错误行保留英文（错误面策略）。
- **降级**：client 未加载时 `/longhaul` 命令仍完整可用。

## 3. 验证

```text
node --check client.js       通过
pnpm typecheck               通过
pnpm test                    14 files / 107 tests
pnpm build                   通过
pnpm pack                    client.js + lib/** + cordis.patch.yml
真实 lh-test profile         安装成功；--dump-config-schema 接受 dsh.client 清单
```

未做：真实 Desktop 重启后的 chip 视觉、风险面板布局、projection 在浏览器中的实时更新。需要一次人工/浏览器验收。

### 3.1 运行中的 Desktop 热加载验收（2026-10-22）

插件安装进 desktop profile 后，**运行中的 Desktop 直接热加载了 host 侧**，无需重启：

- `longhaul_status` 返回 `Long Haul mode is off.`
- `longhaul_memory append_decision` / `append_finding` 成功写入
  `~/.dsh/longhaul/session-fcd26675-.../decisions.jsonl` 与 `findings/<session>.jsonl`，`list` 能看到 1 decision / 1 finding。
- `longhaul_plan` 在模式关闭时被拒绝：`Long Haul mode is off; enable it before planning`（阶段闸门生效）。
- desktop profile 的 `package.json` 与 lock 含 `link:C:/data/project/dsh-longhaul`，`dsh.profile.bundles` 含 `dsh-longhaul`；`cordis.yml` 没有重复行。

### 3.2 独立 web profile 的客户端服务验证

在同一安装的临时 `lh-test` profile 上启动 `dsh web --no-open --port 58999`：

- 首页 HTML 的客户端模块清单包含 `dsh-longhaul/client.js`；
- 拉取该 `plugins/??...` 组合 bundle（1.9 MB）后包含 `__ModuleLoader__.load`、`conversation.input.left`、`dsh-longhaul`；
- host 启动日志无错误。

这证明 `dsh.client` 清单、`exports["./client"]` 与模块发现链路成立，剩下的是浏览器内渲染验收。

### 3.3 Desktop 页面内 chip 观察

安装进 desktop profile 后，host 侧热加载成功（见 3.1），但 **页面刷新（Ctrl+R）后 composer 左侧仍未出现 chip**。可能原因：

- desktop 的客户端模块清单可能在应用启动时生成，页面刷新不会重新扫描新增插件；
- 或 chip 槽位在当前布局中未渲染 / 模块在浏览器内静默失败。

结论：需要**完全退出并重启 Desktop** 做最终视觉验收，而不是刷新页面。如果重启后仍无 chip，用独立 web profile 的 DOM/控制台继续定位。

### 3.4 chip 点击“没反应”的修复

用户反馈重启后 chip 仍在，但点击没有可见反馈。定位为：风险确认面板使用 `position:absolute; bottom:130%` 画在 composer 内，容易被输入区裁剪；看起来像按钮无响应。

修复：

- **chip 点击直接执行** `/longhaul on` / `/longhaul off`，不再自绘浮层；
- 风险说明移到 host 命令：`/longhaul on` 先调用 `ctx.approval.request({toolName:'longhaul_mode', displayReason:{en,zh}})`，只有 `allowed-once` 才开启；
- 失败时 chip 旁显示 `!`，`title` 带具体错误；
- 新增 `tests/integration/client-module.spec.ts`：真实加载 `client.js`、注册 slot、渲染 on/off 两种 chip；
- 新增 `tests/integration/command.spec.ts`：命令先请求审批、再持久化模式、再注入 notice。

验证：`typecheck` 通过，`test` 107 passed。由于本次为定位问题做过 remove/add，运行中的 Desktop 客户端模块清单没有重新扫描，**需要再次完整重启 Desktop** 才能看到修复后的 chip；host 侧工具已热加载。

## 4. 已知问题

1. **设置页未做**：预算、扇出、交付件目录目前只能改 `cordis.yml`；M1b 收尾补 `settings.section`。
2. **projection 依赖 zod 4.4.3**：必须与 DSH 的 zod 版本一致，`4.6.x` 会因类型不兼容失败；已在 `package.json` 固定。
3. **client.js 手写、无 TS 类型**：换来无需 tsdown；后续若加设置页/复杂交互，再引入构建。
4. **chip 不区分 root/child**：子会话也可能显示 chip；projection 状态仍来自 root 树。M1b 收尾按 session header 隐藏子会话入口。
5. **风险确认已移到 host 命令**：CLI 与 chip 使用同一 `longhaul_mode` 审批，不再有“只在客户端确认”的绕过。

## 5. 下一步

1. 真实 Desktop 安装/重启，验收 chip 与风险面板。
2. `settings.section`：预算、扇出、交付件目录（只读展示 + 写回配置）。
3. 子会话隐藏入口。
4. 命令层风险确认（可选）。

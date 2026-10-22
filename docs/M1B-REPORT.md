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
pnpm test                    12 files / 101 tests
pnpm build                   通过
pnpm pack                    client.js + lib/** + cordis.patch.yml
真实 lh-test profile         安装成功；--dump-config-schema 接受 dsh.client 清单
```

未做：真实 Desktop 重启后的 chip 视觉、风险面板布局、projection 在浏览器中的实时更新。需要一次人工/浏览器验收。

## 4. 已知问题

1. **设置页未做**：预算、扇出、交付件目录目前只能改 `cordis.yml`；M1b 收尾补 `settings.section`。
2. **projection 依赖 zod 4.4.3**：必须与 DSH 的 zod 版本一致，`4.6.x` 会因类型不兼容失败；已在 `package.json` 固定。
3. **client.js 手写、无 TS 类型**：换来无需 tsdown；后续若加设置页/复杂交互，再引入构建。
4. **chip 不区分 root/child**：子会话也可能显示 chip；projection 状态仍来自 root 树。M1b 收尾按 session header 隐藏子会话入口。
5. **风险确认只在客户端**：CLI 直接执行 `/longhaul on` 不会弹确认；如果该入口需要同等风险提示，需在命令层加一次确认。

## 5. 下一步

1. 真实 Desktop 安装/重启，验收 chip 与风险面板。
2. `settings.section`：预算、扇出、交付件目录（只读展示 + 写回配置）。
3. 子会话隐藏入口。
4. 命令层风险确认（可选）。

# 发布检查清单

[English](RELEASE.md) | [简体中文](RELEASE.zh-CN.md)

> 版本：`0.1.0` · 许可证：MIT · 包名：`dsh-longhaul` · 仓库：`csoulnd/dsh-longhaul`

## 1. 前置条件

- [x] `pnpm typecheck` 退出码 0
- [x] `pnpm test` 退出码 0（14 个文件 / 110 个测试）
- [x] `pnpm build` 退出码 0（`lib/*.js`、`lib/*.d.ts`）
- [x] `pnpm pack --dry-run` 包含 `lib/`、`client.js`、`cordis.patch.yml`、`locale/*.json`
- [x] 临时 profile 安装 + `--dump-config` 显示 `longhaul` 行
- [x] `--dump-config-schema` 能导入插件并读取 Config
- [x] 真实 Desktop 验收：chip、原生风险确认、模式开启/退出 notice
- [ ] 真实会话压缩后端验收（`compaction-basic`，不是测试里的 fake backend）
- [ ] 发布提交后，Node 22 与 24 的 CI 全绿

## 2. 兼容性

| 组件 | 已验证 |
|---|---|
| DSH runtime | `0.2.1-rc.2`（engines 范围 `>=0.2.1-rc.1 <0.3.0`） |
| Cordis | `4.0.5` |
| Node | `22.19`、`24` |
| Desktop profile | Windows，已安装应用 `0.2.1-rc.2` |
| Profiles | `desktop`（应用托管）、临时自定义 `web` profile |

## 3. 发布

```sh
# 从干净的 main 与匹配的 tag 开始
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
npm publish --access public
git tag v0.1.0 && git push origin v0.1.0
```

- 首次发布前确认包名仍未被占用：`npm view dsh-longhaul version` 应返回 404。
- `publishConfig.access` 为 `public`；不需要 scope。
- 发布后验证 `npm view dsh-longhaul@0.1.0 dist.tarball`，并安装到一个全新 profile：
  ```sh
  dsh plugin --profile desktop add dsh-longhaul@0.1.0
  ```
- 在 GitHub release notes 中记录发布 tarball 的哈希。

## 4. 安装 / 升级 / 卸载

管理 profile 前必须完全退出 Desktop。

```sh
dsh plugin --profile desktop add dsh-longhaul
dsh plugin --profile desktop remove dsh-longhaul
```

- 升级 = 卸载 + 安装；没有回滚动词。保留上一个 tarball 或固定旧版本。
- `pwsh -File scripts/verify-install.ps1` 执行快照/安装/卸载/对比循环；Desktop 打开时它会拒绝运行。
- 卸载会保留 `~/.dsh/longhaul/<rootSessionId>/`（用户记忆）。要删除记忆需手动删除。
- 如果 CLI 管理 profile 时 Desktop 仍在运行，profile 根 `cordis.yml` 可能保留镜像的 `longhaul` 行；
  按 [M0-REPORT.md](M0-REPORT.md) 清理该行与 `node_modules/dsh-longhaul` 链接。

## 5. 0.1.0 的已知限制

1. **真实会话中的压缩后端未验证**：调度、handoff 顺序、状态清理由 fake backend 的集成测试覆盖；`compaction-basic` 的摘要质量与重试行为仍需真实运行。
2. **设置页缺失**：预算、扇出、交付件目录、模型路由只能通过 `cordis.yml` 配置。
3. **模型路由默认关闭**：`modelPolicy.mode` 默认 `inherit`；阶段路由已实现但未实际跑过。
4. **子会话 chip 可见性**：composer chip 可能在子会话渲染；projection 仍反映根树。
5. **审批需要人类通道**：headless 部署得到 `unavailable` 并 fail-closed；无人值守时阶段闸门无法推进。
6. **记忆以 sidecar 为准**：session plugin records 是审计锚点，可能因格式迁移丢失；`~/.dsh/longhaul` 仍是事实来源。
7. **文件归属是协作式的**：工具闸门拒绝跨会话写入，但 DSH 没有跨会话文件系统锁；子会话直接写文件不在范围内。
8. **Windows 优先验证**：安装/验证路径在 Windows 上跑过；Linux/macOS 仅由 CI 单测覆盖。
9. **风险确认由客户端负责**：composer chip 使用原生对话框确认；直接从 CLI 执行 `/longhaul on` 不弹确认。阶段闸门本身仍要求审批。

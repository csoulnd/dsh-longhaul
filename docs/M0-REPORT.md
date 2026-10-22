# M0 安装/卸载验证报告

> 日期：2026-10-22 15:09–15:22（Asia/Shanghai）
> 目标：证明 `dsh-longhaul` 空壳能装进 desktop profile、能被 Node 解析、并能卸载干净。
> 结论：**通过**（含一处环境残留，已清理并复验逐字节一致）。

## 1. 环境

| 项 | 值 |
|---|---|
| DSH fork | `C:\data\project\thirdpart\deepseek-harness`，`0.2.1-rc.2`，`pnpm@11.28.5` |
| 桌面版 | `0.2.1-rc.2`；CLI `resources\runtime\cli\bin\dsh.cmd`；内置 pnpm `11.28.5`、Node `24.21.0` |
| profile | `C:\Users\dai\.dsh\profiles\desktop` |
| 插件仓库 | `C:\data\project\dsh-longhaul`，`0.0.0`，已构建出 `lib/index.js` |
| 路径限制 | 本机 PATH 无 pnpm、fork 无 `node_modules`；因此使用桌面版自带 CLI 与内置 pnpm，未改动 fork |

## 2. 安装前基线

快照目录：`%TEMP%\dsh-yM6Hu3\dsh-m0-20261022-150911\`

- `package.json`：deps = `dsh-better-sidebar ^0.28.0`、`dsh-remote ^0.8.46`；bundles 6 项。
- `pnpm-lock.yaml`、`cordis.yml`、`cordis.patch.yml`、`node_modules` 列表均已保存。

## 3. 安装

```powershell
& "C:\Users\dai\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add C:\data\project\dsh-longhaul
```

结果（exit 0）：

- `dependencies` 新增 `dsh-longhaul: link:C:/data/project/dsh-longhaul`
- `dsh.profile.bundles` 追加 `dsh-longhaul`（共 7 项）
- `pnpm-lock.yaml` 新增 `link:` 条目
- `node_modules\dsh-longhaul` 为指向仓库的 junction
- pnpm 警告：link 依赖不解析 `@deepseek-ai/cordis` peer（预期；运行时由安装域提供）

模块自检：

```powershell
node --input-type=module -e "const m = await import('file:///C:/data/project/dsh-longhaul/lib/index.js'); console.log(Object.keys(m).join(','), m.name, JSON.stringify(m.inject), typeof m.apply)"
# apply,inject,name longhaul [] function
```

## 4. 卸载

```powershell
& "...\dsh.cmd" plugin --profile desktop remove dsh-longhaul
```

结果（exit 0）：

- `dependencies` 移除 `dsh-longhaul`
- `dsh.profile.bundles` 恢复为 6 项
- `pnpm-lock.yaml` 与基线**逐字节一致**

## 5. 残留与清理（重要）

桌面版当时正在运行。卸载后仍观察到两处残留：

1. `node_modules\dsh-longhaul` junction 未被 pnpm 删除。
2. profile 根 `cordis.yml` 末尾出现：
   ```yaml
   - id: longhaul
     name: dsh-longhaul
   ```
   该行安装前不存在，且不是 `dsh plugin` 的 patch 对账写入（`plugin-manager` 只改 `package.json`/`cordis.patch.yml`，不写 `cordis.yml`）；时间戳（15:11:33）指向运行中的 Desktop 对 profile 组合的镜像写入。

清理（Desktop 未退出，已确认 `hmr.config.root=[]`，不会热重载）：

```powershell
# 删除 cordis.yml 末尾两行（精确匹配）
node -e "..." # remove `- id: longhaul\n  name: dsh-longhaul\n` at EOF
cmd /c rmdir "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-longhaul"
```

## 6. 复验

| 文件/目录 | 与安装前比较 |
|---|---|
| `package.json` | 逐字节一致 |
| `pnpm-lock.yaml` | 逐字节一致 |
| `cordis.yml` | 逐字节一致 |
| `cordis.patch.yml` | 逐字节一致 |
| `node_modules` 顶层列表 | 一致 |
| `longhaul` 引用计数（package/lock/cordis） | 0 |

## 7. 结论与限制

- **通过**：依赖、bundle 选择、lockfile、profile 组合均可逆；插件入口模块可解析。
- **限制 1**：未在重启后的 Desktop 中确认「Plugins 页可见 / 模式入口可见」。M0 空壳没有入口，入口属 M1；可见性验证放到 M1b。
- **限制 2**：本次是在 Desktop 运行中执行 CLI 管理，违反 DSH 自身提示（`apps/cli/src/plugin.ts:10-14` 要求完全退出 Desktop）。残留即由此产生。正确流程：
  1. 完全退出 Desktop；
  2. `dsh plugin --profile desktop add|remove <spec>`；
  3. 启动 Desktop。
  M1 增加 `scripts/verify-install.ps1`，检测 Desktop 进程并在退出后复验。
- **限制 3**：未测试 Plugins 页的升级/回滚（无回滚动词；Update = 卸载 + 安装）。

## 8. 复现命令（给 CI/新机器）

```powershell
cd C:\data\project\dsh-longhaul
pnpm install
pnpm build

& "<DeepSeekHarness>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add C:\data\project\dsh-longhaul
# 验证 profile/package.json 的 dependencies 与 dsh.profile.bundles
& "<DeepSeekHarness>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-longhaul
# 对比 package.json / pnpm-lock.yaml 与基线
```

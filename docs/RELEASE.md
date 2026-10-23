# Release checklist

[English](RELEASE.md) | [简体中文](RELEASE.zh-CN.md)

> Version: `0.1.0` · License: MIT · Package: `dsh-longhaul` · Repository: `csoulnd/dsh-longhaul`

## 1. Preconditions

- [x] `pnpm typecheck` exit 0
- [x] `pnpm test` exit 0 (14 files / 110 tests)
- [x] `pnpm build` exit 0 (`lib/*.js`, `lib/*.d.ts`)
- [x] `pnpm pack --dry-run` includes `lib/`, `client.js`, `cordis.patch.yml`, `locale/*.json`
- [x] Temporary profile install + `--dump-config` shows the `longhaul` row
- [x] `--dump-config-schema` imports the plugin and reads its Config
- [x] Real Desktop acceptance: chip, native risk confirmation, mode on/off notices
- [ ] Real-session compaction backend check (`compaction-basic`, not the fake backend used in tests)
- [ ] CI green on Node 22 and 24 after the release commit

## 2. Compatibility

| Component | Tested |
|---|---|
| DSH runtime | `0.2.1-rc.2` (engines range `>=0.2.1-rc.1 <0.3.0`) |
| Cordis | `4.0.5` |
| Node | `22.19`, `24` |
| Desktop profile | Windows, installed app `0.2.1-rc.2` |
| Profiles | `desktop` (app-managed), temporary custom `web` profile |

## 3. Publish

```sh
# from a clean main with a matching tag
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
npm publish --access public
git tag v0.1.0 && git push origin v0.1.0
```

- Confirm the package name is still unclaimed: `npm view dsh-longhaul version` should 404 before the first publish.
- `publishConfig.access` is `public`; no scope is required.
- After publishing, verify `npm view dsh-longhaul@0.1.0 dist.tarball` and install into a fresh profile:
  ```sh
  dsh plugin --profile desktop add dsh-longhaul@0.1.0
  ```
- Record the published tarball hash in the GitHub release notes.

## 4. Install / upgrade / uninstall

Fully quit Desktop before managing its profile.

```sh
dsh plugin --profile desktop add dsh-longhaul
dsh plugin --profile desktop remove dsh-longhaul
```

- Upgrades are uninstall + install; there is no rollback verb. Keep the previous tarball or pin the prior version.
- `pwsh -File scripts/verify-install.ps1` performs a snapshot/install/uninstall/compare cycle; it refuses to run while Desktop is open.
- Uninstalling keeps `~/.dsh/longhaul/<rootSessionId>/` (user memory). Delete it manually to remove memory.
- If Desktop was running during CLI management, the profile root `cordis.yml` may keep a mirrored `longhaul` row; clean it and the `node_modules/dsh-longhaul` link as described in [M0-REPORT.md](M0-REPORT.md).

## 5. Known limitations at 0.1.0

1. **Compaction backend unverified in a real session**: scheduling, handoff ordering, and state clearing are covered by an integration test with a fake backend; `compaction-basic` summary quality and retry behavior still need a real run.
2. **Settings page absent**: budgets, fan-out, deliverable directory, and model routing are `cordis.yml` fields only.
3. **Model routing default off**: `modelPolicy.mode` defaults to `inherit`; phase routing is implemented but not exercised.
4. **Child chip visibility**: the composer chip may render in child sessions; the projection still reflects the root tree.
5. **Approval needs a human channel**: headless deployments get `unavailable` and fail closed; stage gates cannot advance unattended.
6. **Memory is sidecar-authoritative**: session plugin records are audit anchors and can be lost by a format migration; `~/.dsh/longhaul` remains the source of truth.
7. **File ownership is cooperative**: cross-session writes are refused by the tool gate, but DSH has no cross-session filesystem lock; direct filesystem writes from a child are out of scope.
8. **Windows-first validation**: the install/verify path was exercised on Windows; Linux/macOS are covered by CI unit tests only.
9. **Risk confirmation is client-owned**: the composer chip confirms with a native dialog; a direct CLI `/longhaul on` does not prompt. The stage gates themselves still ask for approval.

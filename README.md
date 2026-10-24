# dsh-longhaul

[English](README.md) | [简体中文](README.zh-CN.md)

Long-haul task mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A session-scoped mode that works like a person on a long task: **Requirements → Design → Development → Ship**, with every gate submitting a deliverable for approval, a tree-scoped memory (`decisions` / `findings` / `artifacts`), automatic subagent dispatch under budgets, and a parent-only integration gate.

> Status: **0.1.0 release candidate**. The plugin provides the four-gate phase machine,
> `longhaul_*` tools (status/plan/task/submit/dispatch/memory/change), `/longhaul on|off|status`,
> a composer `Long Haul` chip with native risk confirmation, durable mode state, tree memory
> with branch ACL, budget accounting and stop rules, subagent dispatch with structured
> briefs, tool-phase/ownership gates, model guidance, and the design-change loop.
> The chip and mode on/off are accepted in the real Desktop; `typecheck`, 131 tests, and
> `build` pass. A better-sidebar tab renders the phase gates and plan task tree.
> Remaining before `npm publish`: the settings page, a real-session compaction check, and
> the release/CI run. See [docs/RELEASE.md](docs/RELEASE.md).

## Install (development)

```sh
pnpm install
pnpm build
```

Fully quit DeepSeek Harness Desktop before managing its profile, then run the DSH CLI
from the source checkout (or the installed app's `resources\runtime\cli\bin\dsh.cmd`):

```sh
pnpm dsh plugin --profile desktop add C:\path\to\dsh-longhaul
# uninstall
pnpm dsh plugin --profile desktop remove dsh-longhaul
```

Start Desktop afterwards and confirm the plugin appears in the Plugins page.
Managing the desktop profile while Desktop is running can leave a mirrored row in
the profile root `cordis.yml`; see [docs/M0-REPORT.md](docs/M0-REPORT.md).

## Use

```text
/longhaul on        # enter Long Haul mode for this root session
/longhaul status    # phase, plan, budget, pending approval
/longhaul off       # leave the mode; durable state and memory are kept
```

The model then works through P0 Requirements → P1 Design → P2 Development → P3 Ship.
Each gate needs a deliverable file and an allowed-once approval (`longhaul_submit`);
implementation writes stay blocked until P1 is approved. Findings are branch-scoped,
decisions are tree-wide, and only the root promotes. Design changes raised during
development go through `longhaul_change` and re-run only the affected tasks.

## Task tree in the sidebar

When `dsh-better-sidebar` is installed, the plugin registers a **Long Haul** tab in that
sidebar (order 33, between Tasks and Side Chat). It renders the whole process read-only:

- **Header**: phase, design version, last updated, and mode.
- **Summary**: objective, `done/total`, child steps, live children, and any pending approval.
- **Phase gates**: P0 → P3 with `done / active / waiting / pending` and a clickable
  workspace-relative deliverable path.
- **Tasks**: compact rows; click a row to expand files, dependencies, per-task step budget,
  and the owner child. Deliverables and files open in the sidebar; an owned task jumps to
  its child session.
- **Evidence**: decisions, findings, and artifacts counts plus the latest records, folded
  from the tree memory sidecar.

The tab is not auto-opened on page load. Use the **Tasks** button next to the composer
`Long Haul` chip (or the sidebar `+` menu) to open it; enabling Long Haul from the chip
opens it automatically. The gate rows link each phase deliverable
(`.longhaul/deliverables/00-requirements.md` … `03-release.md`); without the tab, the same
files can be opened from the **Files** tab at those paths.

The tab derives from the same `longhaul` session projection as the chip, so it updates as
`longhaul_plan` / `longhaul_task` / `longhaul_submit` change state. `longhaul_task`
(`status`, optional `ownerSessionId`) keeps the tree in sync during P2/P3. If better-sidebar
is absent, the chip and tools still work; the task data is still available to any client
that reads the `longhaul` projection.

> The built-in better-sidebar **Tasks** tab shows live subagent topology; the Long Haul tab
> is the durable phase/plan tree. Both can be open at once.

## Gate behavior

- **P0/P1**: every implementation write is blocked, including `write`/`edit` and shell
  commands. Only `.longhaul/` deliverable writes and a conservative read-only shell
  allowlist (`git status/diff/log/show`, `rg`, PowerShell read cmdlets, `pnpm typecheck`)
  are available.
- **Plan first**: `longhaul_plan` is required before the P0 submission. A plan is
  immutable unless revised with `mode: "revise"` and a reason; a legacy P1 session with
  no plan can recover one once with `mode: "recover"`.
- **Paths**: deliverables and working paths use the session's current directory
  (`working_directory`), not the immutable session header directory.
- **P2 children**: a child may only write the files owned by its plan task; shell writes
  and integration commands stay parent-only.
- **Boundary**: this is a cooperative policy, not a security sandbox. Shell classification
  is intentionally conservative; commands outside the allowlist are denied. Tests, builds,
  installs, and scratch scripts are not available in P0/P1; run them in P2 or a disposable
  workspace copy.

## Compatibility and release

- DSH `0.2.1-rc.x` (`engines.dsh: ">=0.2.1-rc.1 <0.3.0"`), Cordis `4.0.5`, Node `^22.19 || >=24`.
- `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm pack --dry-run` are the release gates;
  CI runs them on Node 22 and 24.
- The tarball ships `lib/`, `client.js`, `cordis.patch.yml`, `locale/*.json`, README, and LICENSE.
- Publishing is `npm publish --access public` from a clean `main`; the package name is unclaimed
  on npm, so no scope is required.

## Design

- [docs/README.md](docs/README.md) — documentation index and language switching.
- [docs/HANDOVER.md](docs/HANDOVER.md) — decision record D1–D9, architecture, milestones, risks.
- [docs/DESIGN.md](docs/DESIGN.md) — M0 research answers, M1 design, and the approved four-gate model.
- [docs/decisions.md](docs/decisions.md) — decision log (D1–D9 inherited, D10–D23 recorded).
- [docs/findings/M0-research.md](docs/findings/M0-research.md) — branch-scoped M0 research findings.
- [docs/M0-REPORT.md](docs/M0-REPORT.md) — install/uninstall commands and evidence.
- [docs/M1A-REPORT.md](docs/M1A-REPORT.md) — host-core implementation and verification.
- [docs/M1B-REPORT.md](docs/M1B-REPORT.md) — composer chip, risk confirmation, and projection.
- [docs/RELEASE.md](docs/RELEASE.md) — release gates, publish steps, and known limitations.

## License

MIT

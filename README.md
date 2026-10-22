# dsh-longhaul

Long-haul task mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A session-scoped mode that works like a person on a long task: **Requirements → Design → Development → Ship**, with every gate submitting a deliverable for approval, a tree-scoped memory (`decisions` / `findings` / `artifacts`), automatic subagent dispatch under budgets, and a parent-only integration gate.

> Status: **M1–M4 implemented; M5 release preparation complete**. The plugin provides the
> four-gate phase machine, `longhaul_*` tools (status/plan/submit/dispatch/memory/change),
> `/longhaul on|off|status`, a composer `Long Haul` chip with the first-enable risk
> confirmation, durable mode state, tree memory with branch ACL, budget accounting and stop
> rules, subagent dispatch with structured briefs, tool-phase/ownership gates, model guidance,
> and the design-change loop. Remaining before `npm publish`: a real Desktop visual acceptance,
> a real-session compaction check, and the settings page. See [docs/RELEASE.md](docs/RELEASE.md).

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

## Compatibility and release

- DSH `0.2.1-rc.x` (`engines.dsh: ">=0.2.1-rc.1 <0.3.0"`), Cordis `4.0.5`, Node `^22.19 || >=24`.
- `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm pack --dry-run` are the release gates;
  CI runs them on Node 22 and 24.
- The tarball ships `lib/`, `client.js`, `cordis.patch.yml`, `locale/*.json`, README, and LICENSE.
- Publishing is `npm publish --access public` from a clean `main`; the package name is unclaimed
  on npm, so no scope is required.

## Design

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

# dsh-longhaul

Long-haul task mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A session-scoped mode that works like a person on a long task: **Requirements → Design → Development → Ship**, with every gate submitting a deliverable for approval, a tree-scoped memory (`decisions` / `findings` / `artifacts`), automatic subagent dispatch under budgets, and a parent-only integration gate.

> Status: **M1a host core complete**. The plugin provides the four-gate phase machine,
> `longhaul_*` tools (status/plan/submit/dispatch/memory/change), `/longhaul on|off|status`,
> durable mode state, tree memory with branch ACL, budget accounting and stop rules,
> subagent dispatch with structured briefs, tool-phase/ownership gates, model guidance,
> and the design-change loop. Phase-exit compaction measurement, child memory, model
> routing, and the client chip remain. See [docs/DESIGN.md](docs/DESIGN.md) and
> [docs/M1A-REPORT.md](docs/M1A-REPORT.md).

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

## Design

- [docs/HANDOVER.md](docs/HANDOVER.md) — decision record D1–D9, architecture, milestones, risks.
- [docs/DESIGN.md](docs/DESIGN.md) — M0 research answers, M1 design, and the approved four-gate model.
- [docs/decisions.md](docs/decisions.md) — decision log (D1–D9 inherited, D10–D23 recorded).
- [docs/findings/M0-research.md](docs/findings/M0-research.md) — branch-scoped M0 research findings.
- [docs/M0-REPORT.md](docs/M0-REPORT.md) — install/uninstall commands and evidence.
- [docs/M1A-REPORT.md](docs/M1A-REPORT.md) — host-core implementation and verification.

## License

MIT

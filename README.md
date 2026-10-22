# dsh-longhaul

Long-haul task mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A session-scoped mode that works like a person on a long task: **Plan → Analyze → Design → Implement → Test → Ship**, with every stage submitting a deliverable for approval, a tree-scoped memory (`brief` / `decisions` / `findings` / `artifacts`), automatic subagent dispatch under budgets, and a parent-only integration gate.

> Status: **M0 research complete, awaiting approval**. The empty bundle installs and uninstalls cleanly; the mode entry, stage machine, memory and budgets land in M1. See [docs/DESIGN.md](docs/DESIGN.md).

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

## Design

- [docs/HANDOVER.md](docs/HANDOVER.md) — decision record D1–D9, architecture, milestones, risks.
- [docs/DESIGN.md](docs/DESIGN.md) — M0 answers to the ten research questions and the M1 design supplement.
- [docs/decisions.md](docs/decisions.md) — decision log (D1–D9 inherited, D10–D18 awaiting approval).
- [docs/findings/M0-research.md](docs/findings/M0-research.md) — branch-scoped M0 research findings.
- [docs/M0-REPORT.md](docs/M0-REPORT.md) — install/uninstall commands and evidence.

## License

MIT

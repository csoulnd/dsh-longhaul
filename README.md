# dsh-longhaul

Long-haul task mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A session-scoped mode that works like a person on a long task: **Plan → Analyze → Design → Implement → Test → Ship**, with every stage submitting a deliverable for approval, a tree-scoped memory (`brief` / `decisions` / `findings` / `artifacts`), automatic subagent dispatch under budgets, and a parent-only integration gate.

> Status: **M0 scaffold**. The plugin installs and mounts, but the mode/stage machine is not implemented yet. See [docs/HANDOVER.md](docs/HANDOVER.md).

## Install (development)

```sh
pnpm install
pnpm build
# from the DSH source checkout:
pnpm dsh plugin --profile desktop add C:\path\to\dsh-longhaul
```

Restart DSH, then confirm the plugin appears in the Plugins page.

## Design

- [docs/HANDOVER.md](docs/HANDOVER.md) — decisions, architecture, DSH integration points, milestones, risks.
- [docs/DESIGN.md](docs/DESIGN.md) — M0 research questions and design notes.

## License

MIT

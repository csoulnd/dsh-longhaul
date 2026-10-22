# Changelog

## 0.1.0 — unreleased

- Four-gate host core: P0 Requirements → P1 Design → P2 Development → P3 Ship, with a
  durable state reducer, deliverable section checks, and allowed-once stage approvals.
- Model tools: `longhaul_status`, `longhaul_plan`, `longhaul_submit`, `longhaul_dispatch`,
  `longhaul_memory`, `longhaul_change`; plus `/longhaul on|off|status`.
- Subagent dispatch: self-contained briefs, structured child results, fan-out/ownership/DCR
  checks, and parent-only integration.
- Tool gate: implementation writes blocked before P1 approval, child integration commands
  rejected, cross-session file ownership enforced.
- Tree memory: append-only sidecar JSONL, tree-wide decisions/artifacts, branch-scoped
  findings, parent promote, supersession versions.
- Budget accounting: per-child steps/tokens, tree caps, 80% warn / 100% stop.
- Phase guidance section, per-turn state context, post-compaction handoff, and
  design change requests (DCR) with a per-task ceiling.
- Client entry: composer `Long Haul` chip, bilingual labels, first-enable risk
  confirmation, and a `longhaul` session projection for live phase state.
- Config schema with D4 defaults and phase model routing (default `inherit`).

## 0.0.0 — 2026-10-22

- Initial scaffold: Cordis plugin entry, `cordis.patch.yml`, build/typecheck/test
  scripts, CI, and the design handover. No behavior yet (M0).

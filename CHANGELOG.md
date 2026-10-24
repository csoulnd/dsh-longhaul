# Changelog

[English](CHANGELOG.md) | [简体中文](CHANGELOG.zh-CN.md)

## 0.1.0 — unreleased

- Four-gate host core: P0 Requirements → P1 Design → P2 Development → P3 Ship, with a
  durable state reducer, deliverable section checks, and allowed-once stage approvals.
- Model tools: `longhaul_status`, `longhaul_plan`, `longhaul_task`, `longhaul_submit`,
  `longhaul_dispatch`, `longhaul_memory`, `longhaul_change`; plus `/longhaul on|off|status`.
- Subagent dispatch: self-contained briefs, structured child results, fan-out/ownership/DCR
  checks, and parent-only integration.
- Tool gate: implementation writes blocked before P1 approval, child integration commands
  rejected, cross-session file ownership enforced.
- Gate hardening: P0/P1 shell writes are default-denied with a conservative read-only
  allowlist; `apply_patch` is blocked before P2; an unreadable state fails closed; P2
  children may only write files owned by their plan task.
- Plan lifecycle: a plan is required before the P0 submission; it can be revised only with
  `mode: "revise"` + reason; a legacy P1 session can recover one missing plan with
  `mode: "recover"`.
- Working paths resolve through the session `workingDirectory` service instead of the
  immutable session header directory.
- Task tree: the `longhaul` projection carries the plan objective, plan version, and every
  task (status/files/dependencies/owner); `dsh-better-sidebar` gets a **Long Haul** tab
  with phase gates and the task tree; `longhaul_task` updates a task's status/owner during
  P2/P3. The tab is read-only and adds a gate stepper with deliverable links, expandable
  task details, updated time, and evidence counts/latest records. A **Tasks** button next
  to the chip opens the tab, and enabling Long Haul opens it automatically.
- Memory: dispatched child ownership is rebuilt from the persisted plan, so the root can
  still list and promote a settled child's findings; `longhaul_memory` gains
  `append_artifact` for workspace-relative evidence.
- Tree memory: append-only sidecar JSONL, tree-wide decisions/artifacts, branch-scoped
  findings, parent promote, supersession versions.
- Budget accounting: per-child steps/tokens, tree caps, 80% warn / 100% stop.
- Phase guidance section, per-turn state context, post-compaction handoff, and
  design change requests (DCR) with a per-task ceiling.
- Client entry: composer `Long Haul` chip, bilingual labels, native risk confirmation,
  and a `longhaul` session projection for live phase state.
- Fixed: the chip no longer crashes the composer slot (`useInput` takes a selector);
  mode entry no longer calls `approval.request()` outside an open turn.
- Config schema with D4 defaults and phase model routing (default `inherit`).

## 0.0.0 — 2026-10-22

- Initial scaffold: Cordis plugin entry, `cordis.patch.yml`, build/typecheck/test
  scripts, CI, and the design handover. No behavior yet (M0).

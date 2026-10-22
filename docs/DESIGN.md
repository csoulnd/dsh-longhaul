# Design notes

> See [HANDOVER.md](HANDOVER.md) for the full decision record. This file is the
> working design document for M0–M5.

## M0 research questions (must be answered before M1)

1. How does a third-party package contribute a current-session mode entry
   (permission picker / composer menu)? Which exports and versions?
2. How to inject mode guidance per session (system prompt / agent-instructions /
   preset)? Can it toggle with the mode?
3. Can a plugin request approval programmatically for stage deliverables?
   If not, use an `ask`-gated tool call.
4. Are custom session event types supported/persisted/queryable? Otherwise use a
   sidecar JSONL.
5. How to inject a child's brief at dispatch time (wrap the subagent tool, child
   preset, or pre-turn listener)?
6. Budget hooks: usage/turn/step events, cancellation, timeouts; how to stop a
   child.
7. Can `goal` be created/advanced programmatically and combined with
   `goal-round-driver`?
8. Client UI: mode badge/state, settings page, `dsh.client.inject` slots, i18n
   conventions.
9. Standalone package build/publish: tsdown/tsc, exports, peerDeps,
   `publishConfig`, version alignment with DSH 0.2.x.
10. Installed desktop app: plugin install/upgrade path (CLI vs Plugins page) and
    rollback.

## Status

- [ ] M0 — installable empty shell + answers
- [ ] M1 — mode + stage state machine
- [ ] M2 — tree-scoped memory
- [ ] M3 — dispatch + budgets
- [ ] M4 — staged deliverable approvals
- [ ] M5 — publish

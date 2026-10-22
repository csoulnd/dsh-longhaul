# Tests

- `unit/` — phase rules, state reducer, memory ACL and JSONL store, budget accounting,
  configuration validation, guidance text, dispatch policy, brief rendering.
- `integration/` — real Cordis composition with stub services: tool, section, and command
  registration plus a `longhaul_status` read through durable state.
- `e2e/` (planned) — install into a desktop profile, restart, switch the mode, and verify
  the chip and phase transitions.

Run with `pnpm test`; `pnpm typecheck` covers `src/` only.

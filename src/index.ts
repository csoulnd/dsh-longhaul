/**
 * dsh-longhaul — Long Haul task mode for DeepSeek Harness.
 *
 * M0 scaffold only: this entry intentionally does nothing yet. The mode
 * entry, stage machine, tree-scoped memory, dispatch policy and budget
 * accounting land in M1–M4 (see docs/HANDOVER.md).
 *
 * @module dsh-longhaul
 */
import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'longhaul'

/** Capability services required by this plugin. */
export const inject: string[] = []

/** Cordis entry point. */
export function apply(_ctx: Context): void {
  // M0: verify installation and mount point only.
  // M1: register the current-session "Long Haul" mode entry.
  // M2: inject guidance, mount tools and tree-scoped memory.
  // M3: dispatch policy + budgets. M4: staged deliverable approvals.
}

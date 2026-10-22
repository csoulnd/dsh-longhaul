/**
 * Shared fixtures for Long Haul unit tests.
 *
 * @module tests/unit/helpers
 */
import type { Config } from '../../src/config.ts'

/** A complete configuration with D4 defaults, overridable per test. */
export function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    deliverableDir: '.longhaul',
    childStepBudget: 60,
    fanout: 6,
    maxDepth: 1,
    totalStepBudget: 0,
    tokenBudget: 0,
    requireApproval: true,
    compactOnPhaseExit: true,
    findingsInjectLimit: 20,
    maxChangeRequestsPerTask: 2,
    modelPolicy: { mode: 'inherit', phases: {} },
    policyText: '',
    ...overrides,
  }
}

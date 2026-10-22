/**
 * Configuration validation and defaults for Long Haul.
 */
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/config.ts'
import { baseConfig } from './helpers.ts'

describe('resolveConfig', () => {
  it('accepts the D4 defaults', () => {
    const config = resolveConfig(baseConfig())
    expect(config.childStepBudget).toBe(60)
    expect(config.fanout).toBe(6)
    expect(config.maxDepth).toBe(1)
    expect(config.modelPolicy.mode).toBe('inherit')
  })

  it('returns a detached copy', () => {
    const input = baseConfig()
    const config = resolveConfig(input)
    config.fanout = 2
    expect(input.fanout).toBe(6)
  })

  it('rejects out-of-range budgets', () => {
    expect(() => resolveConfig(baseConfig({ childStepBudget: 0 }))).toThrow(/childStepBudget/)
    expect(() => resolveConfig(baseConfig({ fanout: 0 }))).toThrow(/fanout/)
    expect(() => resolveConfig(baseConfig({ fanout: 33 }))).toThrow(/fanout/)
    expect(() => resolveConfig(baseConfig({ maxDepth: 5 }))).toThrow(/maxDepth/)
    expect(() => resolveConfig(baseConfig({ tokenBudget: -1 }))).toThrow(/tokenBudget/)
  })

  it('requires the total step budget to cover one child', () => {
    expect(() => resolveConfig(baseConfig({ totalStepBudget: 30 }))).toThrow(/totalStepBudget/)
    expect(resolveConfig(baseConfig({ totalStepBudget: 60 })).totalStepBudget).toBe(60)
  })

  it('rejects an unsafe deliverable directory', () => {
    expect(() => resolveConfig(baseConfig({ deliverableDir: '' }))).toThrow(/deliverableDir/)
    expect(() => resolveConfig(baseConfig({ deliverableDir: '../outside' }))).toThrow(/deliverableDir/)
  })

  it('requires a route for every phase when phase routing is enabled', () => {
    expect(() => resolveConfig(baseConfig({ modelPolicy: { mode: 'phase', phases: {} } }))).toThrow(/P0/)
    const config = resolveConfig(baseConfig({
      modelPolicy: {
        mode: 'phase',
        phases: {
          P0: { provider: 'p', model: 'm' },
          P1: { provider: 'p', model: 'm' },
          P2: { provider: 'p', model: 'm' },
          P3: { provider: 'p', model: 'm' },
        },
      },
    }))
    expect(config.modelPolicy.mode).toBe('phase')
  })
})

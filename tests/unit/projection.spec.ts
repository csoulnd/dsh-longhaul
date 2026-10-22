/**
 * Projection fold and wire view for the client chip.
 */
import { describe, expect, it } from 'vitest'
import { longhaulProjection } from '../../src/projection.ts'

function record(data: unknown): never {
  return {
    type: 'plugin:longhaul/state',
    seq: 1,
    time: Date.now(),
    data,
    ignorable: true,
  } as never
}

describe('longhaul projection', () => {
  it('starts off', () => {
    expect(longhaulProjection.init()).toEqual({
      mode: 'off',
      phase: 'P0',
      designVersion: 1,
      taskCount: 0,
      pending: '',
      steps: 0,
    })
  })

  it('folds a state record', () => {
    const next = longhaulProjection.apply(longhaulProjection.init(), record({
      mode: 'on',
      phase: 'P2',
      designVersion: 3,
      taskCount: 4,
      pending: 'P2',
      steps: 21,
      updatedAt: 1,
    }))
    expect(next).toEqual({
      mode: 'on',
      phase: 'P2',
      designVersion: 3,
      taskCount: 4,
      pending: 'P2',
      steps: 21,
    })
  })

  it('ignores foreign or malformed records', () => {
    const state = longhaulProjection.init()
    expect(longhaulProjection.apply(state, record({ mode: 'on' }))).toBe(state)
    expect(longhaulProjection.apply(state, {
      type: 'turn/end',
      seq: 2,
      time: Date.now(),
      data: { turn: 1, reason: 'completed' },
    } as never)).toBe(state)
  })
})

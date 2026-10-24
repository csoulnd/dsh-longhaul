/**
 * Projection fold and wire view for the client chip and task tree.
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
  it('starts off with no plan tasks', () => {
    expect(longhaulProjection.init()).toEqual({
      mode: 'off',
      phase: 'P0',
      designVersion: 1,
      taskCount: 0,
      pending: '',
      steps: 0,
      objective: '',
      planVersion: 0,
      tasks: [],
      deliverables: {},
      gates: [],
      evidence: {
        decisions: [],
        findings: [],
        artifacts: [],
        counts: { decisions: 0, findings: 0, artifacts: 0 },
      },
      updatedAt: 0,
    })
  })

  it('folds a state record with the task tree', () => {
    const next = longhaulProjection.apply(longhaulProjection.init(), record({
      mode: 'on',
      phase: 'P2',
      designVersion: 3,
      taskCount: 2,
      pending: 'P2',
      steps: 21,
      updatedAt: 1,
      objective: 'ship',
      planVersion: 4,
      tasks: [
        { id: 't1', title: 'gate', status: 'done', files: ['src/guard.ts'], dependsOn: [], budgetSteps: 20 },
        { id: 't2', title: 'flow', status: 'running', files: [], dependsOn: ['t1'], ownerSessionId: 'child-1' },
      ],
      deliverables: { P0: '.longhaul/deliverables/00-requirements.md' },
      gates: [{ phase: 'P0', status: 'done', deliverable: '.longhaul/deliverables/00-requirements.md' }],
      evidence: {
        decisions: [{ id: 'd1', text: 'use sidecar', time: 1 }],
        findings: [],
        artifacts: [],
        counts: { decisions: 1, findings: 0, artifacts: 0 },
      },
    }))
    expect(next).toEqual({
      mode: 'on',
      phase: 'P2',
      designVersion: 3,
      taskCount: 2,
      pending: 'P2',
      steps: 21,
      objective: 'ship',
      planVersion: 4,
      tasks: [
        { id: 't1', title: 'gate', status: 'done', files: ['src/guard.ts'], dependsOn: [], budgetSteps: 20 },
        { id: 't2', title: 'flow', status: 'running', files: [], dependsOn: ['t1'], ownerSessionId: 'child-1' },
      ],
      deliverables: { P0: '.longhaul/deliverables/00-requirements.md' },
      gates: [{ phase: 'P0', status: 'done', deliverable: '.longhaul/deliverables/00-requirements.md' }],
      evidence: {
        decisions: [{ id: 'd1', text: 'use sidecar', time: 1 }],
        findings: [],
        artifacts: [],
        counts: { decisions: 1, findings: 0, artifacts: 0 },
      },
      updatedAt: 1,
    })
  })

  it('defaults old records without task fields', () => {
    const next = longhaulProjection.apply(longhaulProjection.init(), record({
      mode: 'on',
      phase: 'P1',
      designVersion: 1,
      taskCount: 0,
      pending: '',
      steps: 0,
      updatedAt: 1,
    }))
    expect(next).toMatchObject({ objective: '', planVersion: 0, tasks: [] })
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

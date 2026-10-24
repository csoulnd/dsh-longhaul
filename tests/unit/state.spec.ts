/**
 * Durable mode-state transitions.
 */
import { describe, expect, it } from 'vitest'
import { initialState, reduce } from '../../src/state.ts'
import type { LonghaulState, StageApproval } from '../../src/types.ts'

function submitted(state: LonghaulState, phase: 'P0' | 'P1' | 'P2' | 'P3', decision?: 'allowed'): LonghaulState {
  const approval: StageApproval = {
    phase,
    deliverablePath: `/tmp/${phase}.md`,
    summary: 'done',
    requestedAt: 10,
    ...(decision === undefined ? {} : { decision }),
  }
  return reduce(state, { type: 'phase/submit', at: 10, approval })
}

describe('mode state', () => {
  it('starts off at P0 with no plan', () => {
    const state = initialState('root', 1)
    expect(state.mode).toBe('off')
    expect(state.phase).toBe('P0')
    expect(state.designVersion).toBe(1)
    expect(state.plan).toBeUndefined()
  })

  it('toggles mode without dropping durable progress', () => {
    const on = reduce(initialState('root', 1), { type: 'mode/on', at: 2 })
    const off = reduce(on, { type: 'mode/off', at: 3 })
    expect(off.mode).toBe('off')
    expect(off.phase).toBe('P0')
  })
})

describe('plan', () => {
  it('can only be recorded in P0', () => {
    const on = reduce(initialState('root', 1), { type: 'mode/on', at: 2 })
    const planned = reduce(on, {
      type: 'plan/set',
      at: 3,
      plan: { objective: 'o', createdAt: 3, version: 1, tasks: [] },
    })
    expect(planned.plan?.objective).toBe('o')
    expect(() => reduce({ ...planned, phase: 'P1' }, {
      type: 'plan/set',
      at: 4,
      plan: { objective: 'x', createdAt: 4, version: 2, tasks: [] },
    })).toThrow(/P0/)
  })

  it('rejects a silent second plan and versions an explicit revision', () => {
    const planned = reduce(reduce(initialState('root', 1), { type: 'mode/on', at: 2 }), {
      type: 'plan/set',
      at: 3,
      plan: { objective: 'first', createdAt: 3, version: 1, tasks: [] },
    })
    expect(() => reduce(planned, {
      type: 'plan/set',
      at: 4,
      plan: { objective: 'second', createdAt: 4, version: 1, tasks: [] },
    })).toThrow(/already exists/)
    const revised = reduce(planned, {
      type: 'plan/set',
      at: 5,
      plan: { objective: 'second', createdAt: 5, version: 1, tasks: [] },
      revision: { reason: 'scope changed' },
    })
    expect(revised.plan?.objective).toBe('second')
    expect(revised.plan?.version).toBe(2)
    expect(revised.plan?.createdAt).toBe(3)
    expect(() => reduce(planned, {
      type: 'plan/set',
      at: 6,
      plan: { objective: 'third', createdAt: 6, version: 1, tasks: [] },
      revision: { reason: '   ' },
    })).toThrow(/non-empty reason/)
  })

  it('recovers a missing P1 plan only once and only after an approved P0', () => {
    const approvedP0: StageApproval = {
      phase: 'P0',
      deliverablePath: '/tmp/P0.md',
      summary: 'done',
      requestedAt: 3,
      decision: 'allowed',
    }
    const atP1: LonghaulState = {
      ...reduce(initialState('root', 1), { type: 'mode/on', at: 2 }),
      phase: 'P1',
      lastApproved: approvedP0,
    }
    const recovered = reduce(atP1, {
      type: 'plan/recover',
      at: 7,
      plan: { objective: 'legacy', createdAt: 7, version: 1, tasks: [] },
      reason: 'legacy session had no plan',
    })
    expect(recovered.plan?.objective).toBe('legacy')
    expect(recovered.lastPlanRecovery?.reason).toBe('legacy session had no plan')
    expect(() => reduce(recovered, {
      type: 'plan/recover',
      at: 8,
      plan: { objective: 'again', createdAt: 8, version: 1, tasks: [] },
      reason: 'again',
    })).toThrow(/already exists/)
    expect(() => reduce({ ...atP1, lastApproved: undefined }, {
      type: 'plan/recover',
      at: 9,
      plan: { objective: 'no approval', createdAt: 9, version: 1, tasks: [] },
      reason: 'no approval',
    })).toThrow(/approved P0/)
  })

  it('recomputes file owners from updated tasks', () => {
    const planned = reduce(reduce(initialState('root', 1), { type: 'mode/on', at: 2 }), {
      type: 'plan/set',
      at: 3,
      plan: {
        objective: 'o',
        createdAt: 3,
        version: 1,
        tasks: [{ id: 't1', title: 'one', status: 'pending', files: ['src/a.ts'], dependsOn: [] }],
      },
    })
    const running = reduce(planned, {
      type: 'task/update',
      at: 4,
      task: { id: 't1', title: 'one', status: 'running', files: ['src/a.ts'], dependsOn: [], ownerSessionId: 'child' },
    })
    expect(running.fileOwners).toEqual({ 'src/a.ts': 'child' })
    expect(() => reduce(planned, {
      type: 'task/update',
      at: 4,
      task: { id: 'missing', title: 'x', status: 'done', files: [], dependsOn: [] },
    })).toThrow(/unknown task/)
  })
})

describe('stage gates', () => {
  const on = reduce(initialState('root', 1), { type: 'mode/on', at: 2 })

  it('records one pending submission per phase', () => {
    const pending = submitted(on, 'P0')
    expect(pending.pendingApproval?.phase).toBe('P0')
    expect(() => submitted(pending, 'P0')).toThrow(/already pending/)
    expect(() => submitted(on, 'P1')).toThrow(/does not match/)
  })

  it('advances only with an allowed decision and marks compaction pending', () => {
    const pending = submitted(on, 'P0')
    expect(() => reduce(pending, { type: 'phase/approve', at: 11, phase: 'P0' })).toThrow(/allowed/)

    const allowed = { ...pending, pendingApproval: { ...pending.pendingApproval!, decision: 'allowed' as const } }
    const next = reduce(allowed, { type: 'phase/approve', at: 12, phase: 'P0' })
    expect(next.phase).toBe('P1')
    expect(next.pendingApproval).toBeUndefined()
    expect(next.lastApproved?.phase).toBe('P0')
    expect(next.lastApproved?.summary).toBe('done')
    expect(next.compactPending).toBe(true)
  })

  it('keeps P3 after its approval', () => {
    const atP3 = submitted({ ...on, phase: 'P3' }, 'P3')
    const allowed = { ...atP3, pendingApproval: { ...atP3.pendingApproval!, decision: 'allowed' as const } }
    const done = reduce(allowed, { type: 'phase/approve', at: 12, phase: 'P3' })
    expect(done.phase).toBe('P3')
    expect(done.pendingApproval).toBeUndefined()
  })

  it('clears a rejected submission and keeps the phase', () => {
    const rejected = reduce(submitted(on, 'P0'), { type: 'phase/reject', at: 11, phase: 'P0', reason: 'needs work' })
    expect(rejected.phase).toBe('P0')
    expect(rejected.pendingApproval).toBeUndefined()
    expect(rejected.lastRejection).toEqual({ phase: 'P0', reason: 'needs work', at: 11 })
  })
})

describe('design changes', () => {
  const on = reduce(initialState('root', 1), { type: 'mode/on', at: 2 })
  const atP2 = { ...on, phase: 'P2' as const }

  it('increments the design version only when approved', () => {
    const withChange = reduce(atP2, {
      type: 'change/request',
      at: 3,
      request: { id: 'c1', title: 'x', evidence: 'e', impact: 'i', taskIds: ['t1'], status: 'proposed', createdAt: 3 },
    })
    const rejected = reduce(withChange, { type: 'change/decide', at: 4, id: 'c1', approved: false })
    expect(rejected.designVersion).toBe(1)
    expect(rejected.changes[0]?.status).toBe('rejected')

    const approved = reduce(withChange, { type: 'change/decide', at: 5, id: 'c1', approved: true })
    expect(approved.designVersion).toBe(2)
    expect(approved.changes[0]?.status).toBe('approved')
    expect(approved.compactPending).toBe(true)
    expect(() => reduce(approved, { type: 'change/decide', at: 6, id: 'c1', approved: true })).toThrow(/already/)
  })
})

describe('compaction flag', () => {
  it('tracks pending and done', () => {
    const on = reduce(initialState('root', 1), { type: 'mode/on', at: 2 })
    const pending = reduce(on, { type: 'compact/pending', at: 3 })
    expect(pending.compactPending).toBe(true)
    expect(reduce(pending, { type: 'compact/done', at: 4 }).compactPending).toBe(false)
  })
})

describe('budget observations', () => {
  it('starts, counts steps and usage, and keeps totals after finish', () => {
    const on = reduce(initialState('root', 1), { type: 'mode/on', at: 2 })
    const started = reduce(on, { type: 'budget/start', at: 3, sessionId: 'child', phase: 'P2' })
    expect(started.budget.children.child?.steps).toBe(0)

    const stepped = reduce(started, { type: 'budget/step', at: 4, sessionId: 'child' })
    const used = reduce(stepped, {
      type: 'budget/usage',
      at: 5,
      sessionId: 'child',
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 },
    })
    expect(used.budget.total).toEqual({ steps: 1, inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 })

    const finished = reduce(used, { type: 'budget/finish', at: 6, sessionId: 'child' })
    expect(finished.budget.children.child).toBeUndefined()
    expect(finished.budget.total.steps).toBe(1)
    expect(finished.budget.total.inputTokens).toBe(10)
  })

  it('ignores observations for unknown or duplicate children', () => {
    const on = reduce(initialState('root', 1), { type: 'mode/on', at: 2 })
    const stepped = reduce(on, { type: 'budget/step', at: 3, sessionId: 'missing' })
    expect(stepped).toBe(on)
    const started = reduce(on, { type: 'budget/start', at: 4, sessionId: 'child', phase: 'P2' })
    expect(reduce(started, { type: 'budget/start', at: 5, sessionId: 'child', phase: 'P2' })).toBe(started)
  })
})

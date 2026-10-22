import { describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.ts'
import { approvalReason, handoffText, modeNotice, policyText, stateContext } from '../../src/guidance.ts'
import { initialState } from '../../src/state.ts'
import type {
  LonghaulState,
  StageHandoff,
  TaskNode,
  TaskPlan,
} from '../../src/types.ts'

/** Minimal valid configuration with Long Haul defaults. */
function makeConfig(overrides: Partial<Config> = {}): Config {
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

/** Mode-on state for one root session. */
function makeState(overrides: Partial<LonghaulState> = {}): LonghaulState {
  return { ...initialState('root-1', 1_000), mode: 'on', ...overrides }
}

/** One task node with defaults. */
function taskNode(overrides: Partial<TaskNode> & Pick<TaskNode, 'id'>): TaskNode {
  return {
    title: `Task ${overrides.id}`,
    status: 'pending',
    files: [],
    dependsOn: [],
    ...overrides,
  }
}

/** One approved plan with defaults. */
function taskPlan(tasks: TaskNode[], overrides: Partial<TaskPlan> = {}): TaskPlan {
  return { objective: 'Ship the feature.', tasks, createdAt: 1_000, version: 1, ...overrides }
}

describe('policyText', () => {
  it('describes the P2 gate, the implementation block, the memory ACL, and the design-change loop', () => {
    const text = policyText(makeConfig())
    expect(text).toContain('P0 Requirements')
    expect(text).toContain('P1 Design')
    expect(text).toContain('P2 Development')
    expect(text).toContain('P3 Ship')
    expect(text).toContain('Implementation is forbidden until this design deliverable is approved.')
    expect(text).toContain('decisions are tree-wide and read-only')
    expect(text).toContain('findings are branch-only')
    expect(text).toContain('Only the parent promotes a finding into a decision')
    expect(text).toContain('design change request (DCR)')
    expect(text).toContain('design version increments')
    expect(text).toContain('at most 6 live children')
    expect(text).toContain('60 steps per child')
    expect(text.split('\n').length).toBeLessThanOrEqual(60)
  })

  it('uses the configured deliverable directory and budget limits', () => {
    const text = policyText(makeConfig({
      deliverableDir: 'docs\\longhaul',
      totalStepBudget: 500,
      tokenBudget: 100_000,
      maxChangeRequestsPerTask: 3,
    }))
    expect(text).toContain('docs/longhaul/deliverables/00-requirements.md')
    expect(text).toContain('500 tree-wide steps')
    expect(text).toContain('100000 tree-wide tokens')
    expect(text).toContain('at most 3 change requests')
  })

  it('returns a configured policy verbatim', () => {
    const custom = 'Deployment policy text.\nSecond line.\n'
    expect(policyText(makeConfig({ policyText: custom }))).toBe(custom)
  })
})

describe('stateContext', () => {
  it('returns an empty string while the mode is off', () => {
    expect(stateContext(makeState({ mode: 'off' }), makeConfig())).toBe('')
  })

  it('summarizes phase, plan counts, budget, pending approval, and open changes', () => {
    const state = makeState({
      phase: 'P2',
      designVersion: 2,
      plan: taskPlan([
        taskNode({ id: 't1', status: 'done', files: ['src/a.ts'] }),
        taskNode({ id: 't2', status: 'pending', files: ['src/b.ts'] }),
        taskNode({ id: 't3', status: 'running', ownerSessionId: 's1', files: ['src/c.ts'] }),
        taskNode({ id: 't4', status: 'blocked', files: ['src/d.ts'] }),
      ]),
      budget: {
        children: {},
        total: { steps: 120, inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 250 },
      },
      pendingApproval: {
        phase: 'P2',
        deliverablePath: '.longhaul/deliverables/02-implementation.md',
        summary: 'Ready.',
        requestedAt: 2_000,
      },
      changes: [{
        id: 'dcr-1',
        title: 'Interface change',
        evidence: 'test failure',
        impact: 'src/b.ts',
        taskIds: ['t2'],
        status: 'proposed',
        createdAt: 3_000,
      }],
    })
    expect(stateContext(state, makeConfig({ totalStepBudget: 500, tokenBudget: 10_000 }))).toBe([
      'Long Haul: mode on, phase P2 (Development), design version 2.',
      'Plan: 4 tasks (pending 1, running 1, done 1, blocked 1, cancelled 0).',
      'Budget: steps 120/500 used (380 remaining); tokens 1750/10000 used (8250 remaining); 1 running child.',
      'Pending approval: P2 Development at .longhaul/deliverables/02-implementation.md.',
      'Open design change requests: dcr-1 pauses t2.',
    ].join('\n'))
  })

  it('reports the last rejection when no approval is pending', () => {
    const state = makeState({
      phase: 'P1',
      lastRejection: { phase: 'P1', reason: 'missing sections: Modules', at: 4_000 },
    })
    const text = stateContext(state, makeConfig())
    expect(text).toContain('Last rejection: P1 Design - missing sections: Modules.')
    expect(text).not.toContain('Pending approval')
    expect(text).toContain('Plan: not approved.')
    expect(text).toContain('no tree step cap')
  })
})

describe('handoffText', () => {
  it('renders the fixed handoff sections in order', () => {
    const handoff: StageHandoff = {
      phase: 'P0',
      nextPhase: 'P1',
      deliverablePath: '.longhaul/deliverables/00-requirements.md',
      summary: 'Requirements are frozen.',
      decisionIds: ['d-1', 'd-2'],
      openQuestions: ['Does the API stay backward compatible?'],
      acceptanceCommands: ['pnpm test', 'pnpm typecheck'],
      budgetRemaining: 42,
      designVersion: 3,
    }
    expect(handoffText(handoff)).toBe([
      'Long Haul stage handoff',
      'Phase: P0 Requirements',
      'Next phase: P1 Design',
      'Deliverable: .longhaul/deliverables/00-requirements.md',
      'Summary: Requirements are frozen.',
      'Decisions: d-1, d-2',
      'Open questions:',
      '- Does the API stay backward compatible?',
      'Acceptance commands:',
      '- pnpm test',
      '- pnpm typecheck',
      'Budget remaining: 42 steps',
      'Design version: 3',
    ].join('\n'))
  })

  it('marks empty lists, a missing next phase, and an unbounded budget', () => {
    const handoff: StageHandoff = {
      phase: 'P3',
      deliverablePath: '.longhaul/deliverables/03-release.md',
      summary: 'Released.',
      decisionIds: [],
      openQuestions: [],
      acceptanceCommands: [],
      budgetRemaining: undefined,
      designVersion: 4,
    }
    expect(handoffText(handoff)).toBe([
      'Long Haul stage handoff',
      'Phase: P3 Ship',
      'Next phase: none',
      'Deliverable: .longhaul/deliverables/03-release.md',
      'Summary: Released.',
      'Decisions: none',
      'Open questions: none',
      'Acceptance commands: none',
      'Budget remaining: not limited',
      'Design version: 4',
    ].join('\n'))
  })
})

describe('modeNotice', () => {
  it('states the stage gate when the mode turns on', () => {
    expect(modeNotice(true)).toBe(
      'Long Haul mode is ON. Work is stage-gated: implementation stays blocked until the P1 Design deliverable is approved.',
    )
  })

  it('states that the gates no longer apply when the mode turns off', () => {
    expect(modeNotice(false)).toBe(
      'Long Haul mode is OFF. The Long Haul stage policy and gates no longer apply.',
    )
  })
})

describe('approvalReason', () => {
  it('names the pending deliverable and the implementation block for P1', () => {
    const state = makeState({
      phase: 'P1',
      pendingApproval: {
        phase: 'P1',
        deliverablePath: '.longhaul/deliverables/01-design.md',
        summary: 'Design ready.',
        requestedAt: 2_000,
      },
    })
    expect(approvalReason(state, 'P1')).toBe(
      'Approve P1 Design deliverable at .longhaul/deliverables/01-design.md? Implementation stays blocked until this approval.',
    )
  })

  it('stays stable when the submission summary changes', () => {
    const first = makeState({
      phase: 'P2',
      pendingApproval: {
        phase: 'P2',
        deliverablePath: '.longhaul/deliverables/02-implementation.md',
        summary: 'First summary.',
        requestedAt: 2_000,
      },
    })
    const second = makeState({
      phase: 'P2',
      pendingApproval: {
        phase: 'P2',
        deliverablePath: '.longhaul/deliverables/02-implementation.md',
        summary: 'Completely different summary.',
        requestedAt: 3_000,
      },
    })
    expect(approvalReason(first, 'P2')).toBe(approvalReason(second, 'P2'))
    expect(first.pendingApproval?.summary).not.toBe(second.pendingApproval?.summary)
  })
})

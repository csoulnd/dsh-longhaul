import { describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.ts'
import {
  dispatchProblem,
  ownershipConflicts,
  renderBrief,
  type BriefInput,
  type DispatchTask,
} from '../../src/dispatch.ts'
import { initialState } from '../../src/state.ts'
import type {
  DecisionRecord,
  FindingRecord,
  LonghaulState,
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

/** One proposed dispatch task with defaults. */
function dispatchTask(overrides: Partial<DispatchTask> & Pick<DispatchTask, 'id'>): DispatchTask {
  return {
    title: `Task ${overrides.id}`,
    files: [],
    acceptanceCommands: [],
    ...overrides,
  }
}

/** One decision record. */
function decisionRecord(id: string, text: string): DecisionRecord {
  return {
    id,
    kind: 'decision',
    authorSessionId: 'root-1',
    time: 1_000,
    version: 1,
    text,
    tags: [],
  }
}

/** One finding record. */
function findingRecord(id: string, text: string): FindingRecord {
  return {
    id,
    kind: 'finding',
    authorSessionId: 'child-1',
    time: 2_000,
    version: 1,
    text,
    tags: [],
  }
}

/** State with a P2 plan. */
function p2State(tasks: TaskNode[], overrides: Partial<LonghaulState> = {}): LonghaulState {
  return makeState({ phase: 'P2', plan: taskPlan(tasks), ...overrides })
}

describe('renderBrief', () => {
  it('contains every required section, the owned files, and the forbidden commands', () => {
    const state = p2State(
      [taskNode({ id: 't1', status: 'running', ownerSessionId: 's1', files: ['src/parser/index.ts'], budgetSteps: 25 })],
      {
        phase: 'P2',
        designVersion: 3,
        plan: taskPlan(
          [taskNode({ id: 't1', status: 'running', ownerSessionId: 's1', budgetSteps: 25 })],
          { objective: 'Replace the parser.', version: 4 },
        ),
        budget: {
          children: {},
          total: { steps: 120, inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 250 },
        },
      },
    )
    const input: BriefInput = {
      task: dispatchTask({
        id: 't1',
        title: 'Implement parser',
        files: ['src\\parser\\index.ts', 'tests/parser.spec.ts'],
        acceptanceCommands: ['pnpm test', 'pnpm typecheck'],
        notes: 'Keep the public API stable.',
      }),
      state,
      config: makeConfig({ totalStepBudget: 500 }),
      decisions: [decisionRecord('d-1', 'Use ESM with .ts imports.')],
      findings: [findingRecord('f-1', 'The parser rejects BOM input.')],
    }
    const text = renderBrief(input)
    for (const section of [
      '## Objective',
      '## Your task',
      '## Owned files',
      '## Acceptance commands',
      '## Constraints (decisions)',
      '## Branch findings (recent)',
      '## Stage and design version',
      '## Budget (steps)',
      '## Forbidden',
      '## Return format',
    ]) {
      expect(text).toContain(section)
    }
    expect(text).toContain('Replace the parser.')
    expect(text).toContain('t1: Implement parser')
    expect(text).toContain('Notes: Keep the public API stable.')
    expect(text).toContain('- src/parser/index.ts')
    expect(text).not.toContain('src\\parser\\index.ts')
    expect(text).toContain('- pnpm test')
    expect(text).toContain('- d-1: Use ESM with .ts imports.')
    expect(text).toContain('- f-1: The parser rejects BOM input.')
    expect(text).toContain('Phase P2 (Development), design version 3, plan version 4.')
    expect(text).toContain('Step cap: 25 steps.')
    expect(text).toContain('Tree steps used: 120/500 (380 remaining).')
    expect(text).toContain('git commit')
    expect(text).toContain('git push')
    expect(text).toContain('publish')
    expect(text).toContain('outside the Owned files list')
    expect(text).toContain('raise a design change request')
    expect(text).toContain('at most 800 characters')
    expect(text).toContain('- files:')
    expect(text).toContain('- tests:')
    expect(text).toContain('- blockers:')
    expect(text).toContain('- evidence:')
  })

  it('falls back to the configured child step budget and marks empty lists', () => {
    const input: BriefInput = {
      task: dispatchTask({ id: 't1', title: 'Read-only review' }),
      state: p2State([taskNode({ id: 't1' })], { plan: taskPlan([taskNode({ id: 't1' })]) }),
      config: makeConfig({ childStepBudget: 45 }),
      decisions: [],
      findings: [],
    }
    const text = renderBrief(input)
    expect(text).toContain('Step cap: 45 steps.')
    expect(text).toContain('(none; treat this task as read-only)')
    expect(text).toContain('(none specified)')
    expect(text.match(/\(none supplied\)/gu)).toHaveLength(2)
  })

  it('keeps only the most recent findings within the configured limit', () => {
    const input: BriefInput = {
      task: dispatchTask({ id: 't1' }),
      state: p2State([taskNode({ id: 't1' })]),
      config: makeConfig({ findingsInjectLimit: 2 }),
      decisions: [],
      findings: [
        findingRecord('f-1', 'oldest finding'),
        findingRecord('f-2', 'second finding'),
        findingRecord('f-3', 'third finding'),
        findingRecord('f-4', 'newest finding'),
      ],
    }
    const text = renderBrief(input)
    expect(text).not.toContain('oldest finding')
    expect(text).not.toContain('second finding')
    expect(text).toContain('third finding')
    expect(text).toContain('newest finding')
  })
})

describe('dispatchProblem', () => {
  it('allows a pending plan task in P2 below the fan-out limit', () => {
    const state = p2State([taskNode({ id: 't1', files: ['src/a.ts'] })])
    expect(dispatchProblem(state, [dispatchTask({ id: 't1' })], makeConfig())).toBeUndefined()
  })

  it('refuses when the mode is off', () => {
    const state = p2State([taskNode({ id: 't1' })], { mode: 'off' })
    expect(dispatchProblem(state, [dispatchTask({ id: 't1' })], makeConfig())).toBe('Long Haul mode is off')
  })

  it('refuses outside P2', () => {
    const state = makeState({ phase: 'P1', plan: taskPlan([taskNode({ id: 't1' })]) })
    expect(dispatchProblem(state, [dispatchTask({ id: 't1' })], makeConfig())).toBe(
      'dispatch is only allowed in P2 Development (current phase P1 Design)',
    )
  })

  it('refuses without an approved plan', () => {
    const state = makeState({ phase: 'P2' })
    expect(dispatchProblem(state, [dispatchTask({ id: 't1' })], makeConfig())).toBe(
      'no approved task plan exists; approve the plan before dispatching',
    )
  })

  it('refuses a task id that is not in the plan', () => {
    const state = p2State([taskNode({ id: 't1' })])
    expect(dispatchProblem(state, [dispatchTask({ id: 't2' })], makeConfig())).toBe(
      'task t2 is not in the approved plan',
    )
  })

  it('refuses a task that is already done', () => {
    const state = p2State([taskNode({ id: 't1', status: 'done' })])
    expect(dispatchProblem(state, [dispatchTask({ id: 't1' })], makeConfig())).toBe(
      'task t1 is done; only pending or running tasks can be dispatched',
    )
  })

  it('refuses a task paused by an open design change request', () => {
    const state = p2State([taskNode({ id: 't1' })], {
      changes: [{
        id: 'dcr-1',
        title: 'Interface change',
        evidence: 'test failure',
        impact: 'src/a.ts',
        taskIds: ['t1'],
        status: 'proposed',
        createdAt: 2_000,
      }],
    })
    expect(dispatchProblem(state, [dispatchTask({ id: 't1' })], makeConfig())).toBe(
      'task t1 is paused by open design change request dcr-1',
    )
  })

  it('refuses a dispatch that would exceed the fan-out limit', () => {
    const state = p2State([
      taskNode({ id: 't1', status: 'running', ownerSessionId: 's1' }),
      taskNode({ id: 't2', status: 'running', ownerSessionId: 's2' }),
      taskNode({ id: 't3' }),
    ])
    const tasks = [dispatchTask({ id: 't3' })]
    expect(dispatchProblem(state, tasks, makeConfig({ fanout: 2 }))).toBe(
      'dispatching 1 task would raise live children to 3, above the fan-out limit of 2 (2 already live)',
    )
    expect(dispatchProblem(state, tasks, makeConfig({ fanout: 3 }))).toBeUndefined()
  })

  it('does not count a running task twice when it is re-dispatched', () => {
    const state = p2State([
      taskNode({ id: 't1', status: 'running', ownerSessionId: 's1' }),
      taskNode({ id: 't2', status: 'running', ownerSessionId: 's2' }),
    ])
    expect(dispatchProblem(state, [dispatchTask({ id: 't1' })], makeConfig({ fanout: 2 }))).toBeUndefined()
  })

  it('refuses a running task while its owner is live, and allows takeover after it settles', () => {
    const state = p2State([taskNode({ id: 't1', status: 'running', ownerSessionId: 's1' })])
    expect(dispatchProblem(state, [dispatchTask({ id: 't1' })], makeConfig({ fanout: 2 }), new Set(['s1'])))
      .toMatch(/already running in session s1/)
    expect(dispatchProblem(state, [dispatchTask({ id: 't1' })], makeConfig({ fanout: 2 }), new Set()))
      .toBeUndefined()
  })
})

describe('ownershipConflicts', () => {
  it('normalizes separators and reports a file claimed by two tasks', () => {
    const state = p2State([])
    expect(ownershipConflicts(state, [
      dispatchTask({ id: 't1', files: ['src\\a.ts'] }),
      dispatchTask({ id: 't2', files: ['src/a.ts'] }),
    ])).toEqual(['file src/a.ts is assigned to more than one task (t1, t2)'])
  })

  it('reports a file listed twice by the same task', () => {
    const state = p2State([])
    expect(ownershipConflicts(state, [
      dispatchTask({ id: 't1', files: ['src/a.ts', 'src\\a.ts'] }),
    ])).toEqual(['task t1 lists file src/a.ts more than once'])
  })

  it('rejects absolute paths and paths containing ..', () => {
    const state = p2State([])
    expect(ownershipConflicts(state, [
      dispatchTask({ id: 't1', files: ['/etc/passwd', 'src/../secret.ts'] }),
    ])).toEqual([
      'file /etc/passwd is invalid: paths must be workspace-relative',
      'file src/../secret.ts is invalid: paths must not contain ".."',
    ])
  })

  it('allows files owned by a proposed task and rejects files owned by another session', () => {
    const state = makeState({
      phase: 'P2',
      plan: taskPlan([
        taskNode({ id: 't1', status: 'running', ownerSessionId: 's1', files: ['src/a.ts'] }),
      ]),
      fileOwners: { 'src\\a.ts': 's1', 'src/b.ts': 's2' },
    })
    expect(ownershipConflicts(state, [
      dispatchTask({ id: 't1', files: ['src/a.ts', 'src/b.ts'] }),
    ])).toEqual(['file src/b.ts is already owned by session s2'])
  })

  it('returns no conflicts for disjoint unowned files', () => {
    const state = p2State([taskNode({ id: 't1' }), taskNode({ id: 't2' })])
    expect(ownershipConflicts(state, [
      dispatchTask({ id: 't1', files: ['src/a.ts'] }),
      dispatchTask({ id: 't2', files: ['src/b.ts'] }),
    ])).toEqual([])
  })
})

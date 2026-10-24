/**
 * Tool handlers over a fake runtime: dispatch shaping and status reads.
 */
import { describe, expect, it } from 'vitest'
import { createLonghaulTools, type ToolRuntime } from '../../src/tools.ts'
import { initialState } from '../../src/state.ts'
import type { LonghaulState } from '../../src/types.ts'
import { baseConfig } from './helpers.ts'

const agent = { session: { header: { id: 'root', cwd: '/work' } } } as never

function state(): LonghaulState {
  return {
    ...initialState('root', 1),
    mode: 'on',
    phase: 'P2',
    plan: {
      objective: 'ship',
      createdAt: 1,
      version: 1,
      tasks: [{ id: 't1', title: 'one', status: 'pending', files: ['src/a.ts'], dependsOn: [] }],
    },
  }
}

function runtime(overrides: Partial<ToolRuntime> = {}): ToolRuntime {
  const current = state()
  return {
    config: baseConfig(),
    memoryFor: () => ({
      listDecisions: async () => [],
      listFindings: async () => [],
      listArtifacts: async () => [],
    }) as never,
    load: async () => current,
    save: async () => {},
    rootOf: () => 'root',
    rootSessionOf: () => 'root',
    parentOf: () => undefined,
    cwdOf: () => '/work',
    approve: async () => 'allowed-once',
    notify: () => {},
    budgetReport: () => ({
      verdicts: {},
      total: { steps: 3, inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 },
      remainingSteps: undefined,
      exceeded: [],
    }),
    dispatch: async (_agent, tasks) => tasks.map((task, index) => ({ taskId: task.id, childId: `child-${index}` })),
    ...overrides,
  }
}

describe('longhaul_dispatch', () => {
  it('shapes tasks and returns started children', async () => {
    const tool = createLonghaulTools(runtime()).find(candidate => candidate.name === 'longhaul_dispatch')
    expect(tool).toBeDefined()
    const result = await tool!.execute({
      tasks: [{ id: 't1', title: 'one', files: ['src/a.ts'], acceptanceCommands: ['pnpm test'] }],
    }, { agent } as never) as { summary: string; started: { taskId: string; childId: string }[] }
    expect(result.started).toEqual([{ taskId: 't1', childId: 'child-0' }])
    expect(result.summary).toMatch(/Started 1 child/)
  })

  it('propagates a refused dispatch', async () => {
    const tool = createLonghaulTools(runtime({ dispatch: async () => { throw new Error('fan-out exceeded') } }))
      .find(candidate => candidate.name === 'longhaul_dispatch')
    await expect(tool!.execute({
      tasks: [{ id: 't1', title: 'one', files: ['src/a.ts'], acceptanceCommands: [] }],
    }, { agent } as never)).rejects.toThrow(/fan-out exceeded/)
  })
})

describe('longhaul_status', () => {
  it('reports phase, plan size, and budget', async () => {
    const tool = createLonghaulTools(runtime()).find(candidate => candidate.name === 'longhaul_status')
    const result = await tool!.execute({}, { agent } as never) as { summary: string; phase: string; taskCount: number; steps: number }
    expect(result.phase).toBe('P2')
    expect(result.taskCount).toBe(1)
    expect(result.steps).toBe(3)
    expect(result.summary).toMatch(/design v1/)
  })
})

describe('longhaul_plan lifecycle', () => {
  it('records, refuses silent overwrite, and revises with a reason', async () => {
    let current: LonghaulState = { ...initialState('root', 1), mode: 'on', phase: 'P0' }
    const tool = createLonghaulTools(runtime({
      load: async () => current,
      save: async (_agent, next) => { current = next },
    })).find(candidate => candidate.name === 'longhaul_plan')
    expect(tool).toBeDefined()

    const first = await tool!.execute({
      objective: 'ship',
      tasks: [{ id: 't1', title: 'one', files: ['src/a.ts'], dependsOn: [] }],
    }, { agent } as never) as { taskCount: number }
    expect(first.taskCount).toBe(1)
    expect(current.plan?.version).toBe(1)

    await expect(tool!.execute({
      objective: 'ship again',
      tasks: [{ id: 't1', title: 'one', files: ['src/a.ts'], dependsOn: [] }],
    }, { agent } as never)).rejects.toThrow(/already exists/)

    await tool!.execute({
      mode: 'revise',
      reason: 'scope changed',
      objective: 'ship revised',
      tasks: [{ id: 't1', title: 'one', files: ['src/a.ts'], dependsOn: [] }],
    }, { agent } as never)
    expect(current.plan?.objective).toBe('ship revised')
    expect(current.plan?.version).toBe(2)
  })

  it('recovers a missing plan in P1 only from an approved P0', async () => {
    let current: LonghaulState = {
      ...initialState('root', 1),
      mode: 'on',
      phase: 'P1',
      lastApproved: {
        phase: 'P0',
        deliverablePath: '.longhaul/deliverables/00-requirements.md',
        summary: 'approved',
        requestedAt: 1,
        decision: 'allowed',
      },
    }
    const tool = createLonghaulTools(runtime({
      load: async () => current,
      save: async (_agent, next) => { current = next },
    })).find(candidate => candidate.name === 'longhaul_plan')

    await tool!.execute({
      mode: 'recover',
      reason: 'legacy session had no plan',
      objective: 'recover',
      tasks: [{ id: 't1', title: 'one', files: [], dependsOn: [] }],
    }, { agent } as never)
    expect(current.plan?.objective).toBe('recover')
    expect(current.lastPlanRecovery?.reason).toBe('legacy session had no plan')

    await expect(tool!.execute({
      mode: 'recover',
      reason: 'again',
      objective: 'again',
      tasks: [{ id: 't1', title: 'one', files: [], dependsOn: [] }],
    }, { agent } as never)).rejects.toThrow(/already exists/)
  })
})

describe('longhaul_submit plan gate', () => {
  it('refuses a P0 submission without a plan and does not write pending approval', async () => {
    let current: LonghaulState = { ...initialState('root', 1), mode: 'on', phase: 'P0' }
    const tool = createLonghaulTools(runtime({
      load: async () => current,
      save: async (_agent, next) => { current = next },
    })).find(candidate => candidate.name === 'longhaul_submit')

    await expect(tool!.execute({ summary: 'no plan' }, { agent } as never))
      .rejects.toThrow(/requires a task plan/)
    expect(current.pendingApproval).toBeUndefined()
  })
})

describe('longhaul_task', () => {
  it('updates a plan task status and owner', async () => {
    let current: LonghaulState = state()
    const tool = createLonghaulTools(runtime({
      load: async () => current,
      save: async (_agent, next) => { current = next },
    })).find(candidate => candidate.name === 'longhaul_task')
    expect(tool).toBeDefined()

    const result = await tool!.execute({
      taskId: 't1',
      status: 'running',
      ownerSessionId: 'child-1',
    }, { agent } as never) as { summary: string; taskId: string; status: string }
    expect(result).toEqual({
      summary: 'Task t1 is running (owner child-1).',
      taskId: 't1',
      status: 'running',
    })
    expect(current.plan?.tasks[0]?.status).toBe('running')
    expect(current.plan?.tasks[0]?.ownerSessionId).toBe('child-1')

    await expect(tool!.execute({ taskId: 'missing', status: 'done' }, { agent } as never))
      .rejects.toThrow(/not in the approved plan/)
  })
})

describe('longhaul_memory from a child', () => {
  it('allows branch findings but refuses decisions and promotion', async () => {
    const findings: string[] = []
    const store = {
      appendFinding: async (_sessionId: string, input: { text: string }) => { findings.push(input.text) },
      appendDecision: async () => { throw new Error('unexpected decision write') },
      listDecisions: async () => [],
      listFindings: async () => [],
      listArtifacts: async () => [],
      promote: async () => { throw new Error('unexpected promote') },
    }
    const tool = createLonghaulTools(runtime({
      rootOf: () => undefined,
      rootSessionOf: () => 'root',
      memoryFor: () => store as never,
    })).find(candidate => candidate.name === 'longhaul_memory')
    const child = { session: { header: { id: 'child', cwd: '/work', parentSession: 'root' } } } as never

    await tool!.execute({ action: 'append_finding', text: 'pitfall' }, { agent: child } as never)
    expect(findings).toEqual(['pitfall'])
    await expect(tool!.execute({ action: 'append_decision', text: 'x' }, { agent: child } as never))
      .rejects.toThrow(/only the root session/)
    await expect(tool!.execute({ action: 'promote', findingId: 'f1' }, { agent: child } as never))
      .rejects.toThrow(/only the root session/)
  })
})

describe('longhaul_memory artifacts', () => {
  it('records an artifact for the root', async () => {
    const artifacts: { text: string; path: string }[] = []
    const store = {
      appendArtifact: async (_sessionId: string, input: { text: string; path: string }) => {
        artifacts.push(input)
      },
      appendFinding: async () => { throw new Error('unexpected finding write') },
      appendDecision: async () => { throw new Error('unexpected decision write') },
      listDecisions: async () => [],
      listFindings: async () => [],
      listArtifacts: async () => artifacts,
      promote: async () => { throw new Error('unexpected promote') },
    }
    const tool = createLonghaulTools(runtime({ memoryFor: () => store as never }))
      .find(candidate => candidate.name === 'longhaul_memory')

    const result = await tool!.execute({
      action: 'append_artifact',
      text: 'implementation evidence',
      path: '.longhaul/deliverables/02-implementation.md',
    }, { agent } as never) as { artifacts: number }
    expect(artifacts).toEqual([{
      text: 'implementation evidence',
      path: '.longhaul/deliverables/02-implementation.md',
    }])
    expect(result.artifacts).toBe(1)
  })
})

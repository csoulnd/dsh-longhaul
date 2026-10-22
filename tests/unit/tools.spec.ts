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

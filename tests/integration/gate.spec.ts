/**
 * Real Cordis composition for the P0/P1 gate: the plugin's tools/pre-execute
 * hook denies implementation writes and shell writes, fails closed on a corrupt
 * state, resolves deliverables through the workingDirectory service, and
 * enforces positive file ownership for P2 children.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../src/index.ts'
import { initialState } from '../../src/state.ts'
import type { LonghaulState } from '../../src/types.ts'
import { baseConfig } from '../unit/helpers.ts'

let home = ''
let workspace = ''

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'longhaul-gate-'))
  workspace = await mkdtemp(join(tmpdir(), 'longhaul-workspace-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
})

interface FakeAgent {
  session: {
    header: {
      id: string
      parentSession?: string
      cwd: string
    }
  }
  inject(message: unknown): void
}

interface RegisteredTool {
  name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

function fakeAgent(id: string, parentSession?: string): FakeAgent {
  return {
    session: {
      header: {
        id,
        cwd: home,
        ...(parentSession === undefined ? {} : { parentSession }),
      },
    },
    inject: () => {},
  }
}

function provide(ctx: Context, service: string, value: object): void {
  ctx.reflect.provide(service as never, value as never)
}

async function seedState(state: LonghaulState): Promise<void> {
  await mkdir(join(home, 'longhaul', 'root'), { recursive: true })
  await writeFile(join(home, 'longhaul', 'root', 'state.json'), `${JSON.stringify(state)}\n`, 'utf8')
}

interface Harness {
  ctx: Context
  tools: RegisteredTool[]
  root: FakeAgent
  child: FakeAgent
}

function mount(options: { agents?: FakeAgent[] } = {}): Harness {
  const root = options.agents?.find(agent => agent.session.header.id === 'root') ?? fakeAgent('root')
  const child = options.agents?.find(agent => agent.session.header.id === 'child-1')
    ?? fakeAgent('child-1', 'root')
  const agents = options.agents ?? [root, child]
  const tools: RegisteredTool[] = []
  const ctx = new Context()
  provide(ctx, 'agents', {
    list: () => agents,
    get: (id: string) => agents.find(agent => agent.session.header.id === id),
  })
  provide(ctx, 'tools', { register: (tool: RegisteredTool) => { tools.push(tool); return () => {} } })
  provide(ctx, 'systemPrompt', { section: () => () => {}, context: () => () => {} })
  provide(ctx, 'workingDirectory', { get: () => workspace })
  provide(ctx, 'approval', { request: async () => 'allowed-once' })
  apply(ctx, baseConfig())
  return { ctx, tools, root, child }
}

type Decision = { kind?: string; reason?: string } | undefined

async function runGate(harness: Harness, agent: FakeAgent, name: string, args: unknown): Promise<Decision> {
  return await harness.ctx.waterfall(
    'tools/pre-execute',
    { agent, name, arguments: args } as never,
    () => Promise.resolve(undefined as never),
  ) as Decision
}

function p0State(): LonghaulState {
  return { ...initialState('root', 1), mode: 'on', phase: 'P0' }
}

describe('tools/pre-execute gate', () => {
  it('denies P0 implementation writes and shell writes while allowing read-only commands and deliverables', async () => {
    await seedState(p0State())
    const harness = mount()
    await new Promise(resolve => setTimeout(resolve, 10))

    const write = await runGate(harness, harness.root, 'write', { path: 'src/a.ts' })
    expect(write?.kind).toBe('deny')
    const shell = await runGate(harness, harness.root, 'pwsh', { command: 'Set-Content src/a.ts x' })
    expect(shell?.kind).toBe('deny')
    const read = await runGate(harness, harness.root, 'pwsh', { command: 'git status' })
    expect(read).toBeUndefined()
    const deliverable = await runGate(harness, harness.root, 'write', {
      path: '.longhaul/deliverables/00-requirements.md',
    })
    expect(deliverable).toBeUndefined()
  })

  it('fails closed for writes when the state file is corrupt but keeps read-only shell usable', async () => {
    await mkdir(join(home, 'longhaul', 'root'), { recursive: true })
    await writeFile(join(home, 'longhaul', 'root', 'state.json'), '{not json}\n', 'utf8')
    const harness = mount()
    await new Promise(resolve => setTimeout(resolve, 10))

    const write = await runGate(harness, harness.root, 'write', {
      path: '.longhaul/deliverables/00-requirements.md',
    })
    expect(write?.kind).toBe('deny')
    expect(write?.reason).toMatch(/state is unreadable/)
    const read = await runGate(harness, harness.root, 'pwsh', { command: 'git status' })
    expect(read).toBeUndefined()
  })

  it('resolves the deliverable through workingDirectory, not session.header.cwd', async () => {
    const state: LonghaulState = {
      ...p0State(),
      plan: {
        objective: 'ship',
        createdAt: 1,
        version: 1,
        tasks: [{ id: 't1', title: 'one', status: 'pending', files: [], dependsOn: [] }],
      },
    }
    await seedState(state)
    await mkdir(join(workspace, '.longhaul', 'deliverables'), { recursive: true })
    await writeFile(
      join(workspace, '.longhaul', 'deliverables', '00-requirements.md'),
      '# Requirements\n\n## Goal\nx\n## Scope\nx\n## Non-goals\nx\n## Acceptance\nx\n## Constraints\nx\n## Risks\nx\n## Budget\nx\n',
      'utf8',
    )
    const harness = mount()
    await new Promise(resolve => setTimeout(resolve, 10))
    const submit = harness.tools.find(tool => tool.name === 'longhaul_submit')
    expect(submit).toBeDefined()

    const result = await submit!.execute({ summary: 'ok' }, {
      agent: harness.root,
      signal: new AbortController().signal,
    }) as { approved: boolean; nextPhase: string }
    expect(result.approved).toBe(true)
    expect(result.nextPhase).toBe('P1')
    const persisted = JSON.parse(await readFile(join(home, 'longhaul', 'root', 'state.json'), 'utf8')) as LonghaulState
    expect(persisted.phase).toBe('P1')
    expect(persisted.lastApproved?.deliverablePath).toBe(join(workspace, '.longhaul', 'deliverables', '00-requirements.md'))
  })

  it('denies a P2 child write outside its owned files and allows its own file', async () => {
    const state: LonghaulState = {
      ...initialState('root', 1),
      mode: 'on',
      phase: 'P2',
      plan: {
        objective: 'ship',
        createdAt: 1,
        version: 1,
        tasks: [{
          id: 't1',
          title: 'one',
          status: 'running',
          ownerSessionId: 'child-1',
          files: ['src/a.ts'],
          dependsOn: [],
        }],
      },
      fileOwners: { 'src/a.ts': 'child-1' },
    }
    await seedState(state)
    const harness = mount()
    await new Promise(resolve => setTimeout(resolve, 10))

    const own = await runGate(harness, harness.child, 'write', { path: 'src/a.ts' })
    expect(own).toBeUndefined()
    const unowned = await runGate(harness, harness.child, 'write', { path: 'src/b.ts' })
    expect(unowned?.kind).toBe('deny')
    expect(unowned?.reason).toMatch(/may only write files owned/)
    const shell = await runGate(harness, harness.child, 'pwsh', { command: 'Set-Content src/b.ts x' })
    expect(shell?.kind).toBe('deny')
  })

  it('keeps a settled child in the root branch for finding visibility and promote', async () => {
    const state: LonghaulState = {
      ...initialState('root', 1),
      mode: 'on',
      phase: 'P2',
      plan: {
        objective: 'ship',
        createdAt: 1,
        version: 1,
        tasks: [{
          id: 't1',
          title: 'one',
          status: 'done',
          ownerSessionId: 'child-1',
          files: ['src/a.ts'],
          dependsOn: [],
        }],
      },
      fileOwners: { 'src/a.ts': 'child-1' },
    }
    await seedState(state)
    const findingsDir = join(home, 'longhaul', 'root', 'findings')
    await mkdir(findingsDir, { recursive: true })
    await writeFile(
      join(findingsDir, 'child-1.jsonl'),
      `${JSON.stringify({
        id: 'f1',
        kind: 'finding',
        authorSessionId: 'child-1',
        time: 1,
        version: 1,
        text: 'settled child finding',
        tags: [],
      })}\n`,
      'utf8',
    )

    const root = fakeAgent('root')
    const harness = mount({ agents: [root] })
    await new Promise(resolve => setTimeout(resolve, 10))
    const memory = harness.tools.find(tool => tool.name === 'longhaul_memory')
    expect(memory).toBeDefined()

    const listed = await memory!.execute({ action: 'list' }, {
      agent: root,
      signal: new AbortController().signal,
    }) as { findings: number }
    expect(listed.findings).toBe(1)

    const promoted = await memory!.execute({ action: 'promote', findingId: 'f1' }, {
      agent: root,
      signal: new AbortController().signal,
    }) as { decisions: number }
    expect(promoted.decisions).toBe(1)
  })
})

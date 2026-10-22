/**
 * Phase-exit compaction scheduling against a real Session and Cordis event bus:
 * the fake compaction backend records the call and the handoff message is
 * injected only after compaction completes.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import { apply } from '../../src/index.ts'
import { initialState } from '../../src/state.ts'
import { baseConfig } from '../unit/helpers.ts'

let home = ''

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'longhaul-compact-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
})

function provide(ctx: Context, service: string, value: object): void {
  ctx.reflect.provide(service as never, value as never)
}

describe('phase-exit compaction', () => {
  it('compacts at turn end and injects the handoff after it settles', async () => {
    const session = Session.create('root', [], {
      version: 4,
      id: 'root',
      createdAt: Date.now(),
      cwd: home,
      isSeeded: false,
    }, 0)
    const injected: unknown[] = []
    const agent = {
      session,
      options: { provider: 'test', model: 'test' },
      status: 'idle',
      ctx: {},
      runMaintenance: async (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal),
      inject: (message: unknown) => { injected.push(message) },
      cancel: () => {},
    } as never

    // Seed durable state as if P0 had just been approved.
    const state = {
      ...initialState('root', Date.now()),
      mode: 'on' as const,
      phase: 'P1' as const,
      compactPending: true,
      lastApproved: {
        phase: 'P0' as const,
        deliverablePath: join(home, '.longhaul/deliverables/00-requirements.md'),
        summary: 'requirements ready',
        requestedAt: Date.now(),
        decision: 'allowed' as const,
      },
    }
    await mkdir(join(home, 'longhaul', 'root'), { recursive: true })
    await writeFile(join(home, 'longhaul', 'root', 'state.json'), `${JSON.stringify(state)}\n`, 'utf8')

    const ctx = new Context()
    let compactions = 0
    provide(ctx, 'agents', {
      list: () => [agent],
      get: (id: string) => (id === 'root' ? agent : undefined),
    })
    provide(ctx, 'tools', { register: () => () => {} })
    provide(ctx, 'systemPrompt', { section: () => () => {}, context: () => () => {} })
    provide(ctx, 'compaction', { compactNow: async () => { compactions += 1; return null } })

    apply(ctx, baseConfig())

    // Let the preload read the seeded state.
    await new Promise(resolve => setTimeout(resolve, 10))
    ctx.emit('session/event', session, {
      type: 'turn/end',
      seq: 1,
      time: Date.now(),
      data: { turn: 1, reason: 'completed' },
    })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(compactions).toBe(1)
    const text = JSON.stringify(injected)
    expect(text).toContain('Long Haul stage handoff')
    expect(text).toContain('requirements ready')

    const persisted = JSON.parse(await readFile(join(home, 'longhaul', 'root', 'state.json'), 'utf8')) as { compactPending: boolean }
    expect(persisted.compactPending).toBe(false)
  })
})

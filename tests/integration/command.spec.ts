/**
 * The `/longhaul` command: risk approval before enabling, and durable state.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import { apply } from '../../src/index.ts'
import { baseConfig } from '../unit/helpers.ts'

let home = ''

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'longhaul-command-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
})

function provide(ctx: Context, service: string, value: object): void {
  ctx.reflect.provide(service as never, value as never)
}

describe('/longhaul command', () => {
  it('asks for risk approval before enabling and persists the mode', async () => {
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
      inject: (message: unknown) => { injected.push(message) },
      cancel: () => {},
    } as never

    type CommandHandler = (input: { agent: unknown; rawInput: string }) => Promise<{ kind: string; text: string }>
    let command: { handler: CommandHandler } | undefined

    const ctx = new Context()
    provide(ctx, 'agents', { list: () => [agent], get: (id: string) => (id === 'root' ? agent : undefined) })
    provide(ctx, 'tools', { register: () => () => {} })
    provide(ctx, 'systemPrompt', { section: () => () => {}, context: () => () => {} })
    provide(ctx, 'commands', {
      register: (definition: { handler: CommandHandler }) => {
        command = definition
        return () => {}
      },
    })

    apply(ctx, baseConfig())
    await Promise.resolve()
    await Promise.resolve()
    expect(command).toBeDefined()

    const result = await command!.handler({ agent, rawInput: 'on' })
    expect(result.kind).toBe('success')
    expect(JSON.stringify(injected)).toContain('Long Haul mode is ON')

    const persisted = JSON.parse(await readFile(join(home, 'longhaul', 'root', 'state.json'), 'utf8')) as { mode: string }
    expect(persisted.mode).toBe('on')

    const off = await command!.handler({ agent, rawInput: 'off' })
    expect(off.kind).toBe('success')
    const afterOff = JSON.parse(await readFile(join(home, 'longhaul', 'root', 'state.json'), 'utf8')) as { mode: string }
    expect(afterOff.mode).toBe('off')
  })
})

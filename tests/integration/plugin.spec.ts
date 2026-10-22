/**
 * Real Cordis composition: the plugin registers its guidance, tools, and
 * command against stub services, and `longhaul_status` reads durable state.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, name, inject } from '../../src/index.ts'
import { baseConfig } from '../unit/helpers.ts'

interface RegisteredTool {
  name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

interface SectionDefinition {
  name: string
  order: number
  text(context: { agent?: unknown }): string
}

interface CommandDefinition {
  name: string
}

let home = ''

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'longhaul-plugin-'))
  process.env.DSH_HOME = home
})

afterAll(async () => {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
})

/** Provide a stub service without importing the full service class. */
function provide(ctx: Context, service: string, value: object): void {
  ctx.reflect.provide(service as never, value as never)
}

describe('plugin composition', () => {
  it('registers the five tools, the policy section, and the command', async () => {
    const ctx = new Context()
    const tools: RegisteredTool[] = []
    const sections: SectionDefinition[] = []
    const contexts: SectionDefinition[] = []
    const commands: CommandDefinition[] = []
    provide(ctx, 'agents', { list: () => [], get: () => undefined })
    provide(ctx, 'tools', { register: (tool: RegisteredTool) => { tools.push(tool); return () => {} } })
    provide(ctx, 'systemPrompt', {
      section: (section: SectionDefinition) => { sections.push(section); return () => {} },
      context: (section: SectionDefinition) => { contexts.push(section); return () => {} },
    })
    provide(ctx, 'commands', { register: (command: CommandDefinition) => { commands.push(command); return () => {} } })

    apply(ctx, baseConfig())
    await Promise.resolve()
    await Promise.resolve()

    expect(name).toBe('longhaul')
    expect(inject).toEqual(['agents', 'tools', 'systemPrompt'])
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'longhaul_change',
      'longhaul_memory',
      'longhaul_plan',
      'longhaul_status',
      'longhaul_submit',
    ])
    expect(sections[0]?.name).toBe('longhaul:policy')
    expect(sections[0]?.order).toBe(700)
    expect(contexts[0]?.name).toBe('longhaul:state')
    expect(commands.map(command => command.name)).toEqual(['longhaul'])
  })

  it('keeps the policy and state sections empty while the mode is off', async () => {
    const ctx = new Context()
    const tools: RegisteredTool[] = []
    const sections: SectionDefinition[] = []
    const contexts: SectionDefinition[] = []
    provide(ctx, 'agents', { list: () => [], get: () => undefined })
    provide(ctx, 'tools', { register: (tool: RegisteredTool) => { tools.push(tool); return () => {} } })
    provide(ctx, 'systemPrompt', {
      section: (section: SectionDefinition) => { sections.push(section); return () => {} },
      context: (section: SectionDefinition) => { contexts.push(section); return () => {} },
    })

    apply(ctx, baseConfig())

    const fakeAgent = { session: { header: { id: 'root-1', cwd: home } } }
    expect(sections[0]?.text({ agent: fakeAgent })).toBe('')
    expect(contexts[0]?.text({ agent: fakeAgent })).toBe('')

    const status = tools.find(tool => tool.name === 'longhaul_status')
    expect(status).toBeDefined()
    const result = await status!.execute({}, { agent: fakeAgent, signal: new AbortController().signal }) as { mode: string; summary: string }
    expect(result.mode).toBe('off')
    expect(result.summary).toMatch(/off/)
  })
})

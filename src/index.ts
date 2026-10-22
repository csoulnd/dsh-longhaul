/**
 * Long Haul host plugin: registers model guidance, the five `longhaul_*` tools,
 * and the `/longhaul` command; owns durable mode state, tree memory, and the
 * phase-approval gate. Phase, memory, budget, and dispatch rules live in their
 * own modules so they stay testable without a Cordis runtime.
 *
 * @module dsh-longhaul
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type {} from '@deepseek-ai/dsh-compaction'
import { boundContextSummary, createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { evaluateBudget } from './budget.ts'
import type { BudgetReport, LonghaulState, StageHandoff } from './types.ts'
import { Config, resolveConfig } from './config.ts'
import { handoffText, modeNotice, policyText, stateContext } from './guidance.ts'
import { LonghaulMemory } from './memory.ts'
import { deliverablePath } from './phases.ts'
import { initialState, reduce } from './state.ts'
import { createLonghaulTools, type ToolRuntime } from './tools.ts'

export { Config }
export type { Config as LonghaulConfig } from './config.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Long Haul's own model-visible notice source. */
    longhaul: { kind: 'longhaul' } & ContextFormed
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'longhaul'

/** Services the plugin cannot work without. */
export const inject = ['agents', 'tools', 'systemPrompt']

/** Durable artifact root under the harness home. */
function longhaulHome(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'longhaul')
}

/** One state file per root session. */
function statePath(rootSessionId: string): string {
  return join(longhaulHome(), rootSessionId, 'state.json')
}

/** Parse one persisted state file, failing loud on a foreign or corrupt shape. */
function parseState(rootSessionId: string, text: string): LonghaulState {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`longhaul: state for ${rootSessionId} is not valid JSON: ${String(error)}`)
  }
  if (typeof value !== 'object' || value === null) throw new Error(`longhaul: state for ${rootSessionId} is not an object`)
  const state = value as LonghaulState
  if (state.version !== 1) throw new Error(`longhaul: state for ${rootSessionId} has unsupported version ${String(state.version)}`)
  if (state.rootSessionId !== rootSessionId) {
    throw new Error(`longhaul: state for ${rootSessionId} belongs to ${String(state.rootSessionId)}`)
  }
  return state
}

/** Root session id of an agent, or undefined for a delegated child. */
function rootOf(agent: Agent): string | undefined {
  const parent = agent.session.header.parentSession
  return parent === undefined ? String(agent.session.header.id) : undefined
}

/**
 * Register Long Haul on one host context.
 * @param ctx - plugin context carrying agents, tools, and the prompt registry.
 * @param config - validated deployment configuration from cordis.yml.
 */
export function apply(ctx: Context, config: Config): void {
  const settings = resolveConfig(config)
  const states = new Map<string, LonghaulState>()
  const memoryFor = (rootSessionId: string): LonghaulMemory =>
    new LonghaulMemory({ baseDir: longhaulHome(), rootSessionId })

  const rootFor = (agent: Agent): string => {
    const root = rootOf(agent)
    if (root === undefined) throw new Error('longhaul: this action is only available in the root session')
    return root
  }

  const parentOf = (sessionId: string): string | undefined => {
    for (const agent of ctx.agents.list()) {
      if (String(agent.session.header.id) === sessionId) {
        const parent = agent.session.header.parentSession
        return parent === undefined ? undefined : String(parent)
      }
    }
    return undefined
  }

  const load = async (agent: Agent): Promise<LonghaulState> => {
    const root = rootFor(agent)
    const cached = states.get(root)
    if (cached !== undefined) return cached
    let state: LonghaulState
    try {
      state = parseState(root, await readFile(statePath(root), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      state = initialState(root, Date.now())
    }
    states.set(root, state)
    return state
  }

  const persist = async (agent: Agent, state: LonghaulState): Promise<void> => {
    const root = state.rootSessionId
    states.set(root, state)
    const path = statePath(root)
    await mkdir(join(longhaulHome(), root), { recursive: true })
    const temporary = `${path}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, 'utf8')
    await rename(temporary, path)
    try {
      appendPluginRecord(agent.session, 'plugin:longhaul/state', {
        mode: state.mode,
        phase: state.phase,
        designVersion: state.designVersion,
        updatedAt: state.updatedAt,
      })
    } catch (error) {
      ctx.logger.warn(`longhaul: state saved but the audit record was rejected: ${String(error)}`)
    }
  }

  const budgetReport = (state: LonghaulState): BudgetReport => evaluateBudget(state.budget, {
    childStepBudget: settings.childStepBudget,
    totalStepBudget: settings.totalStepBudget,
    tokenBudget: settings.tokenBudget,
  })

  const approve = async (agent: Agent, toolName: string, reason: string): Promise<ApprovalOutcome> => {
    const approval = ctx.get('approval')
    if (approval === undefined) return 'unavailable'
    return approval.request({
      agent,
      toolName,
      reason,
      displayReason: { en: reason, zh: reason },
    })
  }

  const notify = (agent: Agent, text: string): void => {
    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'longhaul', form: 'notice', summary: boundContextSummary(text) },
    }))
  }

  const runtime: ToolRuntime = {
    config: settings,
    memoryFor,
    load,
    save: persist,
    rootOf,
    parentOf,
    cwdOf: agent => agent.session.header.cwd ?? process.cwd(),
    approve,
    notify,
    budgetReport,
  }

  // Guidance: stable policy prose plus a compact per-turn state block.
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'longhaul:policy',
    order: 700,
    text: (context) => {
      if (context.agent === undefined) return ''
      const root = rootOf(context.agent)
      if (root === undefined) return ''
      const state = states.get(root)
      return state?.mode === 'on' ? policyText(settings) : ''
    },
  }), 'longhaul policy section')

  ctx.effect(() => ctx.systemPrompt.context({
    name: 'longhaul:state',
    order: 700,
    text: (context) => {
      if (context.agent === undefined) return ''
      const root = rootOf(context.agent)
      if (root === undefined) return ''
      const state = states.get(root)
      return state === undefined ? '' : stateContext(state, settings)
    },
  }), 'longhaul state context')

  for (const tool of createLonghaulTools(runtime)) {
    ctx.effect(() => ctx.tools.register(tool), `longhaul tool ${tool.name}`)
  }

  // `/longhaul on|off|status` keeps the host usable without the client half.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      definitionId: CommandDefinitionId('dsh-longhaul'),
      name: 'longhaul',
      description: 'Enter, leave, or report Long Haul mode',
      input: { hint: '[on|off|status]' },
      handler: async ({ agent, rawInput }) => {
        const argument = rawInput.trim().toLowerCase()
        if (rootOf(agent) === undefined) {
          return { kind: 'error', text: 'Long Haul mode is controlled from the root session.' }
        }
        if (argument !== 'on' && argument !== 'off' && argument !== 'status' && argument !== '') {
          return { kind: 'error', text: 'Usage: /longhaul [on|off|status]' }
        }
        const state = await load(agent)
        if (argument === 'status') {
          const budget = budgetReport(state)
          return {
            kind: 'success',
            text: `${state.mode === 'off' ? 'Long Haul off' : `Long Haul ${state.phase} (${state.designVersion})`}; `
              + `tasks ${state.plan?.tasks.length ?? 0}; steps ${budget.total.steps}; `
              + `pending ${state.pendingApproval?.phase ?? 'none'}; changes ${state.changes.filter(c => c.status === 'proposed').length}.`,
          }
        }
        if (argument === '') {
          return { kind: 'error', text: 'Usage: /longhaul [on|off|status]' }
        }
        const on = argument === 'on'
        const next = reduce(state, { type: on ? 'mode/on' : 'mode/off', at: Date.now() })
        await persist(agent, next)
        notify(agent, modeNotice(on))
        return {
          kind: 'success',
          text: on
            ? 'Long Haul mode on. P0 Requirements is active; implementation stays blocked until P1 is approved.'
            : 'Long Haul mode off. Durable state and memory are kept.',
        }
      },
    })
  })

  // Preload live root sessions so guidance appears before the first tool call.
  const ensure = (session: Session): void => {
    const parent = session.header.parentSession
    if (parent !== undefined) return
    const root = String(session.header.id)
    if (states.has(root)) return
    const agent = ctx.agents.get(session.header.id)
    if (agent === undefined) return
    void load(agent).catch((error: unknown) => {
      ctx.logger.warn(`longhaul: cannot load state for ${root}: ${String(error)}`)
    })
  }
  ctx.on('session/created', (session: Session) => { ensure(session) })
  for (const agent of ctx.agents.list()) ensure(agent.session)

  // Phase-exit compaction: run once the agent is idle, then leave a handoff.
  ctx.on('session/event', (session: Session, event) => {
    if (event.type !== 'turn/end') return
    if (session.header.parentSession !== undefined) return
    const root = String(session.header.id)
    const state = states.get(root)
    if (state === undefined || !state.compactPending || !settings.compactOnPhaseExit) return
    const agent = ctx.agents.get(session.header.id)
    if (agent === undefined) return
    const compaction = ctx.get('compaction')
    if (compaction === undefined) {
      ctx.logger.warn('longhaul: phase exit needs compaction but no compaction service is composed')
      return
    }
    void Promise.resolve().then(async () => agent.runMaintenance(async (signal) => {
      await compaction.compactNow(agent, signal)
      const done = reduce(state, { type: 'compact/done', at: Date.now() })
      await persist(agent, done)
      const finished = done.lastApproved
      const handoff: StageHandoff = {
        phase: finished?.phase ?? done.phase,
        nextPhase: finished === undefined ? undefined : done.phase,
        deliverablePath: finished?.deliverablePath ?? deliverablePath(settings.deliverableDir, done.phase),
        summary: finished?.summary ?? '',
        decisionIds: [],
        openQuestions: done.lastRejection === undefined ? [] : [done.lastRejection.reason],
        acceptanceCommands: [],
        budgetRemaining: budgetReport(done).remainingSteps,
        designVersion: done.designVersion,
      }
      notify(agent, handoffText(handoff))
    })).catch((error: unknown) => {
      ctx.logger.warn(`longhaul: phase-exit compaction failed; it will retry on the next turn end: ${String(error)}`)
    })
  })
}

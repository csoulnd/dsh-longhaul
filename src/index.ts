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
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SubagentActivation } from '@deepseek-ai/dsh-subagent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { evaluateBudget } from './budget.ts'
import type { BudgetReport, ChildReport, LonghaulState, StageHandoff, StateEvent } from './types.ts'
import { Config, resolveConfig } from './config.ts'
import { dispatchProblem, ownershipConflicts, renderBrief, type DispatchTask } from './dispatch.ts'
import { toolDenial } from './guard.ts'
import { handoffText, modeNotice, MODE_RISK, policyText, stateContext } from './guidance.ts'
import { LonghaulMemory } from './memory.ts'
import { deliverablePath } from './phases.ts'
import { longhaulProjection } from './projection.ts'
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

/** Structured result every child session must return through `structured_output`. */
const CHILD_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'files', 'tests', 'blockers', 'evidence'],
  properties: {
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
  },
}

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
  const activations = new Map<string, SubagentActivation>()
  const childRoots = new Map<string, string>()
  const warned = new Set<string>()
  const dirty = new Set<string>()
  let flushTimer: NodeJS.Timeout | undefined
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

  const agentFor = (sessionId: string): Agent | undefined =>
    ctx.agents.list().find(agent => String(agent.session.header.id) === sessionId)

  /** Walk the live lineage to the root session; undefined on a cycle. */
  const sessionRoot = (sessionId: string): string | undefined => {
    let current = sessionId
    const seen = new Set<string>()
    for (;;) {
      if (seen.has(current)) return undefined
      seen.add(current)
      const parent = parentOf(current)
      if (parent === undefined) return current
      current = parent
    }
  }

  const load = async (agent: Agent): Promise<LonghaulState> => {    const root = rootFor(agent)
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

  const persist = async (agent: Agent, state: LonghaulState, record = true): Promise<void> => {
    const root = state.rootSessionId
    states.set(root, state)
    const path = statePath(root)
    await mkdir(join(longhaulHome(), root), { recursive: true })
    const temporary = `${path}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, 'utf8')
    await rename(temporary, path)
    if (!record) return
    try {
      appendPluginRecord(agent.session, 'plugin:longhaul/state', {
        mode: state.mode,
        phase: state.phase,
        designVersion: state.designVersion,
        taskCount: state.plan?.tasks.length ?? 0,
        pending: state.pendingApproval?.phase ?? '',
        steps: state.budget.total.steps,
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

  const flushBudgets = async (): Promise<void> => {
    flushTimer = undefined
    const roots = [...dirty]
    dirty.clear()
    for (const root of roots) {
      const state = states.get(root)
      const agent = agentFor(root)
      if (state === undefined || agent === undefined) continue
      try {
        await persist(agent, state, false)
      } catch (error) {
        ctx.logger.warn(`longhaul: budget state for ${root} was not saved: ${String(error)}`)
      }
    }
  }

  const markDirty = (root: string): void => {
    dirty.add(root)
    if (flushTimer !== undefined) return
    flushTimer = setTimeout(() => { void flushBudgets() }, 200)
    flushTimer.unref()
  }

  /** Apply one observation to the tree budget, then enforce warn/stop. */
  const applyBudget = (root: string, event: StateEvent): void => {
    const state = states.get(root)
    if (state === undefined || state.mode !== 'on') return
    let next: LonghaulState
    try {
      next = reduce(state, event)
    } catch (error) {
      ctx.logger.warn(`longhaul: ignored invalid budget event: ${String(error)}`)
      return
    }
    if (next === state) return
    states.set(root, next)
    markDirty(root)

    const report = budgetReport(next)
    const rootAgent = agentFor(root)
    for (const [childId, verdict] of Object.entries(report.verdicts)) {
      if (verdict === 'warn' && !warned.has(childId)) {
        warned.add(childId)
        const activation = activations.get(childId)
        const subagents = ctx.get('subagents')
        if (activation !== undefined && subagents !== undefined && rootAgent !== undefined) {
          void subagents.sendMessage(rootAgent, activation.childId, [{
            type: 'text',
            text: 'Long Haul budget: you have used 80% of your step or token budget. '
              + 'Finish the task, record evidence, and return a structured result now.',
          }], { signal: new AbortController().signal }).catch((error: unknown) => {
            ctx.logger.warn(`longhaul: budget warning to ${childId} failed: ${String(error)}`)
          })
        }
      }
      if (verdict === 'stop' && !warned.has(`stop:${childId}`)) {
        warned.add(`stop:${childId}`)
        const activation = activations.get(childId)
        if (activation !== undefined) void activation.dispose().catch((error: unknown) => {
          ctx.logger.warn(`longhaul: budget stop for ${childId} failed: ${String(error)}`)
        })
        else agentFor(childId)?.cancel({ kind: 'parent' })
        if (rootAgent !== undefined) notify(rootAgent, `Long Haul budget exhausted for child ${childId}; it was stopped.`)
      }
    }
  }

  const runtime: ToolRuntime = {
    config: settings,
    memoryFor,
    load,
    save: persist,
    rootOf,
    rootSessionOf: agent => childRoots.get(String(agent.session.header.id)) ?? sessionRoot(String(agent.session.header.id)),
    parentOf,
    cwdOf: agent => agent.session.header.cwd ?? process.cwd(),
    approve,
    notify,
    budgetReport,
    dispatch: async (agent, tasks) => dispatchTasks(agent, tasks),
  }

  /** Start one child per task; the parent owns integration and the result merge. */
  async function dispatchTasks(agent: Agent, tasks: readonly DispatchTask[]): Promise<{ taskId: string; childId: string }[]> {
    const root = rootFor(agent)
    const state = await load(agent)
    const problem = dispatchProblem(state, tasks, settings, new Set(ctx.agents.list().map(agentItem => String(agentItem.session.header.id))))
    if (problem !== undefined) throw new Error(`longhaul: ${problem}`)
    const conflicts = ownershipConflicts(state, tasks)
    if (conflicts.length > 0) throw new Error(`longhaul: ${conflicts.join('; ')}`)
    const subagents = ctx.get('subagents')
    if (subagents === undefined) throw new Error('longhaul: dispatch needs the subagent service')
    const memory = memoryFor(root)
    const decisions = await memory.listDecisions()
    const findings = await memory.listFindings(String(agent.session.header.id), parentOf)
    const route = settings.modelPolicy.mode === 'phase' ? settings.modelPolicy.phases.P2 : undefined
    let current = state
    const started: { taskId: string; childId: string }[] = []
    for (const task of tasks) {
      const planTask = current.plan?.tasks.find(candidate => candidate.id === task.id)
      if (planTask === undefined) throw new Error(`longhaul: task ${task.id} is not in the approved plan`)
      const activation = await subagents.startActivation({
        provider: 'spawn',
        label: `longhaul:${task.id}`,
        request: {
          parent: agent,
          prompt: [{ type: 'text', text: renderBrief({ task, state: current, config: settings, decisions, findings }) }],
          ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
          outputSchema: CHILD_OUTPUT_SCHEMA,
          maxDepth: settings.maxDepth,
          ...(route === undefined ? {} : { agentOptions: { provider: route.provider, model: route.model } }),
        },
        signal: new AbortController().signal,
        delivery: 'parent',
      })
      const childId = String(activation.childId)
      activations.set(childId, activation)
      childRoots.set(childId, root)
      started.push({ taskId: task.id, childId })
      current = reduce(current, {
        type: 'task/update',
        at: Date.now(),
        task: { ...planTask, status: 'running', ownerSessionId: childId },
      })
      void activation.result.then((result) => {
        const report = result.structured as ChildReport | undefined
        const blocked = (report !== undefined && report.blockers.length > 0) || result.stopReason !== 'completed'
        const latest = states.get(root) ?? current
        const latestTask = latest.plan?.tasks.find(candidate => candidate.id === task.id)
        if (latestTask === undefined) return
        void persist(agent, reduce(latest, {
          type: 'task/update',
          at: Date.now(),
          task: { ...latestTask, status: blocked ? 'blocked' : 'done' },
        })).catch((error: unknown) => {
          ctx.logger.warn(`longhaul: task ${task.id} settlement was not saved: ${String(error)}`)
        })
      }).catch((error: unknown) => {
        ctx.logger.warn(`longhaul: child ${childId} failed: ${String(error)}`)
        const latest = states.get(root) ?? current
        const latestTask = latest.plan?.tasks.find(candidate => candidate.id === task.id)
        if (latestTask !== undefined) {
          void persist(agent, reduce(latest, {
            type: 'task/update',
            at: Date.now(),
            task: { ...latestTask, status: 'blocked' },
          }), false).catch(() => {})
        }
      })
    }
    await persist(agent, current)
    markDirty(root)
    return started
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

  // Client chip state: fold our durable state records into a wire projection.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(longhaulProjection)
  })

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
        if (on && settings.requireApproval) {
          const approval = ctx.get('approval')
          if (approval === undefined) {
            return { kind: 'error', text: 'Long Haul needs an approval channel to start; no approval service is composed.' }
          }
          let outcome: ApprovalOutcome
          try {
            outcome = await approval.request({
              agent,
              toolName: 'longhaul_mode',
              reason: MODE_RISK.en,
              displayReason: { en: MODE_RISK.en, zh: MODE_RISK.zh },
            })
          } catch (error) {
            return { kind: 'error', text: `Long Haul not started: ${String(error)}` }
          }
          if (outcome !== 'allowed-once') {
            return { kind: 'error', text: `Long Haul not started (${outcome}).` }
          }
        }
        const next = reduce(state, { type: on ? 'mode/on' : 'mode/off', at: Date.now() })
        await persist(agent, next)
        try {
          notify(agent, modeNotice(on))
        } catch (error) {
          ctx.logger.warn(`longhaul: mode notice was not injected: ${String(error)}`)
        }
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

  // Tool gate: phase writes, child integration commands, and file ownership.
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent === undefined) return next()
    const sessionId = String(exec.agent.session.header.id)
    const root = childRoots.get(sessionId) ?? sessionRoot(sessionId)
    let state = root === undefined ? undefined : states.get(root)
    if (root !== undefined && state === undefined) {
      const rootAgent = agentFor(root)
      if (rootAgent !== undefined) {
        state = await load(rootAgent).catch(() => undefined)
      }
    }
    const denial = toolDenial({
      toolName: exec.name,
      args: exec.arguments,
      sessionId,
      isRoot: root === sessionId,
      cwd: exec.agent.session.header.cwd ?? process.cwd(),
      deliverableDir: settings.deliverableDir,
      state,
    })
    return denial === undefined ? next() : { kind: 'deny', reason: denial }
  })

  // Child budget lifecycle follows the subagent lifecycle pair.
  ctx.on('subagent/start', (info) => {
    const childId = String(info.id)
    const root = sessionRoot(childId)
    if (root === undefined || root === childId) return
    childRoots.set(childId, root)
    const state = states.get(root)
    if (state === undefined || state.mode !== 'on') return
    applyBudget(root, { type: 'budget/start', at: Date.now(), sessionId: childId, phase: state.phase })
  })
  ctx.on('subagent/end', (info) => {
    const childId = String(info.id)
    const root = childRoots.get(childId) ?? sessionRoot(childId)
    if (root === undefined || root === childId) return
    applyBudget(root, { type: 'budget/finish', at: Date.now(), sessionId: childId })
    void flushBudgets()
  })

  // Phase-exit compaction: run once the agent is idle, then leave a handoff.
  ctx.on('session/event', (session: Session, event) => {
    const sessionId = String(session.header.id)
    const root = childRoots.get(sessionId) ?? sessionRoot(sessionId)
    if (root !== undefined && root !== sessionId) {
      if (event.type === 'step/start') {
        applyBudget(root, { type: 'budget/step', at: Date.now(), sessionId })
      } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
        applyBudget(root, {
          type: 'budget/usage',
          at: Date.now(),
          sessionId,
          usage: {
            inputTokens: event.data.usage.inputTokens,
            outputTokens: event.data.usage.outputTokens,
            cacheReadTokens: event.data.usage.cacheReadTokens ?? 0,
          },
        })
      } else if (event.type === 'turn/end') {
        void flushBudgets()
      }
    }
    if (event.type !== 'turn/end') return
    if (session.header.parentSession !== undefined) return
    const state = states.get(root ?? sessionId)
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

/**
 * Model-facing Long Haul tools. Each tool delegates durable state, memory, and
 * approval work to a {@link ToolRuntime} so the handlers stay free of Cordis
 * wiring and the plugin entry point owns service access.
 *
 * @module dsh-longhaul/tools
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { Config } from './config.ts'
import { deliverableName } from './config.ts'
import type { LonghaulMemory } from './memory.ts'
import {
  changeRequestProblem,
  deliverablePath,
  nextPhase,
  PHASE_RULES,
  submissionProblems,
} from './phases.ts'
import { reduce } from './state.ts'
import type {
  BudgetReport,
  DesignChangeRequest,
  LonghaulState,
  Phase,
} from './types.ts'

/** Approval-gated tool names; stable so audit logs stay readable. */
export const APPROVAL_TOOLS = {
  submit: 'longhaul_submit',
  change: 'longhaul_change',
} as const

/** Services and persistence the tools need from the plugin entry point. */
export interface ToolRuntime {
  config: Config
  /** Memory store scoped to one root session. */
  memoryFor(rootSessionId: string): LonghaulMemory
  /** Load (or create) the state for the agent's root session; rejects non-root callers. */
  load(agent: Agent): Promise<LonghaulState>
  /** Persist state and append its plugin record. */
  save(agent: Agent, state: LonghaulState): Promise<void>
  /** Root session id for a root agent, or undefined for a child. */
  rootOf(agent: Agent): string | undefined
  /** Parent session id for branch ACL walks. */
  parentOf(sessionId: string): string | undefined
  /** Workspace root used to resolve deliverable paths. */
  cwdOf(agent: Agent): string
  /** Ask the human; returns `unavailable` when no approval channel is composed. */
  approve(agent: Agent, toolName: string, reason: string): Promise<ApprovalOutcome>
  /** Inject a model-visible notice for this turn. */
  notify(agent: Agent, text: string): void
  /** Budget report for the current state. */
  budgetReport(state: LonghaulState): BudgetReport
}

/** Human-readable status summary shared by the tool result and renderer. */
function statusSummary(state: LonghaulState, budget: BudgetReport): string {
  if (state.mode === 'off') return 'Long Haul mode is off.'
  const plan = state.plan === undefined
    ? 'no plan'
    : `${state.plan.tasks.length} task(s)`
  const pending = state.pendingApproval === undefined
    ? ''
    : `; pending approval for ${state.pendingApproval.phase}`
  const open = state.changes.filter(change => change.status === 'proposed').length
  return `Long Haul: ${state.phase} (${PHASE_RULES[state.phase].label}); design v${state.designVersion}; ${plan}; `
    + `steps ${budget.total.steps}; ${state.changes.length} change request(s), ${open} open${pending}.`
}

/** Resolve the deliverable path for a phase under the workspace. */
function resolveDeliverable(runtime: ToolRuntime, agent: Agent, phase: Phase, override?: string): string {
  const cwd = runtime.cwdOf(agent)
  if (override !== undefined && (override.startsWith('/') || override.includes('..'))) {
    fail(`deliverable path ${override} must be workspace-relative and cannot contain ".."`)
  }
  const relative = override ?? deliverablePath(runtime.config.deliverableDir, phase)
  return join(cwd, relative)
}

/** Throw a model-facing failure. */
function fail(message: string): never {
  throw new Error(message)
}

/**
 * Create the five Long Haul tools bound to one runtime.
 * @param runtime - services and persistence provided by the plugin entry point.
 * @returns registry-ready tool definitions.
 */
export function createLonghaulTools(runtime: ToolRuntime): ToolDefinition[] {
  return [
    defineTool({
      name: 'longhaul_status',
      description: 'Show Long Haul mode, phase, plan, budget, and pending approvals for the current root session.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            mode: { type: 'string', required: true, enum: ['off', 'on'] },
            phase: { type: 'string', required: true, enum: ['P0', 'P1', 'P2', 'P3'] },
            designVersion: { type: 'integer', required: true },
            taskCount: { type: 'integer', required: true },
            steps: { type: 'integer', required: true },
            pendingApproval: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      execute: async (_args, exec) => {
        if (exec.agent === undefined) fail('longhaul_status requires an owning agent session')
        const state = await runtime.load(exec.agent)
        const budget = runtime.budgetReport(state)
        return {
          summary: statusSummary(state, budget),
          mode: state.mode,
          phase: state.phase,
          designVersion: state.designVersion,
          taskCount: state.plan?.tasks.length ?? 0,
          steps: budget.total.steps,
          pendingApproval: state.pendingApproval?.phase ?? '',
        }
      },
      presentCall: () => ({ card: 'generic', title: 'Long Haul status', kind: 'other' }),
    }),

    defineTool({
      name: 'longhaul_plan',
      description: 'Record the approved task plan (objective, tasks, owned files, dependencies) in P0. '
        + 'The plan is required before design and implementation and is fixed once recorded.',
      parameters: {
        objective: { type: 'string', required: true, description: 'One-sentence objective for the whole long task.' },
        tasks: {
          type: 'array',
          required: true,
          description: 'Task tree leaves, each with an id, title, owned files, and dependencies.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              title: { type: 'string', required: true },
              files: { type: 'array', required: true, items: { type: 'string' } },
              dependsOn: { type: 'array', required: true, items: { type: 'string' } },
              budgetSteps: { type: 'integer' },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            taskCount: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined) fail('longhaul_plan requires an owning agent session')
        const state = await runtime.load(exec.agent)
        if (state.mode !== 'on') fail('Long Haul mode is off; enable it before planning')
        if (state.phase !== 'P0') fail(`a task plan can only be recorded in P0 (current ${state.phase})`)
        if (args.tasks.length === 0) fail('a task plan needs at least one task')
        const ids = new Set<string>()
        for (const task of args.tasks) {
          if (ids.has(task.id)) fail(`duplicate task id ${task.id}`)
          ids.add(task.id)
        }
        for (const task of args.tasks) {
          for (const dependency of task.dependsOn) {
            if (!ids.has(dependency)) fail(`task ${task.id} depends on unknown task ${dependency}`)
          }
        }
        const next = reduce(state, {
          type: 'plan/set',
          at: Date.now(),
          plan: {
            objective: args.objective,
            createdAt: Date.now(),
            version: 1,
            tasks: args.tasks.map(task => ({
              id: task.id,
              title: task.title,
              status: 'pending' as const,
              files: task.files,
              dependsOn: task.dependsOn,
              ...(task.budgetSteps === undefined ? {} : { budgetSteps: task.budgetSteps }),
            })),
          },
        })
        await runtime.save(exec.agent, next)
        return {
          summary: `Recorded plan with ${args.tasks.length} task(s). Submit the P0 requirements deliverable for approval next.`,
          taskCount: args.tasks.length,
        }
      },
      presentCall: () => ({ card: 'generic', title: 'Record Long Haul plan', kind: 'other' }),
    }),

    defineTool({
      name: 'longhaul_submit',
      description: 'Submit the current phase deliverable for human approval. The deliverable file must exist and '
        + 'contain every required section. Only an allowed-once approval advances the phase.',
      parameters: {
        summary: { type: 'string', required: true, description: 'Short summary of what this phase produced.' },
        path: { type: 'string', description: 'Optional workspace-relative deliverable path; defaults to the phase template.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            approved: { type: 'boolean', required: true },
            phase: { type: 'string', required: true, enum: ['P0', 'P1', 'P2', 'P3'] },
            nextPhase: { type: 'string', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined) fail('longhaul_submit requires an owning agent session')
        const state = await runtime.load(exec.agent)
        if (state.mode !== 'on') fail('Long Haul mode is off')
        const phase = state.phase
        if (state.pendingApproval !== undefined) fail(`a ${state.pendingApproval.phase} submission is already pending`)
        if (phase !== 'P0' && state.plan === undefined) fail(`phase ${phase} requires an approved task plan; record one in P0`)
        const path = resolveDeliverable(runtime, exec.agent, phase, args.path)
        let text = ''
        try {
          text = await readFile(path, 'utf8')
        } catch (error) {
          fail(`cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? 'read failed'}`)
        }
        const problems = submissionProblems(phase, text)
        if (problems.length > 0) fail(`${phase} deliverable ${path} is not acceptable: ${problems.join('; ')}`)

        const submitted = reduce(state, {
          type: 'phase/submit',
          at: Date.now(),
          approval: {
            phase,
            deliverablePath: path,
            summary: args.summary,
            requestedAt: Date.now(),
          },
        })
        await runtime.save(exec.agent, submitted)

        let outcome: ApprovalOutcome = 'allowed-once'
        if (runtime.config.requireApproval) {
          outcome = await runtime.approve(
            exec.agent,
            APPROVAL_TOOLS.submit,
            `${phase} ${PHASE_RULES[phase].label} deliverable at ${path}: ${args.summary}`,
          )
        }
        if (outcome !== 'allowed-once') {
          const rejected = reduce(submitted, {
            type: 'phase/reject',
            at: Date.now(),
            phase,
            reason: outcome,
          })
          await runtime.save(exec.agent, rejected)
          fail(`phase ${phase} was not approved (${outcome}); the deliverable remains on disk and the phase is unchanged`)
        }

        const decided: LonghaulState = {
          ...submitted,
          pendingApproval: { ...submitted.pendingApproval!, decision: 'allowed', decidedAt: Date.now() },
        }
        const advanced = reduce(decided, { type: 'phase/approve', at: Date.now(), phase })
        await runtime.save(exec.agent, advanced)
        const next = nextPhase(phase)
        runtime.notify(exec.agent, `Long Haul: ${phase} approved. ${next === undefined ? 'Ship complete.' : `Next phase ${next}.`}`)
        return {
          approved: true,
          phase,
          nextPhase: next ?? 'done',
          summary: `Approved ${phase} (${PHASE_RULES[phase].label}). ${next === undefined
            ? 'The long task reached P3; record the release deliverable to close it.'
            : `Entered ${next} (${PHASE_RULES[next].label}).`}`,
        }
      },
      presentCall: () => ({ card: 'generic', title: 'Submit Long Haul deliverable', kind: 'other' }),
    }),

    defineTool({
      name: 'longhaul_memory',
      description: 'Read or write Long Haul memory. Decisions are tree-wide and only the root may append them; '
        + 'findings are branch-scoped and append-only; the root or a parent may promote a finding into a decision.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['append_finding', 'append_decision', 'list', 'promote'],
          description: 'append_finding | append_decision | list | promote.',
        },
        text: { type: 'string', description: 'Record text for append actions.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        findingId: { type: 'string', description: 'Finding id for promote.' },
        evidence: { type: 'string', description: 'Optional command, path, or result supporting the record.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            decisions: { type: 'integer', required: true },
            findings: { type: 'integer', required: true },
            artifacts: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined) fail('longhaul_memory requires an owning agent session')
        const sessionId = String(exec.agent.session.header.id)
        const root = runtime.rootOf(exec.agent)
        if (root === undefined) fail('longhaul_memory from a child session is not supported in M1a; use the root session')
        const store = runtime.memoryFor(root)

        if (args.action === 'append_finding') {
          if (args.text === undefined) fail('append_finding requires text')
          await store.appendFinding(sessionId, {
            text: args.text,
            ...(args.tags === undefined ? {} : { tags: args.tags }),
            ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
          })
        } else if (args.action === 'append_decision') {
          if (args.text === undefined) fail('append_decision requires text')
          await store.appendDecision(sessionId, {
            text: args.text,
            ...(args.tags === undefined ? {} : { tags: args.tags }),
            ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
          })
        } else if (args.action === 'promote') {
          if (args.findingId === undefined) fail('promote requires findingId')
          await store.promote(args.findingId, sessionId, runtime.parentOf, args.text)
        }

        const [decisions, findings, artifacts] = await Promise.all([
          store.listDecisions(),
          store.listFindings(sessionId, runtime.parentOf),
          store.listArtifacts(),
        ])
        return {
          summary: `Long Haul memory: ${decisions.length} decision(s), ${findings.length} visible finding(s), ${artifacts.length} artifact(s).`,
          decisions: decisions.length,
          findings: findings.length,
          artifacts: artifacts.length,
        }
      },
      presentCall: () => ({ card: 'generic', title: 'Long Haul memory', kind: 'other' }),
    }),

    defineTool({
      name: 'longhaul_change',
      description: 'Raise, decide, or list a design change request. Development may discover a design flaw: '
        + 'record evidence and the affected tasks, then the root asks for approval before the design document changes.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['request', 'decide', 'list'],
          description: 'request | decide | list.',
        },
        title: { type: 'string', description: 'Short change title for request.' },
        evidence: { type: 'string', description: 'Failure output, path, or counterexample for request.' },
        impact: { type: 'string', description: 'Affected interfaces, files, and tests for request.' },
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Tasks paused until decided.' },
        id: { type: 'string', description: 'Change request id for decide.' },
        approve: { type: 'boolean', description: 'Whether to approve the change request.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            open: { type: 'integer', required: true },
            designVersion: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined) fail('longhaul_change requires an owning agent session')
        const state = await runtime.load(exec.agent)

        if (args.action === 'request') {
          if (args.title === undefined || args.evidence === undefined || args.impact === undefined) {
            fail('request requires title, evidence, and impact')
          }
          const taskIds = args.taskIds ?? []
          const problem = changeRequestProblem(state, taskIds, runtime.config.maxChangeRequestsPerTask)
          if (problem !== undefined) fail(problem)
          const request: DesignChangeRequest = {
            id: randomUUID(),
            title: args.title,
            evidence: args.evidence,
            impact: args.impact,
            taskIds,
            status: 'proposed',
            createdAt: Date.now(),
          }
          await runtime.save(exec.agent, reduce(state, { type: 'change/request', at: Date.now(), request }))
          const open = state.changes.filter(change => change.status === 'proposed').length + 1
          return {
            summary: `Recorded design change ${request.id} affecting ${taskIds.join(', ') || 'no task'}. `
              + `${open} request(s) now open.`,
            open,
            designVersion: state.designVersion,
          }
        }

        if (args.action === 'decide') {
          if (args.id === undefined || args.approve === undefined) fail('decide requires id and approve')
          const request = state.changes.find(change => change.id === args.id)
          if (request === undefined) fail(`unknown design change request ${args.id}`)
          if (request.status !== 'proposed') fail(`design change request ${args.id} is already ${request.status}`)
          if (args.approve) {
            if (!runtime.config.requireApproval) {
              // Approval disabled: the deployer accepted automatic transitions.
            } else {
              const outcome = await runtime.approve(
                exec.agent,
                APPROVAL_TOOLS.change,
                `Approve design change ${request.id}: ${request.title}. This updates the design document and re-runs affected tasks.`,
              )
              if (outcome !== 'allowed-once') {
                fail(`design change ${request.id} was not approved (${outcome})`)
              }
            }
          }
          const next = reduce(state, {
            type: 'change/decide',
            at: Date.now(),
            id: args.id,
            approved: args.approve,
          })
          await runtime.save(exec.agent, next)
          const open = next.changes.filter(change => change.status === 'proposed').length
          return {
            summary: `Design change ${args.id} ${args.approve ? 'approved' : 'rejected'}; design v${next.designVersion}.`,
            open,
            designVersion: next.designVersion,
          }
        }

        const open = state.changes.filter(change => change.status === 'proposed').length
        return {
          summary: `${state.changes.length} design change request(s), ${open} open; design v${state.designVersion}.`,
          open,
          designVersion: state.designVersion,
        }
      },
      presentCall: () => ({ card: 'generic', title: 'Long Haul design change', kind: 'other' }),
    }),
  ]
}

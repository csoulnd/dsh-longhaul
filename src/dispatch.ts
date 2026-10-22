/**
 * Dispatch policy for Long Haul mode: renders the self-contained child brief,
 * refuses dispatches that violate the stage gate or fan-out, and reports file
 * ownership conflicts before a child session starts.
 *
 * @module dsh-longhaul/dispatch
 */
import type { Config } from './config.ts'
import { PHASE_RULES, isTaskPaused, openChangesForTask } from './phases.ts'
import type { DecisionRecord, FindingRecord, LonghaulState, TaskNode } from './types.ts'

/** One task the parent proposes to dispatch to a child session. */
export interface DispatchTask {
  /** Task id from the approved plan. */
  id: string
  /** Short task title shown in the brief. */
  title: string
  /** Workspace-relative files the child may edit. */
  files: string[]
  /** Commands the child must run to prove the task works. */
  acceptanceCommands: string[]
  /** Optional task-specific instructions. */
  notes?: string
}

/** Everything needed to render one child brief. */
export interface BriefInput {
  /** Task being dispatched. */
  task: DispatchTask
  /** Current durable state of the root session tree. */
  state: LonghaulState
  /** Deployment configuration supplying budgets and caps. */
  config: Config
  /** Decisions supplied to the child; the caller selects the relevant subset. */
  decisions: readonly DecisionRecord[]
  /** Branch findings supplied to the child; the brief keeps the most recent ones. */
  findings: readonly FindingRecord[]
}

/** Workspace-relative path with POSIX separators. */
function normalizePath(file: string): string {
  return file.replaceAll('\\', '/')
}

/** The plan node for one task id, when a plan exists. */
function planTaskOf(state: LonghaulState, id: string): TaskNode | undefined {
  return state.plan?.tasks.find(task => task.id === id)
}

/** One record line for a constraint or finding list. */
function recordLine(record: DecisionRecord | FindingRecord): string {
  const evidence = record.evidence === undefined ? '' : ` (evidence: ${record.evidence})`
  return `- ${record.id}: ${record.text}${evidence}`
}

/**
 * Render the self-contained brief a child session receives as its first user
 * message. The brief names the plan objective, owned files, acceptance
 * commands, applicable decisions and findings, stage, budget, forbidden
 * actions, and the required structured result.
 * @param input - task, durable state, configuration, and the supplied memory records.
 * @returns the child brief.
 */
export function renderBrief(input: BriefInput): string {
  const { task, state, config, decisions, findings } = input
  const plan = state.plan
  const stepCap = planTaskOf(state, task.id)?.budgetSteps ?? config.childStepBudget
  const recentFindings = config.findingsInjectLimit === 0
    ? []
    : findings.slice(-config.findingsInjectLimit)
  const usedSteps = state.budget.total.steps
  const treeSteps = config.totalStepBudget === 0
    ? `Tree steps used: ${usedSteps} (no tree-wide cap).`
    : `Tree steps used: ${usedSteps}/${config.totalStepBudget} (${Math.max(config.totalStepBudget - usedSteps, 0)} remaining).`
  const lines: string[] = [
    '## Objective',
    plan?.objective ?? 'No approved plan objective is available.',
    '',
    '## Your task',
    `${task.id}: ${task.title}`,
  ]
  if (task.notes !== undefined && task.notes.trim() !== '') lines.push(`Notes: ${task.notes}`)
  lines.push(
    '',
    '## Owned files',
    ...(task.files.length === 0
      ? ['(none; treat this task as read-only)']
      : task.files.map(file => `- ${normalizePath(file)}`)),
    '',
    '## Acceptance commands',
    ...(task.acceptanceCommands.length === 0
      ? ['(none specified)']
      : task.acceptanceCommands.map(command => `- ${command}`)),
    '',
    '## Constraints (decisions)',
    ...(decisions.length === 0 ? ['(none supplied)'] : decisions.map(recordLine)),
    '',
    '## Branch findings (recent)',
    ...(recentFindings.length === 0 ? ['(none supplied)'] : recentFindings.map(recordLine)),
    '',
    '## Stage and design version',
    `Phase ${state.phase} (${PHASE_RULES[state.phase].label}), design version ${state.designVersion}, plan version ${plan?.version ?? 'unknown'}.`,
    '',
    '## Budget (steps)',
    `Step cap: ${stepCap} steps.`,
    treeSteps,
    'Stop and report before exceeding the cap.',
    '',
    '## Forbidden',
    '- Do not run git commit, git push, or any other command that rewrites repository history.',
    '- Do not run build, package, or publish commands.',
    '- Do not edit files outside the Owned files list.',
    '- Do not change the approved design; raise a design change request with evidence instead.',
    '',
    '## Return format',
    'Return one structured result with these fields:',
    '- summary: the outcome in at most 800 characters.',
    '- files: every path you changed, workspace-relative.',
    '- tests: each command you ran and its observable result.',
    '- blockers: unresolved problems, or "none".',
    '- evidence: paths to logs, reports, or other artifacts you produced.',
  )
  return lines.join('\n')
}

/**
 * Why a dispatch is refused, or undefined when allowed. Checks mode, phase,
 * the approved plan, task status, paused tasks, and the fan-out ceiling; depth
 * is enforced by the subagent service.
 * @param state - current durable state.
 * @param tasks - proposed dispatch tasks.
 * @param config - deployment configuration supplying the fan-out limit.
 * @param liveSessions - live session ids; a running task owned by one is refused to keep one writer.
 * @returns the first concrete refusal reason, or undefined.
 */
export function dispatchProblem(
  state: LonghaulState,
  tasks: readonly DispatchTask[],
  config: Config,
  liveSessions?: ReadonlySet<string>,
): string | undefined {
  if (state.mode !== 'on') return 'Long Haul mode is off'
  if (state.phase !== 'P2') {
    return `dispatch is only allowed in P2 Development (current phase ${state.phase} ${PHASE_RULES[state.phase].label})`
  }
  const plan = state.plan
  if (plan === undefined) return 'no approved task plan exists; approve the plan before dispatching'
  for (const task of tasks) {
    const node = planTaskOf(state, task.id)
    if (node === undefined) return `task ${task.id} is not in the approved plan`
    if (node.status !== 'pending' && node.status !== 'running') {
      return `task ${task.id} is ${node.status}; only pending or running tasks can be dispatched`
    }
    if (node.status === 'running' && node.ownerSessionId !== undefined
      && liveSessions !== undefined && liveSessions.has(node.ownerSessionId)) {
      return `task ${task.id} is already running in session ${node.ownerSessionId}; wait for it to settle`
    }
    if (isTaskPaused(state, task.id)) {
      const change = openChangesForTask(state, task.id)[0]
      return `task ${task.id} is paused by open design change request ${change?.id ?? 'unknown'}`
    }
  }
  const live = plan.tasks.filter(
    task => task.status === 'running' && task.ownerSessionId !== undefined,
  ).length
  let added = 0
  for (const id of new Set(tasks.map(task => task.id))) {
    if (planTaskOf(state, id)?.ownerSessionId === undefined) added += 1
  }
  if (live + added > config.fanout) {
    const noun = added === 1 ? 'task' : 'tasks'
    return `dispatching ${added} ${noun} would raise live children to ${live + added}, above the fan-out limit of ${config.fanout} (${live} already live)`
  }
  return undefined
}

/**
 * File-ownership conflicts between the proposed tasks and existing owners.
 * Paths are normalized to POSIX separators; duplicate claims, absolute paths,
 * and paths containing `..` are reported.
 * @param state - current durable state, including the plan and file owners.
 * @param tasks - proposed dispatch tasks.
 * @returns one message per conflict, in task and file order.
 */
export function ownershipConflicts(state: LonghaulState, tasks: readonly DispatchTask[]): string[] {
  const conflicts: string[] = []
  const allowedOwners = new Set<string>()
  for (const task of tasks) {
    const owner = planTaskOf(state, task.id)?.ownerSessionId
    if (owner !== undefined) allowedOwners.add(owner)
  }
  const owners = new Map<string, string>()
  for (const [path, session] of Object.entries(state.fileOwners)) owners.set(normalizePath(path), session)
  const claims = new Map<string, string[]>()
  for (const task of tasks) {
    for (const raw of task.files) {
      const file = normalizePath(raw)
      if (file.startsWith('/')) {
        conflicts.push(`file ${file} is invalid: paths must be workspace-relative`)
        continue
      }
      if (file.includes('..')) {
        conflicts.push(`file ${file} is invalid: paths must not contain ".."`)
        continue
      }
      const existing = claims.get(file)
      if (existing !== undefined) {
        conflicts.push(existing.includes(task.id)
          ? `task ${task.id} lists file ${file} more than once`
          : `file ${file} is assigned to more than one task (${[...existing, task.id].join(', ')})`)
        existing.push(task.id)
        continue
      }
      claims.set(file, [task.id])
      const owner = owners.get(file)
      if (owner !== undefined && !allowedOwners.has(owner)) {
        conflicts.push(`file ${file} is already owned by session ${owner}`)
      }
    }
  }
  return conflicts
}

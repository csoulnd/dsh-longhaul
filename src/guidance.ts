/**
 * Model-facing prose for Long Haul mode: the static stage policy, the per-turn
 * state summary, the post-compaction handoff, the mode toggle notice, and the
 * phase approval reason.
 *
 * @module dsh-longhaul/guidance
 */
import type { Config } from './config.ts'
import { PHASE_RULES, deliverablePath } from './phases.ts'
import type { LonghaulState, Phase, StageHandoff, TaskStatus } from './types.ts'

/** Required deliverable sections for one phase, canonical names only. */
function requiredSections(phase: Phase): string {
  return PHASE_RULES[phase].sections.map(aliases => aliases[0]).join(', ')
}

/** One readable list entry, or a fixed fallback when the list is empty. */
function listOrNone(items: readonly string[], none: string): string {
  return items.length === 0 ? none : items.join(', ')
}

/** A labelled list block, or one `none` line when the list is empty. */
function listSection(label: string, items: readonly string[]): string[] {
  return items.length === 0
    ? [`${label}: none`]
    : [`${label}:`, ...items.map(item => `- ${item}`)]
}

/** Approval sentence for one gate. */
const APPROVAL_SUFFIX: Record<Phase, string> = {
  P0: 'The P1 Design gate and all implementation stay blocked until this approval.',
  P1: 'Implementation stays blocked until this approval.',
  P2: 'The P3 Ship gate stays blocked until this approval.',
  P3: 'This closes the final gate.',
}

/**
 * Static stage policy injected while the mode is on. Describes the four gates,
 * deliverable requirements, the implementation block before P1 approval, the
 * memory ACL, budgets, and the design-change loop.
 * @param config - deployment configuration; a non-empty `policyText` replaces the built-in text verbatim.
 * @returns the policy prose.
 */
export function policyText(config: Config): string {
  if (config.policyText !== '') return config.policyText
  const p0 = deliverablePath(config.deliverableDir, 'P0')
  const p1 = deliverablePath(config.deliverableDir, 'P1')
  const p2 = deliverablePath(config.deliverableDir, 'P2')
  const p3 = deliverablePath(config.deliverableDir, 'P3')
  const approval = config.requireApproval
    ? 'Every gate requires an allowed-once approval before the next gate starts.'
    : 'This deployment records each gate decision without a separate approval request.'
  const treeSteps = config.totalStepBudget === 0
    ? 'no tree-wide step cap'
    : `${config.totalStepBudget} tree-wide steps`
  const treeTokens = config.tokenBudget === 0
    ? 'no tree-wide token cap'
    : `${config.tokenBudget} tree-wide tokens`
  return `Long Haul mode is active for this root session. Work moves through four ordered gates: P0 Requirements, P1 Design, P2 Development, P3 Ship. Finish the current gate before entering the next, and never report a gate as complete without its deliverable file on disk.

P0 Requirements
- Produce ${p0} with required sections: ${requiredSections('P0')}.
- Record the task plan: objective, task ids, titles, file ownership, dependencies, milestones, and per-task step caps.
- Do not create or modify implementation files. Read, inspect, and ask questions instead.

P1 Design
- Produce ${p1} with required sections: ${requiredSections('P1')}.
- Do not create or modify implementation files. Implementation is forbidden until this design deliverable is approved.
- State interfaces, data model, failure paths, and test strategy precisely enough for a child session to implement without guessing.

P2 Development
- Implement only approved plan tasks, and only the files owned by the task you are working on.
- Dispatch independent tasks to child sessions: at most ${config.fanout} live children, ${config.childStepBudget} steps per child, depth ${config.maxDepth}.
- Child sessions never run git commit, git push, build, package, or publish commands; those belong to the parent.
- Record changes, tests, and rollback notes in ${p2}.

P3 Ship
- Produce ${p3} with required sections: ${requiredSections('P3')}.
- Run release checks and repository commands only in the parent session.

Approval gates
- ${approval}
- A rejected submission keeps the current gate; read the rejection reason, revise the deliverable, and resubmit.

Memory access
- decisions are tree-wide and read-only: every session may read them, and only the parent adds or supersedes them.
- findings are branch-only: a session reads and appends its own branch's findings, and never edits another session's record.
- Only the parent promotes a finding into a decision; ask for promotion when a discovery constrains the whole tree.

Budgets
- Limits: ${config.childStepBudget} steps per child, ${config.fanout} live children, depth ${config.maxDepth}, ${treeSteps}, ${treeTokens}.
- At 80% of a limit, stop expanding scope and report remaining work. At 100%, stop and report what is unfinished.

Design changes
- Do not change the approved design silently. Raise a design change request (DCR) with evidence (a failing command or log), impact (files, interfaces, tests), and the proposed change.
- An open DCR pauses only the tasks it names; unaffected tasks continue. Each task may carry at most ${config.maxChangeRequestsPerTask} change requests, then escalate to the user.
- After the design change is approved, the design version increments and only the affected tasks are dispatched again.`
}

/** Task counts for the plan summary, keyed by status. */
function taskCounts(state: LonghaulState): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { pending: 0, running: 0, done: 0, blocked: 0, cancelled: 0 }
  for (const task of state.plan?.tasks ?? []) counts[task.status] += 1
  return counts
}

/** One-line plan summary for the state block. */
function planSummary(state: LonghaulState): string {
  if (state.plan === undefined) return 'Plan: not approved.'
  const counts = taskCounts(state)
  const total = state.plan.tasks.length
  const noun = total === 1 ? 'task' : 'tasks'
  return `Plan: ${total} ${noun} (pending ${counts.pending}, running ${counts.running}, done ${counts.done}, blocked ${counts.blocked}, cancelled ${counts.cancelled}).`
}

/** One-line budget summary for the state block. */
function budgetSummary(state: LonghaulState, config: Config): string {
  const used = state.budget.total.steps
  const steps = config.totalStepBudget === 0
    ? `steps ${used} used (no tree step cap)`
    : `steps ${used}/${config.totalStepBudget} used (${Math.max(config.totalStepBudget - used, 0)} remaining)`
  const tokens = state.budget.total.inputTokens + state.budget.total.outputTokens + state.budget.total.cacheReadTokens
  const tokenText = config.tokenBudget === 0
    ? `tokens ${tokens} used (no tree token cap)`
    : `tokens ${tokens}/${config.tokenBudget} used (${Math.max(config.tokenBudget - tokens, 0)} remaining)`
  const running = state.plan?.tasks.filter(task => task.status === 'running' && task.ownerSessionId !== undefined).length ?? 0
  const noun = running === 1 ? 'child' : 'children'
  return `Budget: ${steps}; ${tokenText}; ${running} running ${noun}.`
}

/** One-line summary of open design change requests and the tasks they pause. */
function changesSummary(state: LonghaulState): string {
  const open = state.changes.filter(change => change.status === 'proposed')
  if (open.length === 0) return 'Open design change requests: none.'
  const parts = open.map(change => change.taskIds.length === 0
    ? `${change.id} pauses no tasks`
    : `${change.id} pauses ${change.taskIds.join(', ')}`)
  return `Open design change requests: ${parts.join('; ')}.`
}

/**
 * Per-turn state summary for the model. Empty while the mode is off.
 * @param state - current durable state.
 * @param config - deployment configuration supplying the budget caps.
 * @returns a compact multi-line summary.
 */
export function stateContext(state: LonghaulState, config: Config): string {
  if (state.mode === 'off') return ''
  const rule = PHASE_RULES[state.phase]
  const lines = [
    `Long Haul: mode on, phase ${state.phase} (${rule.label}), design version ${state.designVersion}.`,
    planSummary(state),
    budgetSummary(state, config),
  ]
  if (state.pendingApproval !== undefined) {
    const pending = state.pendingApproval
    lines.push(`Pending approval: ${pending.phase} ${PHASE_RULES[pending.phase].label} at ${pending.deliverablePath}.`)
  } else if (state.lastRejection !== undefined) {
    const rejection = state.lastRejection
    lines.push(`Last rejection: ${rejection.phase} ${PHASE_RULES[rejection.phase].label} - ${rejection.reason}.`)
  }
  lines.push(changesSummary(state))
  return lines.join('\n')
}

/**
 * Message appended after a phase exit compaction, so the next phase keeps the
 * deliverable pointer, constraints, open questions, and budget.
 * @param handoff - stage handoff data captured before entering the next phase.
 * @returns the fixed-template handoff text.
 */
export function handoffText(handoff: StageHandoff): string {
  const next = handoff.nextPhase === undefined
    ? 'none'
    : `${handoff.nextPhase} ${PHASE_RULES[handoff.nextPhase].label}`
  const budget = handoff.budgetRemaining === undefined
    ? 'not limited'
    : `${handoff.budgetRemaining} steps`
  return [
    'Long Haul stage handoff',
    `Phase: ${handoff.phase} ${PHASE_RULES[handoff.phase].label}`,
    `Next phase: ${next}`,
    `Deliverable: ${handoff.deliverablePath}`,
    `Summary: ${handoff.summary}`,
    `Decisions: ${listOrNone(handoff.decisionIds, 'none')}`,
    ...listSection('Open questions', handoff.openQuestions),
    ...listSection('Acceptance commands', handoff.acceptanceCommands),
    `Budget remaining: ${budget}`,
    `Design version: ${handoff.designVersion}`,
  ].join('\n')
}

/**
 * One-line mode toggle notice, visible to the model and logged by the caller.
 * @param on - whether Long Haul mode is being turned on or off.
 * @returns the fixed English notice.
 */
export function modeNotice(on: boolean): string {
  return on
    ? 'Long Haul mode is ON. Work is stage-gated: implementation stays blocked until the P1 Design deliverable is approved.'
    : 'Long Haul mode is OFF. The Long Haul stage policy and gates no longer apply.'
}

/**
 * Text for a phase approval request's display reason. Deliberately excludes the
 * submission summary so the reason stays stable across resubmissions.
 * @param state - current durable state, used to prefer the pending deliverable path.
 * @param phase - gate being approved.
 * @returns the approval reason.
 */
export function approvalReason(state: LonghaulState, phase: Phase): string {
  const rule = PHASE_RULES[phase]
  const pending = state.pendingApproval?.phase === phase ? state.pendingApproval : undefined
  const path = pending?.deliverablePath ?? rule.deliverable
  return `Approve ${phase} ${rule.label} deliverable at ${path}? ${APPROVAL_SUFFIX[phase]}`
}

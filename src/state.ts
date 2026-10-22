/**
 * Pure reducer for Long Haul mode state. Every transition is expressed as an
 * event so the durable state, the plugin record, and the guidance text derive
 * from one source.
 *
 * @module dsh-longhaul/state
 */
import { finishChild, recordStep, recordUsage, startChild } from './budget.ts'
import { nextPhase } from './phases.ts'
import type { LonghaulState, StateEvent, TaskNode } from './types.ts'

/** Fresh state for one root session; mode starts off. */
export function initialState(rootSessionId: string, now: number): LonghaulState {
  return {
    version: 1,
    rootSessionId,
    mode: 'off',
    phase: 'P0',
    designVersion: 1,
    budget: { children: {}, total: { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } },
    fileOwners: {},
    changes: [],
    compactPending: false,
    updatedAt: now,
  }
}

/** The file-owner map derived from the current task tree. */
function ownersOf(tasks: readonly TaskNode[]): Record<string, string> {
  const owners: Record<string, string> = {}
  for (const task of tasks) {
    if (task.ownerSessionId === undefined) continue
    for (const file of task.files) owners[file.replaceAll('\\', '/')] = task.ownerSessionId
  }
  return owners
}

/**
 * Apply one event, returning new state. Invalid transitions throw so a caller
 * cannot silently advance a gate.
 * @param state - current durable state.
 * @param event - transition to apply.
 * @returns the next state.
 */
export function reduce(state: LonghaulState, event: StateEvent): LonghaulState {
  switch (event.type) {
    case 'mode/on':
      return { ...state, mode: 'on', updatedAt: event.at }
    case 'mode/off':
      return { ...state, mode: 'off', updatedAt: event.at }
    case 'plan/set':
      if (state.phase !== 'P0') throw new Error(`longhaul: a task plan can only be set in P0 (current ${state.phase})`)
      return { ...state, plan: event.plan, updatedAt: event.at }
    case 'phase/submit': {
      if (event.approval.phase !== state.phase) {
        throw new Error(`longhaul: submission phase ${event.approval.phase} does not match current ${state.phase}`)
      }
      if (state.pendingApproval !== undefined) throw new Error('longhaul: a submission is already pending')
      return { ...state, pendingApproval: event.approval, updatedAt: event.at }
    }
    case 'phase/approve': {
      if (state.phase !== event.phase) throw new Error(`longhaul: approve phase ${event.phase} does not match current ${state.phase}`)
      if (state.pendingApproval === undefined || state.pendingApproval.phase !== event.phase) {
        throw new Error(`longhaul: phase ${event.phase} has no pending submission`)
      }
      if (state.pendingApproval.decision !== 'allowed') throw new Error('longhaul: approval requires an allowed decision')
      const next = nextPhase(state.phase)
      const approved = { ...state.pendingApproval, decidedAt: event.at }
      if (next === undefined) {
        return { ...state, pendingApproval: undefined, lastApproved: approved, updatedAt: event.at }
      }
      return {
        ...state,
        phase: next,
        pendingApproval: undefined,
        lastApproved: approved,
        compactPending: true,
        updatedAt: event.at,
      }
    }
    case 'phase/reject': {
      if (state.phase !== event.phase) throw new Error(`longhaul: reject phase ${event.phase} does not match current ${state.phase}`)
      return {
        ...state,
        pendingApproval: undefined,
        lastRejection: { phase: event.phase, reason: event.reason ?? 'rejected', at: event.at },
        updatedAt: event.at,
      }
    }
    case 'change/request':
      return { ...state, changes: [...state.changes, event.request], updatedAt: event.at }
    case 'change/decide': {
      const target = state.changes.find(change => change.id === event.id)
      if (target === undefined) throw new Error(`longhaul: unknown design change request ${event.id}`)
      if (target.status !== 'proposed') throw new Error(`longhaul: design change request ${event.id} is already decided`)
      const changes = state.changes.map(change => change.id === event.id
        ? { ...change, status: event.approved ? 'approved' as const : 'rejected' as const, decidedAt: event.at }
        : change)
      return {
        ...state,
        changes,
        designVersion: event.approved ? state.designVersion + 1 : state.designVersion,
        compactPending: event.approved ? true : state.compactPending,
        updatedAt: event.at,
      }
    }
    case 'task/update': {
      if (state.plan === undefined) throw new Error('longhaul: cannot update a task before a plan exists')
      const tasks = state.plan.tasks.map(task => task.id === event.task.id ? event.task : task)
      if (!tasks.some(task => task.id === event.task.id)) throw new Error(`longhaul: unknown task ${event.task.id}`)
      return {
        ...state,
        plan: { ...state.plan, tasks },
        fileOwners: ownersOf(tasks),
        updatedAt: event.at,
      }
    }
    case 'budget/start': {
      if (state.budget.children[event.sessionId] !== undefined) return state
      return {
        ...state,
        budget: startChild(state.budget, event.sessionId, event.phase, event.at),
        updatedAt: event.at,
      }
    }
    case 'budget/step': {
      if (state.budget.children[event.sessionId] === undefined) return state
      return { ...state, budget: recordStep(state.budget, event.sessionId), updatedAt: event.at }
    }
    case 'budget/usage': {
      if (state.budget.children[event.sessionId] === undefined) return state
      return { ...state, budget: recordUsage(state.budget, event.sessionId, event.usage), updatedAt: event.at }
    }
    case 'budget/finish': {
      if (state.budget.children[event.sessionId] === undefined) return state
      return { ...state, budget: finishChild(state.budget, event.sessionId), updatedAt: event.at }
    }
    case 'compact/pending':
      return { ...state, compactPending: true, updatedAt: event.at }
    case 'compact/done':
      return { ...state, compactPending: false, updatedAt: event.at }
    default: {
      const never: never = event
      throw new TypeError(`longhaul: unknown state event ${JSON.stringify(never)}`)
    }
  }
}

/** Whether the state still needs an automatic compaction before the next turn. */
export function needsCompaction(state: LonghaulState): boolean {
  return state.compactPending
}

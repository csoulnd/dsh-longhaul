/**
 * Pure budget accounting for one Long Haul session tree: live child counters, a
 * tree total that survives child termination, and the verdict that decides when
 * to warn a child to converge or interrupt it. Counters are plain data so the
 * durable state can persist them and `longhaul_status` can report numbers that
 * match the child session logs.
 *
 * @module dsh-longhaul/budget
 */
import type {
  BudgetReport,
  BudgetState,
  BudgetVerdict,
  ChildBudgetState,
  Phase,
  UsageCounters,
} from './types.ts'

/** Step and token caps for one session tree. */
export interface BudgetLimits {
  /** Per-child step cap; the child stops at or above it. */
  childStepBudget: number
  /** Whole-tree step cap; 0 means unlimited. */
  totalStepBudget: number
  /**
   * Token cap over input, output, and cache read, applied to each child and to
   * the tree total; 0 means unlimited.
   */
  tokenBudget: number
  /** Fraction of a cap at which a child is warned; defaults to 0.8. */
  warnRatio?: number
}

/** Fraction of a budget at which a child is warned when `warnRatio` is absent. */
const DEFAULT_WARN_RATIO = 0.8

/** Fresh counters at zero. */
function zeroCounters(): UsageCounters {
  return { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
}

/** Tokens charged against the token budget: input plus output plus cache read. */
function tokensOf(counters: UsageCounters): number {
  return counters.inputTokens + counters.outputTokens + counters.cacheReadTokens
}

/** The live child entry for a session id, or undefined when it has none. */
function findChild(budget: BudgetState, sessionId: string): ChildBudgetState | undefined {
  return Object.hasOwn(budget.children, sessionId) ? budget.children[sessionId] : undefined
}

/** The live child entry for a session id; throws when it has none. */
function requireChild(budget: BudgetState, sessionId: string): ChildBudgetState {
  const child = findChild(budget, sessionId)
  if (child === undefined) throw new Error(`longhaul: unknown child session ${sessionId}`)
  return child
}

/** Whether a child has used its whole step allowance. */
function stepsAtCap(child: ChildBudgetState, limits: BudgetLimits): boolean {
  return child.steps >= limits.childStepBudget
}

/** Whether a token total has used the whole token allowance. */
function tokensAtCap(tokens: number, limits: BudgetLimits): boolean {
  return limits.tokenBudget > 0 && tokens >= limits.tokenBudget
}

/** Whether a child has reached the step warning ratio. */
function stepsAtWarn(child: ChildBudgetState, limits: BudgetLimits, warnRatio: number): boolean {
  return child.steps >= limits.childStepBudget * warnRatio
}

/** Whether a token total has reached the token warning ratio. */
function tokensAtWarn(tokens: number, limits: BudgetLimits, warnRatio: number): boolean {
  return limits.tokenBudget > 0 && tokens >= limits.tokenBudget * warnRatio
}

/** The verdict for one live child. */
function childVerdict(child: ChildBudgetState, limits: BudgetLimits, warnRatio: number): BudgetVerdict {
  const tokens = tokensOf(child)
  if (stepsAtCap(child, limits) || tokensAtCap(tokens, limits)) return 'stop'
  if (stepsAtWarn(child, limits, warnRatio) || tokensAtWarn(tokens, limits, warnRatio)) return 'warn'
  return 'ok'
}

/** Why one child is stopped, in step-then-token order. */
function childStopReasons(child: ChildBudgetState, limits: BudgetLimits): string[] {
  const reasons: string[] = []
  if (stepsAtCap(child, limits)) {
    reasons.push(`child ${child.sessionId} steps ${child.steps}/${limits.childStepBudget}`)
  }
  const tokens = tokensOf(child)
  if (tokensAtCap(tokens, limits)) {
    reasons.push(`child ${child.sessionId} tokens ${tokens}/${limits.tokenBudget}`)
  }
  return reasons
}

/** Why the tree total is stopped, in step-then-token order. */
function treeStopReasons(budget: BudgetState, limits: BudgetLimits): string[] {
  const reasons: string[] = []
  if (limits.totalStepBudget > 0 && budget.total.steps >= limits.totalStepBudget) {
    reasons.push(`tree steps ${budget.total.steps}/${limits.totalStepBudget}`)
  }
  const tokens = tokensOf(budget.total)
  if (tokensAtCap(tokens, limits)) reasons.push(`tree tokens ${tokens}/${limits.tokenBudget}`)
  return reasons
}

/** Reject a negative or non-finite budget. */
function assertBudget(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`longhaul: ${name} must be a finite non-negative number (got ${value})`)
  }
}

/**
 * Validate limits and resolve the effective warning ratio.
 * @param limits - step and token caps for the tree.
 * @returns the warning ratio to apply.
 */
function resolveWarnRatio(limits: BudgetLimits): number {
  assertBudget('childStepBudget', limits.childStepBudget)
  assertBudget('totalStepBudget', limits.totalStepBudget)
  assertBudget('tokenBudget', limits.tokenBudget)
  const warnRatio = limits.warnRatio ?? DEFAULT_WARN_RATIO
  if (!Number.isFinite(warnRatio) || warnRatio < 0 || warnRatio > 1) {
    throw new Error(`longhaul: warnRatio must be a finite number between 0 and 1 (got ${warnRatio})`)
  }
  return warnRatio
}

/** Deterministic code-unit order for session ids; locale-independent. */
function compareSessionIds(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * Fresh budget with no children and zeroed tree totals.
 * @returns a new, empty budget state.
 */
export function createBudget(): BudgetState {
  return { children: {}, total: zeroCounters() }
}

/**
 * Register a live child session with zeroed counters.
 * @param budget - current budget state; it is not mutated.
 * @param sessionId - session id owning the child entry.
 * @param phase - phase the child was dispatched in.
 * @param now - dispatch time in epoch milliseconds.
 * @returns the next budget state.
 */
export function startChild(budget: BudgetState, sessionId: string, phase: Phase, now: number): BudgetState {
  if (findChild(budget, sessionId) !== undefined) {
    throw new Error(`longhaul: child session ${sessionId} already has a budget entry`)
  }
  const child: ChildBudgetState = { ...zeroCounters(), sessionId, phase, startedAt: now }
  return { children: { ...budget.children, [sessionId]: child }, total: { ...budget.total } }
}

/**
 * Remove a live child entry while keeping its counters in the tree total, so a
 * terminated child still counts against the whole-tree caps.
 * @param budget - current budget state; it is not mutated.
 * @param sessionId - session id whose child entry is removed.
 * @returns the next budget state.
 */
export function finishChild(budget: BudgetState, sessionId: string): BudgetState {
  if (findChild(budget, sessionId) === undefined) {
    throw new Error(`longhaul: unknown child session ${sessionId}`)
  }
  const children = Object.fromEntries(
    Object.entries(budget.children).filter(([id]) => id !== sessionId),
  )
  return { children, total: { ...budget.total } }
}

/**
 * Count one model step for a live child and for the tree total.
 * @param budget - current budget state; it is not mutated.
 * @param sessionId - session id that took the step.
 * @returns the next budget state.
 */
export function recordStep(budget: BudgetState, sessionId: string): BudgetState {
  const child = requireChild(budget, sessionId)
  return {
    children: { ...budget.children, [sessionId]: { ...child, steps: child.steps + 1 } },
    total: { ...budget.total, steps: budget.total.steps + 1 },
  }
}

/**
 * Add token usage reported by one assistant message to a live child and to the
 * tree total. Absent counters count as zero.
 * @param budget - current budget state; it is not mutated.
 * @param sessionId - session id that reported the usage.
 * @param usage - token counters to add.
 * @returns the next budget state.
 */
export function recordUsage(
  budget: BudgetState,
  sessionId: string,
  usage: Partial<Pick<UsageCounters, 'inputTokens' | 'outputTokens' | 'cacheReadTokens'>>,
): BudgetState {
  const child = requireChild(budget, sessionId)
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const cacheReadTokens = usage.cacheReadTokens ?? 0
  return {
    children: {
      ...budget.children,
      [sessionId]: {
        ...child,
        inputTokens: child.inputTokens + inputTokens,
        outputTokens: child.outputTokens + outputTokens,
        cacheReadTokens: child.cacheReadTokens + cacheReadTokens,
      },
    },
    total: {
      ...budget.total,
      inputTokens: budget.total.inputTokens + inputTokens,
      outputTokens: budget.total.outputTokens + outputTokens,
      cacheReadTokens: budget.total.cacheReadTokens + cacheReadTokens,
    },
  }
}

/**
 * Steps taken by one live child. A child that already finished reports 0
 * because its counters now live only in the tree total.
 * @param budget - current budget state.
 * @param sessionId - session id to inspect.
 * @returns the child's step count, or 0 when it has no live entry.
 */
export function childSteps(budget: BudgetState, sessionId: string): number {
  return findChild(budget, sessionId)?.steps ?? 0
}

/**
 * Evaluate live children and the tree total against their caps.
 * @param budget - current budget state; it is not mutated.
 * @param limits - step and token caps for the tree; invalid values throw.
 * @returns verdicts per live child, a detached total copy, remaining tree steps
 * (undefined when unlimited), and deterministic exceeded reasons ordered by
 * session id with tree reasons last.
 */
export function evaluateBudget(budget: BudgetState, limits: BudgetLimits): BudgetReport {
  const warnRatio = resolveWarnRatio(limits)
  const sessionIds = Object.keys(budget.children).sort(compareSessionIds)
  const exceeded: string[] = []
  const verdicts = Object.fromEntries(sessionIds.map((sessionId) => {
    const child = budget.children[sessionId]
    if (child === undefined) return [sessionId, 'ok'] as const
    exceeded.push(...childStopReasons(child, limits))
    return [sessionId, childVerdict(child, limits, warnRatio)] as const
  }))
  exceeded.push(...treeStopReasons(budget, limits))
  const remainingSteps = limits.totalStepBudget === 0
    ? undefined
    : Math.max(0, limits.totalStepBudget - budget.total.steps)
  return {
    verdicts,
    total: { ...budget.total },
    remainingSteps,
    exceeded,
  }
}

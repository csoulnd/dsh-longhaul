/**
 * Behavior of the pure budget accounting module.
 */
import { describe, expect, it } from 'vitest'
import {
  childSteps,
  createBudget,
  evaluateBudget,
  finishChild,
  recordStep,
  recordUsage,
  startChild,
  type BudgetLimits,
} from '../../src/budget.ts'
import type { BudgetState, BudgetVerdict, Phase, UsageCounters } from '../../src/types.ts'

/** Limits with no tree-wide caps, so only the per-child budget applies. */
const LIMITS: BudgetLimits = { childStepBudget: 60, totalStepBudget: 0, tokenBudget: 0 }

/** Token counters accepted by {@link recordUsage}. */
type Usage = Partial<Pick<UsageCounters, 'inputTokens' | 'outputTokens' | 'cacheReadTokens'>>

/** A budget holding one live child that has run `steps` steps and used `usage`. */
function budgetWithChild(sessionId: string, steps = 0, usage: Usage = {}, phase: Phase = 'P2'): BudgetState {
  let budget = startChild(createBudget(), sessionId, phase, 1_000)
  for (let index = 0; index < steps; index += 1) budget = recordStep(budget, sessionId)
  return recordUsage(budget, sessionId, usage)
}

/** The verdict recorded for one live child. */
function verdictFor(budget: BudgetState, sessionId: string, limits: BudgetLimits = LIMITS): BudgetVerdict {
  return evaluateBudget(budget, limits).verdicts[sessionId]
}

describe('createBudget', () => {
  it('starts with no children and zeroed tree totals', () => {
    expect(createBudget()).toEqual({
      children: {},
      total: { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    })
  })

  it('returns independent states', () => {
    const first = createBudget()
    const second = createBudget()
    first.total.steps = 3
    expect(second.total.steps).toBe(0)
    expect(first.total).not.toBe(second.total)
  })
})

describe('child accounting', () => {
  it('records steps and usage in both the child and the tree total', () => {
    const budget = budgetWithChild('s1', 3, { inputTokens: 40, outputTokens: 10, cacheReadTokens: 5 })
    expect(budget.children.s1).toEqual({
      sessionId: 's1',
      phase: 'P2',
      startedAt: 1_000,
      steps: 3,
      inputTokens: 40,
      outputTokens: 10,
      cacheReadTokens: 5,
    })
    expect(budget.total).toEqual({ steps: 3, inputTokens: 40, outputTokens: 10, cacheReadTokens: 5 })
  })

  it('tracks steps per child independently', () => {
    let budget = startChild(createBudget(), 's1', 'P2', 1_000)
    budget = startChild(budget, 's2', 'P3', 2_000)
    budget = recordStep(budget, 's1')
    budget = recordStep(budget, 's1')
    budget = recordStep(budget, 's2')
    expect(childSteps(budget, 's1')).toBe(2)
    expect(childSteps(budget, 's2')).toBe(1)
    expect(budget.total.steps).toBe(3)
    expect(budget.children.s2.phase).toBe('P3')
    expect(budget.children.s2.startedAt).toBe(2_000)
  })

  it('keeps a finished child\'s counters in the tree total', () => {
    let budget = startChild(createBudget(), 's1', 'P2', 1_000)
    budget = recordStep(budget, 's1')
    budget = recordUsage(budget, 's1', { inputTokens: 100 })
    budget = startChild(budget, 's2', 'P2', 2_000)
    budget = recordStep(budget, 's2')
    const finished = finishChild(budget, 's1')
    expect(finished.children).not.toHaveProperty('s1')
    expect(Object.keys(finished.children)).toEqual(['s2'])
    expect(finished.total).toEqual({ steps: 2, inputTokens: 100, outputTokens: 0, cacheReadTokens: 0 })
    expect(budget.children).toHaveProperty('s1')
    expect(finished).not.toBe(budget)
    expect(finished.total).not.toBe(budget.total)
  })

  it('reports zero steps for a child that is gone', () => {
    const budget = finishChild(budgetWithChild('s1', 2), 's1')
    expect(childSteps(budget, 's1')).toBe(0)
    expect(childSteps(budget, 'never-started')).toBe(0)
  })

  it('throws when a child is started twice', () => {
    const budget = startChild(createBudget(), 's1', 'P2', 1_000)
    expect(() => startChild(budget, 's1', 'P2', 2_000)).toThrow(/already has a budget entry/u)
  })

  it('throws for an unknown child when recording or finishing', () => {
    const budget = createBudget()
    expect(() => recordStep(budget, 'ghost')).toThrow(/unknown child session ghost/u)
    expect(() => recordUsage(budget, 'ghost', { inputTokens: 1 })).toThrow(/unknown child session ghost/u)
    expect(() => finishChild(budget, 'ghost')).toThrow(/unknown child session ghost/u)
  })
})

describe('immutability', () => {
  it('returns new state without mutating the previous state', () => {
    const base = startChild(createBudget(), 's1', 'P2', 1_000)
    const snapshot = structuredClone(base)
    const stepped = recordStep(base, 's1')
    const used = recordUsage(base, 's1', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 })
    expect(base).toEqual(snapshot)
    expect(stepped).not.toBe(base)
    expect(stepped.children).not.toBe(base.children)
    expect(stepped.children.s1).not.toBe(base.children.s1)
    expect(stepped.total).not.toBe(base.total)
    expect(used).not.toBe(base)
    expect(used.children.s1).not.toBe(base.children.s1)
    expect(used.total).not.toBe(base.total)
    expect(base.total).toEqual({ steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })
  })

  it('returns a detached total in the report', () => {
    const budget = budgetWithChild('s1', 10, { inputTokens: 100 })
    const report = evaluateBudget(budget, LIMITS)
    report.total.steps = 999
    report.total.inputTokens = 999
    expect(report.total).not.toBe(budget.total)
    expect(budget.total.steps).toBe(10)
    expect(budget.total.inputTokens).toBe(100)
  })
})

describe('evaluateBudget', () => {
  it('is ok below the warning ratio', () => {
    expect(verdictFor(budgetWithChild('s1', 47), 's1')).toBe('ok')
  })

  it('warns a child at 80% of its step budget', () => {
    expect(verdictFor(budgetWithChild('s1', 48), 's1')).toBe('warn')
    expect(evaluateBudget(budgetWithChild('s1', 48), LIMITS).exceeded).toEqual([])
  })

  it('warns a child at a custom ratio', () => {
    const limits: BudgetLimits = { childStepBudget: 10, totalStepBudget: 0, tokenBudget: 0, warnRatio: 0.5 }
    expect(verdictFor(budgetWithChild('s1', 4), 's1', limits)).toBe('ok')
    expect(verdictFor(budgetWithChild('s1', 5), 's1', limits)).toBe('warn')
  })

  it('stops a child at 100% of its step budget', () => {
    const report = evaluateBudget(budgetWithChild('s1', 60), LIMITS)
    expect(report.verdicts.s1).toBe('stop')
    expect(report.exceeded).toEqual(['child s1 steps 60/60'])
  })

  it('warns and stops on the token budget over input, output, and cache read', () => {
    const limits: BudgetLimits = { childStepBudget: 60, totalStepBudget: 0, tokenBudget: 1_000 }
    const warned = budgetWithChild('s1', 0, { inputTokens: 500, outputTokens: 200, cacheReadTokens: 100 })
    expect(verdictFor(warned, 's1', limits)).toBe('warn')
    const stopped = budgetWithChild('s1', 0, { inputTokens: 500, outputTokens: 200, cacheReadTokens: 300 })
    const report = evaluateBudget(stopped, limits)
    expect(report.verdicts.s1).toBe('stop')
    expect(report.exceeded).toEqual(['child s1 tokens 1000/1000', 'tree tokens 1000/1000'])
  })

  it('stops the tree at the total step cap and reports remaining steps', () => {
    const limits: BudgetLimits = { childStepBudget: 60, totalStepBudget: 100, tokenBudget: 0 }
    let tree = startChild(createBudget(), 'a', 'P2', 1_000)
    for (let index = 0; index < 60; index += 1) tree = recordStep(tree, 'a')
    tree = startChild(tree, 'b', 'P2', 2_000)
    for (let index = 0; index < 40; index += 1) tree = recordStep(tree, 'b')
    const report = evaluateBudget(tree, limits)
    expect(report.total.steps).toBe(100)
    expect(report.remainingSteps).toBe(0)
    expect(report.verdicts.a).toBe('stop')
    expect(report.verdicts.b).toBe('ok')
    expect(report.exceeded).toEqual(['child a steps 60/60', 'tree steps 100/100'])

    const partial = evaluateBudget(budgetWithChild('a', 30), limits)
    expect(partial.remainingSteps).toBe(70)
    expect(partial.exceeded).toEqual([])
  })

  it('applies no tree caps when the total and token budgets are 0', () => {
    const budget = budgetWithChild('s1', 5, { inputTokens: 5_000_000, outputTokens: 5_000_000 })
    const report = evaluateBudget(budget, LIMITS)
    expect(report.verdicts.s1).toBe('ok')
    expect(report.remainingSteps).toBeUndefined()
    expect(report.exceeded).toEqual([])
  })

  it('lists exceeded reasons in session id order, then tree reasons', () => {
    const limits: BudgetLimits = { childStepBudget: 1, totalStepBudget: 2, tokenBudget: 1_000 }
    let budget = startChild(createBudget(), 'zulu', 'P2', 1_000)
    budget = recordStep(budget, 'zulu')
    budget = startChild(budget, 'alpha', 'P2', 2_000)
    budget = recordStep(budget, 'alpha')
    budget = recordUsage(budget, 'alpha', { inputTokens: 1_000 })
    const report = evaluateBudget(budget, limits)
    expect(Object.keys(report.verdicts)).toEqual(['alpha', 'zulu'])
    expect(report.exceeded).toEqual([
      'child alpha steps 1/1',
      'child alpha tokens 1000/1000',
      'child zulu steps 1/1',
      'tree steps 2/2',
      'tree tokens 1000/1000',
    ])
  })

  it('rejects invalid limits', () => {
    const budget = budgetWithChild('s1', 1)
    const invalid: BudgetLimits[] = [
      { childStepBudget: -1, totalStepBudget: 0, tokenBudget: 0 },
      { childStepBudget: Number.NaN, totalStepBudget: 0, tokenBudget: 0 },
      { childStepBudget: 60, totalStepBudget: -1, tokenBudget: 0 },
      { childStepBudget: 60, totalStepBudget: 0, tokenBudget: -5 },
      { childStepBudget: 60, totalStepBudget: 0, tokenBudget: 0, warnRatio: -0.1 },
      { childStepBudget: 60, totalStepBudget: 0, tokenBudget: 0, warnRatio: 1.5 },
      { childStepBudget: 60, totalStepBudget: 0, tokenBudget: 0, warnRatio: Number.NaN },
    ]
    for (const limits of invalid) {
      expect(() => evaluateBudget(budget, limits)).toThrow(/longhaul:/u)
    }
  })
})

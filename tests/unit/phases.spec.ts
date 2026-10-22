/**
 * Phase rules, deliverable checks, and design-change guardrails.
 */
import { describe, expect, it } from 'vitest'
import {
  canImplement,
  changeRequestProblem,
  deliverablePath,
  missingSections,
  nextPhase,
  PHASE_RULES,
  submissionProblems,
} from '../../src/phases.ts'
import { initialState, reduce } from '../../src/state.ts'

const requirements = `# Requirements

## Goal
Ship it.

## Scope
Host only.

## Non-goals
No client.

## Acceptance
Tests pass.

## Constraints
No upstream changes.

## Risks
Budget overrun.

## Budget
60 steps per child.
`

describe('phase order', () => {
  it('advances P0 to P3 and stops', () => {
    expect(nextPhase('P0')).toBe('P1')
    expect(nextPhase('P1')).toBe('P2')
    expect(nextPhase('P2')).toBe('P3')
    expect(nextPhase('P3')).toBeUndefined()
  })

  it('blocks implementation until P2', () => {
    const state = initialState('root', 1)
    expect(canImplement(state)).toBe(false)
    expect(canImplement(reduce(reduce(state, { type: 'mode/on', at: 2 }), {
      type: 'plan/set',
      at: 3,
      plan: { objective: 'o', createdAt: 3, version: 1, tasks: [] },
    }))).toBe(false)
  })
})

describe('deliverable sections', () => {
  it('accepts every required section', () => {
    expect(missingSections('P0', requirements)).toEqual([])
    expect(submissionProblems('P0', requirements)).toEqual([])
  })

  it('matches aliases, numbering, and case', () => {
    const text = requirements.replace('## Goal', '## 1. 目标')
    expect(missingSections('P0', text)).toEqual([])
  })

  it('reports missing sections and empty content', () => {
    expect(missingSections('P0', '## Goal\nonly')).toContain('Scope')
    expect(submissionProblems('P1', requirements)).toContain('missing sections: Architecture, Modules, Interfaces, Data Model, Dependencies, Failure Paths, Test Strategy, Milestones')
    expect(submissionProblems('P0', '')).toContain('deliverable is empty')
  })

  it('builds POSIX deliverable paths', () => {
    expect(deliverablePath('.longhaul', 'P1')).toBe('.longhaul/deliverables/01-design.md')
    expect(deliverablePath('.longhaul\\', 'P0')).toBe('.longhaul/deliverables/00-requirements.md')
  })

  it('exposes the four gates', () => {
    expect(Object.keys(PHASE_RULES)).toEqual(['P0', 'P1', 'P2', 'P3'])
    expect(PHASE_RULES.P2.allowsCode).toBe(true)
    expect(PHASE_RULES.P0.allowsCode).toBe(false)
  })
})

describe('design change requests', () => {
  const planned = reduce(reduce(initialState('root', 1), { type: 'mode/on', at: 2 }), {
    type: 'plan/set',
    at: 3,
    plan: {
      objective: 'o',
      createdAt: 3,
      version: 1,
      tasks: [
        { id: 't1', title: 'one', status: 'pending', files: ['a.ts'], dependsOn: [] },
        { id: 't2', title: 'two', status: 'pending', files: ['b.ts'], dependsOn: [] },
      ],
    },
  })
  const inP2 = { ...planned, phase: 'P2' as const }

  it('only allows changes from P2', () => {
    expect(changeRequestProblem(planned, ['t1'], 2)).toMatch(/P2/)
  })

  it('requires at least one affected task', () => {
    expect(changeRequestProblem(inP2, [], 2)).toMatch(/at least one/)
  })

  it('enforces the per-task ceiling', () => {
    const state = {
      ...inP2,
      changes: [
        { id: 'c1', title: 'x', evidence: 'e', impact: 'i', taskIds: ['t1'], status: 'approved' as const, createdAt: 1 },
        { id: 'c2', title: 'x', evidence: 'e', impact: 'i', taskIds: ['t1'], status: 'proposed' as const, createdAt: 2 },
      ],
    }
    expect(changeRequestProblem(state, ['t1'], 2)).toMatch(/limit 2/)
    expect(changeRequestProblem(state, ['t2'], 2)).toBeUndefined()
  })
})

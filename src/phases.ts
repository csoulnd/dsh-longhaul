/**
 * Phase definitions, deliverable requirements, and transition rules for the
 * four Long Haul gates. Pure functions only: the state reducer and tools supply
 * the durable state.
 *
 * @module dsh-longhaul/phases
 */
import type { DesignChangeRequest, LonghaulState, Phase } from './types.ts'
import { PHASES } from './types.ts'

/** What a phase permits and what it must produce. */
export interface PhaseRule {
  phase: Phase
  label: string
  /** Workspace-relative deliverable that must exist before submission. */
  deliverable: string
  /** Required deliverable headings, first alias is canonical. */
  sections: readonly (readonly string[])[]
  /** Whether implementation writes are allowed. */
  allowsCode: boolean
  /** Whether a task plan must be approved before entering. */
  requiresPlan: boolean
}

/** The four external gates, in execution order. */
export const PHASE_RULES: Record<Phase, PhaseRule> = {
  P0: {
    phase: 'P0',
    label: 'Requirements',
    deliverable: '00-requirements.md',
    sections: [
      ['Goal', '目标'],
      ['Scope', '范围'],
      ['Non-goals', '非目标'],
      ['Acceptance', '验收'],
      ['Constraints', '约束'],
      ['Risks', '风险'],
      ['Budget', '预算'],
    ],
    allowsCode: false,
    requiresPlan: false,
  },
  P1: {
    phase: 'P1',
    label: 'Design',
    deliverable: '01-design.md',
    sections: [
      ['Architecture', '架构'],
      ['Modules', '模块'],
      ['Interfaces', '接口'],
      ['Data Model', '数据模型'],
      ['Dependencies', '依赖'],
      ['Failure Paths', '失败路径'],
      ['Test Strategy', '测试策略'],
      ['Milestones', '里程碑'],
    ],
    allowsCode: false,
    requiresPlan: true,
  },
  P2: {
    phase: 'P2',
    label: 'Development',
    deliverable: '02-implementation.md',
    sections: [
      ['Changes', '变更'],
      ['Tests', '测试'],
      ['Rollback', '回滚'],
    ],
    allowsCode: true,
    requiresPlan: true,
  },
  P3: {
    phase: 'P3',
    label: 'Ship',
    deliverable: '03-release.md',
    sections: [
      ['Version', '版本'],
      ['Changelog', '变更日志'],
      ['Checklist', '发布清单'],
    ],
    allowsCode: false,
    requiresPlan: true,
  },
}

/** Whether a value is one of the four phases. */
export function isPhase(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value)
}

/** The next phase, or undefined after P3. */
export function nextPhase(phase: Phase): Phase | undefined {
  const index = PHASES.indexOf(phase)
  return PHASES[index + 1]
}

/** The deliverable path (POSIX separators) for one phase. */
export function deliverablePath(deliverableDir: string, phase: Phase): string {
  const dir = deliverableDir.replaceAll('\\', '/').replace(/\/+$/u, '')
  return `${dir}/deliverables/${PHASE_RULES[phase].deliverable}`
}

/**
 * Headings missing from a deliverable. A heading matches when a level-2 heading
 * contains one of the section aliases; numbering and inline suffixes are allowed.
 * @param phase - phase whose required sections apply.
 * @param markdown - deliverable content.
 * @returns canonical section names still missing.
 */
export function missingSections(phase: Phase, markdown: string): string[] {
  const headings = markdown
    .split(/\r?\n/u)
    .filter(line => /^##\s+/u.test(line))
    .map(line => line.replace(/^##\s+/u, '').trim().toLowerCase())
  return PHASE_RULES[phase].sections
    .filter(aliases => !aliases.some(alias => headings.some(heading => heading.includes(alias.toLowerCase()))))
    .map(aliases => aliases[0] ?? '')
}

/** Why a submission cannot be accepted, or an empty array when it can. */
export function submissionProblems(phase: Phase, markdown: string): string[] {
  const problems: string[] = []
  if (markdown.trim().length === 0) problems.push('deliverable is empty')
  const missing = missingSections(phase, markdown)
  if (missing.length > 0) problems.push(`missing sections: ${missing.join(', ')}`)
  return problems
}

/** Whether the state may enter P2 implementation work. */
export function canImplement(state: LonghaulState): boolean {
  return state.mode === 'on' && state.phase === 'P2' && state.plan !== undefined
}

/** Design change requests still open for one task. */
export function openChangesForTask(state: LonghaulState, taskId: string): DesignChangeRequest[] {
  return state.changes.filter(change => change.status === 'proposed' && change.taskIds.includes(taskId))
}

/** Whether a task is paused by an open design change request. */
export function isTaskPaused(state: LonghaulState, taskId: string): boolean {
  return openChangesForTask(state, taskId).length > 0
}

/**
 * Whether a design change request may be recorded.
 * @param state - current durable state.
 * @param taskIds - tasks the request would pause.
 * @param maxPerTask - configured ceiling per task.
 * @returns undefined when allowed, otherwise the reason.
 */
export function changeRequestProblem(
  state: LonghaulState,
  taskIds: readonly string[],
  maxPerTask: number,
): string | undefined {
  if (state.phase !== 'P2') return 'design changes can only be raised from P2'
  if (taskIds.length === 0) return 'a design change request must name at least one affected task'
  for (const taskId of taskIds) {
    const existing = state.changes.filter(change => change.taskIds.includes(taskId))
    if (existing.length >= maxPerTask) {
      return `task ${taskId} already has ${existing.length} design change requests (limit ${maxPerTask})`
    }
  }
  return undefined
}

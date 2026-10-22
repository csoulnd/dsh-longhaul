/**
 * Shared vocabulary for the Long Haul host: phases, durable mode state, task
 * plan, memory records, and budget counters. This module is dependency-free so
 * the state machine and ACL rules stay unit-testable without a Cordis runtime.
 *
 * @module dsh-longhaul/types
 */

/** The four external phase gates, in order. */
export const PHASES = ['P0', 'P1', 'P2', 'P3'] as const

/** One external phase gate. */
export type Phase = typeof PHASES[number]

/** Whether Long Haul mode is active for a root session. */
export type Mode = 'off' | 'on'

/** Token and step counters for one session or a subtree. */
export interface UsageCounters {
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

/** One child session's budget counters. */
export interface ChildBudgetState extends UsageCounters {
  sessionId: string
  phase: Phase
  startedAt: number
}

/** Durable budget state for one root session tree. */
export interface BudgetState {
  children: Record<string, ChildBudgetState>
  total: UsageCounters
}

/** Lifecycle of one task-tree node. */
export type TaskStatus = 'pending' | 'running' | 'done' | 'blocked' | 'cancelled'

/** One node of the approved task tree. */
export interface TaskNode {
  id: string
  title: string
  status: TaskStatus
  files: string[]
  dependsOn: string[]
  /** Child session currently owning this task, when dispatched. */
  ownerSessionId?: string
  /** Per-task step cap; absent means the configured child budget. */
  budgetSteps?: number
}

/** The plan approved at P0 and executed from P2. */
export interface TaskPlan {
  objective: string
  tasks: TaskNode[]
  createdAt: number
  version: number
}

/** One stage submission awaiting human approval. */
export interface StageApproval {
  phase: Phase
  deliverablePath: string
  summary: string
  requestedAt: number
  decision?: 'allowed' | 'rejected'
  decidedAt?: number
}

/** One design change request raised from development. */
export interface DesignChangeRequest {
  id: string
  title: string
  evidence: string
  impact: string
  /** Task ids paused until this request is decided. */
  taskIds: string[]
  status: 'proposed' | 'approved' | 'rejected'
  createdAt: number
  decidedAt?: number
}

/** Durable mode state for one root session tree. */
export interface LonghaulState {
  version: 1
  rootSessionId: string
  mode: Mode
  phase: Phase
  designVersion: number
  plan?: TaskPlan
  budget: BudgetState
  /** Workspace-relative file path to the owning child session id. */
  fileOwners: Record<string, string>
  pendingApproval?: StageApproval
  /** Most recent approved submission; the source of the next compaction handoff. */
  lastApproved?: StageApproval
  /** Most recent rejected submission, kept for guidance and audit. */
  lastRejection?: { phase: Phase; reason: string; at: number }
  changes: DesignChangeRequest[]
  /** Set when a phase exit still needs its history compacted. */
  compactPending: boolean
  updatedAt: number
}

/** Kind of a durable memory record. */
export type MemoryKind = 'decision' | 'finding' | 'artifact'

/** Fields shared by every durable memory record. */
export interface MemoryRecordBase {
  id: string
  kind: MemoryKind
  authorSessionId: string
  time: number
  version: number
  text: string
  tags: string[]
  evidence?: string
  supersedes?: string
}

/** A tree-wide constraint, interface contract, or accepted conclusion. */
export interface DecisionRecord extends MemoryRecordBase {
  kind: 'decision'
}

/** A branch-scoped discovery: a pitfall, temporary conclusion, or failure cause. */
export interface FindingRecord extends MemoryRecordBase {
  kind: 'finding'
}

/** A tree-wide reference to a deliverable, commit, or test evidence. */
export interface ArtifactRecord extends MemoryRecordBase {
  kind: 'artifact'
  path: string
}

/** Any durable memory record. */
export type MemoryRecord = DecisionRecord | FindingRecord | ArtifactRecord

/** Input accepted by the memory writer before ids, time, and version are assigned. */
export interface NewMemoryRecord {
  kind: MemoryKind
  authorSessionId: string
  text: string
  tags?: string[]
  evidence?: string
  supersedes?: string
  path?: string
}

/** Budget verdict for one child session. */
export type BudgetVerdict = 'ok' | 'warn' | 'stop'

/** Result of evaluating one subtree against its configured budgets. */
export interface BudgetReport {
  verdicts: Record<string, BudgetVerdict>
  total: UsageCounters
  remainingSteps: number | undefined
  exceeded: string[]
}

/** State events accepted by the pure reducer. */
export type StateEvent =
  | { type: 'mode/on'; at: number }
  | { type: 'mode/off'; at: number }
  | { type: 'plan/set'; at: number; plan: TaskPlan }
  | { type: 'phase/submit'; at: number; approval: StageApproval }
  | { type: 'phase/approve'; at: number; phase: Phase }
  | { type: 'phase/reject'; at: number; phase: Phase; reason?: string }
  | { type: 'change/request'; at: number; request: DesignChangeRequest }
  | { type: 'change/decide'; at: number; id: string; approved: boolean }
  | { type: 'task/update'; at: number; task: TaskNode }
  | { type: 'budget/start'; at: number; sessionId: string; phase: Phase }
  | { type: 'budget/step'; at: number; sessionId: string }
  | {
    type: 'budget/usage'
    at: number
    sessionId: string
    usage: Partial<Pick<UsageCounters, 'inputTokens' | 'outputTokens' | 'cacheReadTokens'>>
  }
  | { type: 'budget/finish'; at: number; sessionId: string }
  | { type: 'compact/pending'; at: number }
  | { type: 'compact/done'; at: number }

/** A model-facing model route chosen by deployment configuration. */
export interface PhaseModelChoice {
  provider: string
  model: string
  reasoningEffort?: string
}

/** A stage handoff written after compaction into the next phase. */
export interface StageHandoff {
  phase: Phase
  nextPhase?: Phase
  deliverablePath: string
  summary: string
  decisionIds: string[]
  openQuestions: string[]
  acceptanceCommands: string[]
  budgetRemaining: number | undefined
  designVersion: number
}

/** Structured result a child session returns to the parent. */
export interface ChildReport {
  summary: string
  files: string[]
  tests: string[]
  blockers: string[]
  evidence: string[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Durable mode snapshot written on every accepted transition. */
    'plugin:longhaul/state': {
      mode: Mode
      phase: Phase
      designVersion: number
      taskCount: number
      pending: string
      steps: number
      updatedAt: number
    }
  }
}


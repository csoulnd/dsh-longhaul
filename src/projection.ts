/**
 * Client-visible `longhaul` session projection. The host folds its own
 * `plugin:longhaul/state` records into a small view so the composer chip and
 * the read-only better-sidebar tab can show phase gates, the plan, deliverables,
 * and tree memory evidence without a custom RPC.
 *
 * @module dsh-longhaul/projection
 */
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { Phase, TaskStatus } from './types.ts'

/** One plan task as projected to the client. */
export interface LonghaulTaskView {
  id: string
  title: string
  status: TaskStatus
  files: string[]
  dependsOn: string[]
  ownerSessionId?: string
  budgetSteps?: number
}

/** One phase gate row in the sidebar stepper. */
export interface LonghaulGateView {
  phase: Phase
  status: 'done' | 'active' | 'waiting' | 'pending'
  deliverable: string
  decidedAt?: number
}

/** One recent tree-memory record projected for the evidence section. */
export interface LonghaulEvidenceItem {
  id: string
  text: string
  time: number
}

/** Recent tree memory plus total counts. */
export interface LonghaulEvidenceView {
  decisions: LonghaulEvidenceItem[]
  findings: LonghaulEvidenceItem[]
  artifacts: LonghaulEvidenceItem[]
  counts: { decisions: number; findings: number; artifacts: number }
}

/** Wire and state payload of the `longhaul` projection. */
export interface LonghaulView {
  mode: 'off' | 'on'
  phase: Phase
  designVersion: number
  taskCount: number
  pending: string
  steps: number
  /** Plan objective, empty until a plan is recorded. */
  objective: string
  /** Plan version, 0 until a plan is recorded. */
  planVersion: number
  /** The approved plan's task tree. */
  tasks: LonghaulTaskView[]
  /** Workspace-relative deliverable paths keyed by phase. */
  deliverables: Record<string, string>
  /** Phase gates with their current status and deliverable. */
  gates: LonghaulGateView[]
  /** Latest tree-memory evidence and counts. */
  evidence: LonghaulEvidenceView
  /** Time of the record that produced this view. */
  updatedAt: number
}

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'running', 'done', 'blocked', 'cancelled']),
  files: z.array(z.string()),
  dependsOn: z.array(z.string()),
  ownerSessionId: z.string().optional(),
  budgetSteps: z.number().optional(),
})

const gateSchema = z.object({
  phase: z.enum(['P0', 'P1', 'P2', 'P3']),
  status: z.enum(['done', 'active', 'waiting', 'pending']),
  deliverable: z.string(),
  decidedAt: z.number().optional(),
})

const evidenceItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  time: z.number(),
})

const evidenceSchema = z.object({
  decisions: z.array(evidenceItemSchema).default([]),
  findings: z.array(evidenceItemSchema).default([]),
  artifacts: z.array(evidenceItemSchema).default([]),
  counts: z.object({
    decisions: z.number().default(0),
    findings: z.number().default(0),
    artifacts: z.number().default(0),
  }).default({ decisions: 0, findings: 0, artifacts: 0 }),
})

const EMPTY_EVIDENCE: LonghaulEvidenceView = {
  decisions: [],
  findings: [],
  artifacts: [],
  counts: { decisions: 0, findings: 0, artifacts: 0 },
}

const viewSchema = z.object({
  mode: z.enum(['off', 'on']),
  phase: z.enum(['P0', 'P1', 'P2', 'P3']),
  designVersion: z.number(),
  taskCount: z.number(),
  pending: z.string(),
  steps: z.number(),
  objective: z.string().default(''),
  planVersion: z.number().default(0),
  tasks: z.array(taskSchema).default([]),
  deliverables: z.record(z.string(), z.string()).default({}),
  gates: z.array(gateSchema).default([]),
  evidence: evidenceSchema.default(EMPTY_EVIDENCE),
  updatedAt: z.number().default(0),
})

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    longhaul: LonghaulView
  }
  interface SessionProjectionMap {
    longhaul: LonghaulView
  }
}

const INITIAL: LonghaulView = {
  mode: 'off',
  phase: 'P0',
  designVersion: 1,
  taskCount: 0,
  pending: '',
  steps: 0,
  objective: '',
  planVersion: 0,
  tasks: [],
  deliverables: {},
  gates: [],
  evidence: EMPTY_EVIDENCE,
  updatedAt: 0,
}

/** Projection folded from Long Haul's durable state records. */
export const longhaulProjection = {
  key: 'longhaul',
  stateVersion: 1,
  stateSchema: viewSchema,
  init: () => INITIAL,
  apply: (state, event) => {
    const record = pluginRecordOf(event)
    if (record?.type !== 'plugin:longhaul/state') return state
    const parsed = viewSchema.safeParse(record.data)
    return parsed.success ? parsed.data : state
  },
  wire: {
    viewSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'longhaul', LonghaulView>

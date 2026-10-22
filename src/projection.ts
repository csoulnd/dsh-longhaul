/**
 * Client-visible `longhaul` session projection. The host folds its own
 * `plugin:longhaul/state` records into a small view so the composer chip can
 * show the current phase without a custom RPC.
 *
 * @module dsh-longhaul/projection
 */
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { Phase } from './types.ts'

/** Wire and state payload of the `longhaul` projection. */
export interface LonghaulView {
  mode: 'off' | 'on'
  phase: Phase
  designVersion: number
  taskCount: number
  pending: string
  steps: number
}

const viewSchema = z.object({
  mode: z.enum(['off', 'on']),
  phase: z.enum(['P0', 'P1', 'P2', 'P3']),
  designVersion: z.number(),
  taskCount: z.number(),
  pending: z.string(),
  steps: z.number(),
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

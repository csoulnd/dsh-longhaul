/**
 * Deployment configuration for Long Haul. Every deployment-varying choice is a
 * validated field here; protocol constants and the approval rule stay fixed.
 *
 * @module dsh-longhaul/config
 */
import z from '@deepseek-ai/schemastery'
import type { Phase, PhaseModelChoice } from './types.ts'

/** Model route for one phase, as written in cordis.yml. */
const phaseModelSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** How the mode chooses models across phases. */
export interface ModelPolicy {
  /** `inherit` keeps the session route; `phase` applies the per-phase routes below. */
  mode: 'inherit' | 'phase'
  /** Routes used only when `mode` is `phase`. */
  phases: Partial<Record<Phase, PhaseModelChoice>>
}

/** Long Haul host configuration. */
export interface Config {
  /** Workspace-relative directory holding deliverables, state, and branches. */
  deliverableDir: string
  /** Per-child step cap (D4 default: 60). */
  childStepBudget: number
  /** Maximum live children per root tree (D4 default: 6). */
  fanout: number
  /** Maximum delegation depth below the root (D4 default: 1). */
  maxDepth: number
  /** Whole-tree step cap; 0 disables the total cap. */
  totalStepBudget: number
  /** Whole-tree token cap (input + output + cache read); 0 disables it. */
  tokenBudget: number
  /** Whether each phase gate requires an `allowed-once` approval. */
  requireApproval: boolean
  /** Compact the finished phase out of the surface before entering the next one. */
  compactOnPhaseExit: boolean
  /** How many recent branch findings the dynamic context includes. */
  findingsInjectLimit: number
  /** Maximum design change requests per task before escalating to the user. */
  maxChangeRequestsPerTask: number
  /** Model routing policy; default `inherit` keeps the session route. */
  modelPolicy: ModelPolicy
  /** Deployment override for the stage policy prose; empty uses the built-in text. */
  policyText: string
}

/** Loader validation schema for {@link Config}. */
export const Config: z<Config> = z.object({
  deliverableDir: z.string().default('.longhaul'),
  childStepBudget: z.number().default(60),
  fanout: z.number().default(6),
  maxDepth: z.number().default(1),
  totalStepBudget: z.number().default(0),
  tokenBudget: z.number().default(0),
  requireApproval: z.boolean().default(true),
  compactOnPhaseExit: z.boolean().default(true),
  findingsInjectLimit: z.number().default(20),
  maxChangeRequestsPerTask: z.number().default(2),
  modelPolicy: z.object({
    mode: z.union(['inherit', 'phase'] as const).default('inherit'),
    phases: z.dict(phaseModelSchema).default({}),
  }).default({ mode: 'inherit', phases: {} }),
  policyText: z.string().default(''),
})

/** Human-readable deliverable file name per phase. */
const DELIVERABLE_NAMES: Record<Phase, string> = {
  P0: '00-requirements.md',
  P1: '01-design.md',
  P2: '02-implementation.md',
  P3: '03-release.md',
}

/** Deliverable file name for one phase. */
export function deliverableName(phase: Phase): string {
  return DELIVERABLE_NAMES[phase]
}

/** Validate cross-field constraints the loader schema cannot express. */
export function resolveConfig(raw: Config): Config {
  const config = structuredClone(raw)
  if (config.childStepBudget < 1 || config.childStepBudget > 10_000) {
    throw new Error('longhaul: childStepBudget must be between 1 and 10000')
  }
  if (config.fanout < 1 || config.fanout > 32) {
    throw new Error('longhaul: fanout must be between 1 and 32')
  }
  if (config.maxDepth < 1 || config.maxDepth > 4) {
    throw new Error('longhaul: maxDepth must be between 1 and 4')
  }
  if (config.totalStepBudget !== 0 && config.totalStepBudget < config.childStepBudget) {
    throw new Error('longhaul: totalStepBudget must be 0 or at least childStepBudget')
  }
  if (config.tokenBudget < 0) throw new Error('longhaul: tokenBudget cannot be negative')
  if (config.findingsInjectLimit < 0) throw new Error('longhaul: findingsInjectLimit cannot be negative')
  if (config.maxChangeRequestsPerTask < 0) throw new Error('longhaul: maxChangeRequestsPerTask cannot be negative')
  if (config.deliverableDir.trim() === '') throw new Error('longhaul: deliverableDir cannot be empty')
  if (config.deliverableDir.includes('..')) throw new Error('longhaul: deliverableDir cannot contain ".."')
  if (config.modelPolicy.mode === 'phase') {
    for (const phase of ['P0', 'P1', 'P2', 'P3'] as const) {
      if (config.modelPolicy.phases[phase] === undefined) {
        throw new Error(`longhaul: modelPolicy.mode "phase" requires a route for ${phase}`)
      }
    }
  }
  return config
}

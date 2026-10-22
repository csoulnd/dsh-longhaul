/**
 * Tool-execution gate for Long Haul: blocks implementation writes before P1 is
 * approved, blocks child sessions from integration commands, and rejects a
 * child's write to a file owned by another session. Pure so the policy is
 * unit-tested without the tool registry.
 *
 * @module dsh-longhaul/guard
 */
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { LonghaulState } from './types.ts'

/** Tools that create or modify files. */
export const WRITE_TOOLS: readonly string[] = ['write', 'edit', 'str_replace_editor', 'apply_patch']

/** Commands reserved to the parent (or an explicitly designated integrator). */
const INTEGRATION_PATTERNS: readonly RegExp[] = [
  /\bgit\s+(?:commit|push|tag)\b/iu,
  /\b(?:npm|pnpm|yarn)\s+publish\b/iu,
  /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b/iu,
  /\bgh\s+release\b/iu,
  /\bdocker\s+push\b/iu,
]

/** One pending tool call, already narrowed for the gate. */
export interface ToolGateInput {
  toolName: string
  args: unknown
  sessionId: string
  isRoot: boolean
  cwd: string
  deliverableDir: string
  state: LonghaulState | undefined
}

/** Whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The string argument named by `key`, when present. */
function stringArg(args: unknown, key: string): string | undefined {
  if (!isRecord(args)) return undefined
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

/** Workspace-relative POSIX path, or undefined for paths outside the workspace. */
function workspacePath(cwd: string, file: string): string | undefined {
  const absolute = isAbsolute(file) ? file : resolve(cwd, file)
  const rel = relative(cwd, absolute)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

/**
 * Whether a path is inside the deployment's deliverable directory.
 * @param cwd - session workspace root.
 * @param deliverableDir - configured directory, relative to the workspace.
 * @param file - path from the tool arguments.
 * @returns true when writes to this path are phase-independent.
 */
export function isDeliverablePath(cwd: string, deliverableDir: string, file: string): boolean {
  const rel = workspacePath(cwd, file)
  if (rel === undefined) return false
  const dir = deliverableDir.replaceAll('\\', '/').replace(/\/+$/u, '')
  return rel === dir || rel.startsWith(`${dir}/`)
}

/** Whether a shell command performs a parent-only integration action. */
export function isIntegrationCommand(command: string): boolean {
  return INTEGRATION_PATTERNS.some(pattern => pattern.test(command))
}

/**
 * Decide whether to deny one tool call.
 * @param input - tool name, parsed arguments, caller identity, and current state.
 * @returns a model-facing denial reason, or undefined to allow.
 */
export function toolDenial(input: ToolGateInput): string | undefined {
  const state = input.state
  if (state === undefined || state.mode !== 'on') return undefined
  if (input.toolName.startsWith('longhaul_')) return undefined

  if (WRITE_TOOLS.includes(input.toolName)) {
    const file = stringArg(input.args, 'path') ?? stringArg(input.args, 'file_path')
    if (file !== undefined) {
      if ((state.phase === 'P0' || state.phase === 'P1') && !isDeliverablePath(input.cwd, input.deliverableDir, file)) {
        return `Long Haul ${state.phase}: implementation writes are blocked until P1 Design is approved. `
          + `Write only inside ${input.deliverableDir}/, or submit the deliverable with longhaul_submit.`
      }
      const rel = workspacePath(input.cwd, file)
      if (!input.isRoot && rel !== undefined) {
        const owner = state.fileOwners[rel]
        if (owner !== undefined && owner !== input.sessionId) {
          return `Long Haul: ${rel} is owned by session ${owner}; only its owner may write it.`
        }
      }
    }
    return undefined
  }

  if (!input.isRoot && (input.toolName === 'pwsh' || input.toolName === 'bash')) {
    const command = stringArg(input.args, 'command') ?? ''
    if (isIntegrationCommand(command)) {
      return 'Long Haul: child sessions cannot run build, commit, push, or publish commands; '
        + 'return the change and let the parent integrate it.'
    }
  }
  return undefined
}

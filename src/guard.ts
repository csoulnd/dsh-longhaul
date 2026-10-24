/**
 * Tool-execution gate for Long Haul: blocks implementation writes before P1 is
 * approved, blocks child sessions from integration commands and unowned files,
 * and classifies shell commands against a conservative read-only allowlist.
 * Pure so the policy is unit-tested without the tool registry.
 *
 * @module dsh-longhaul/guard
 */
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { LonghaulState } from './types.ts'

/** Tools that create or modify files. */
export const WRITE_TOOLS: readonly string[] = ['write', 'edit', 'str_replace_editor', 'apply_patch']

/** Shell tools whose command strings are classified. */
export const SHELL_TOOLS: readonly string[] = ['pwsh', 'bash']

/** Commands reserved to the parent (or an explicitly designated integrator). */
const INTEGRATION_PATTERNS: readonly RegExp[] = [
  /\bgit\s+(?:commit|push|tag)\b/iu,
  /\b(?:npm|pnpm|yarn)\s+publish\b/iu,
  /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b/iu,
  /\bgh\s+release\b/iu,
  /\bdocker\s+push\b/iu,
]

/** Shell syntax that can write, chain, substitute, or run another program. */
const SHELL_METACHARACTERS = /[;&|<>`\n\r]/u

/** Command names that create, modify, or delete files. */
const SHELL_WRITE_COMMANDS = new Set([
  'add-content',
  'chmod',
  'chown',
  'clear-content',
  'copy',
  'copy-item',
  'cp',
  'dd',
  'del',
  'erase',
  'ln',
  'mkdir',
  'mklink',
  'move',
  'move-item',
  'mv',
  'new-item',
  'out-file',
  'rd',
  'remove-item',
  'ren',
  'rename-item',
  'rm',
  'rmdir',
  'set-content',
  'tee',
  'tee-object',
  'touch',
  'truncate',
])

/** PowerShell/cmd command names that are read-only in the supported forms. */
const READ_ONLY_POWERSHELL = new Set([
  'cat',
  'dir',
  'gci',
  'get-childitem',
  'get-content',
  'get-item',
  'get-location',
  'ls',
  'measure-object',
  'pwd',
  'resolve-path',
  'select-string',
  'test-path',
  'type',
  'where',
])

/** One pending tool call, already narrowed for the gate. */
export interface ToolGateInput {
  toolName: string
  args: unknown
  sessionId: string
  isRoot: boolean
  /** Effective cwd from the workingDirectory service; undefined means fail closed. */
  cwd: string | undefined
  deliverableDir: string
  state: LonghaulState | undefined
  /** State load failure; any non-empty value means writes fail closed. */
  stateError?: string
  /** Files the caller's plan task owns, normalized to POSIX separators. */
  ownedFiles?: readonly string[]
}

/** Classification of one shell command. */
export type ShellClassification =
  | { kind: 'read-only' }
  | { kind: 'implementation-write'; reason: string }
  | { kind: 'integration'; reason: string }
  | { kind: 'unknown'; reason: string }

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

/** Lower-case a command token and drop a Windows executable suffix. */
function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/\.(?:exe|cmd)$/u, '')
}

/**
 * Split a shell command into simple tokens. Returns undefined for any command
 * that uses metacharacters, quoting that does not close, or expansion syntax.
 * @param command - raw shell command.
 * @returns tokens, or undefined when the command is outside the supported subset.
 */
function shellTokens(command: string): string[] | undefined {
  if (command.trim() === '') return undefined
  if (SHELL_METACHARACTERS.test(command) || command.includes('$') || command.includes('%')) return undefined
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  for (const char of command) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/u.test(char)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (quote !== undefined) return undefined
  if (current !== '') tokens.push(current)
  return tokens.length === 0 ? undefined : tokens
}

/** Whether a git invocation only reads repository state. */
function isReadOnlyGit(tokens: readonly string[]): boolean {
  const subcommand = tokens[1] === undefined ? undefined : normalizeToken(tokens[1])
  if (subcommand === undefined) return false
  if (['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'grep'].includes(subcommand)) {
    return !tokens.slice(2).some(token => token.startsWith('--output'))
  }
  if (subcommand === 'branch') {
    return tokens.slice(2).every(token => [
      '--list',
      '-l',
      '-a',
      '-r',
      '-v',
      '--verbose',
      '--show-current',
      '--no-color',
    ].includes(token))
  }
  if (subcommand === 'tag') {
    return tokens.slice(2).every(token => ['--list', '-l', '--no-color'].includes(token))
  }
  if (subcommand === 'remote') {
    return tokens.length === 2 || tokens.slice(2).every(token => ['-v', '--verbose'].includes(token))
  }
  if (subcommand === 'config') {
    return tokens[2] === '--get' || tokens[2] === '--get-all' || tokens[2] === '--list' || tokens[2] === '-l'
  }
  if (subcommand === 'worktree') return tokens[2] === 'list'
  if (subcommand === 'stash') return tokens[2] === 'list' || tokens[2] === 'show'
  return false
}

/** Whether a token list is a conservative read-only command. */
function readOnlyTokens(tokens: readonly string[]): boolean {
  const first = normalizeToken(tokens[0] ?? '')
  if (first === 'git') return isReadOnlyGit(tokens)
  if (first === 'rg') {
    return !tokens.slice(1).some(token => token === '--pre' || token.startsWith('--pre=') || token === '--hostname-bin')
  }
  if (READ_ONLY_POWERSHELL.has(first)) return true
  if (first === 'node' || first === 'npm') {
    return tokens.length === 2 && (tokens[1] === '--version' || tokens[1] === '-v')
  }
  if (first === 'pnpm') {
    return (tokens.length === 2 && (tokens[1] === '--version' || tokens[1] === '-v'))
      || (tokens.length === 2 && tokens[1] === 'typecheck')
  }
  return false
}

/**
 * Whether a shell command is in the conservative read-only allowlist.
 * @param command - raw shell command.
 * @returns true only for a single, unquoted-metacharacter-free command in the allowlist.
 */
export function isReadOnlyCommand(command: string): boolean {
  const tokens = shellTokens(command)
  return tokens !== undefined && readOnlyTokens(tokens)
}

/**
 * Classify one shell command without executing it.
 * @param command - raw shell command.
 * @returns the policy class used by {@link toolDenial}.
 */
export function classifyShellCommand(command: string): ShellClassification {
  const tokens = shellTokens(command)
  if (tokens === undefined) {
    return { kind: 'unknown', reason: 'shell metacharacters, expansion, or unfinished quoting are not allowed' }
  }
  if (readOnlyTokens(tokens)) return { kind: 'read-only' }
  if (isIntegrationCommand(command)) {
    return { kind: 'integration', reason: 'build, commit, push, tag, and publish are parent-only integration commands' }
  }
  const first = normalizeToken(tokens[0] ?? '')
  if (SHELL_WRITE_COMMANDS.has(first)) {
    return { kind: 'implementation-write', reason: `shell command ${first} writes files` }
  }
  return { kind: 'unknown', reason: `shell command ${first || '(empty)'} is not in the read-only allowlist` }
}

/** Paths named by an apply_patch payload, or undefined when none can be parsed. */
function applyPatchPaths(args: unknown): string[] | undefined {
  const text = stringArg(args, 'patch') ?? stringArg(args, 'input') ?? stringArg(args, 'text')
  if (text === undefined) return undefined
  const paths = [...text.matchAll(/^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+(.+)$/gmu)]
    .map(match => match[1]?.trim())
    .filter((path): path is string => path !== undefined && path !== '')
  return paths.length === 0 ? undefined : paths
}

/** Whether a relative path belongs to the positive owned-file set. */
function isOwnedPath(rel: string, ownedFiles: readonly string[]): boolean {
  return ownedFiles.some((entry) => {
    const normalized = entry.replaceAll('\\', '/')
    return rel === normalized || (normalized.endsWith('/') && rel.startsWith(normalized))
  })
}

/**
 * Decide whether to deny one tool call.
 * @param input - tool name, parsed arguments, caller identity, cwd, and state.
 * @returns a model-facing denial reason, or undefined to allow.
 */
export function toolDenial(input: ToolGateInput): string | undefined {
  const isShell = SHELL_TOOLS.includes(input.toolName)
  const isWrite = WRITE_TOOLS.includes(input.toolName)

  if (input.stateError !== undefined && input.stateError !== '') {
    if (isShell) {
      const command = stringArg(input.args, 'command') ?? ''
      if (classifyShellCommand(command).kind === 'read-only') return undefined
    }
    if (isWrite || isShell) {
      return `Long Haul: state is unreadable (${input.stateError}); writes and shell writes are blocked until it is repaired.`
    }
  }

  const state = input.state
  if (state === undefined || state.mode !== 'on') return undefined
  if (!input.isRoot && input.toolName.startsWith('longhaul_') && input.toolName !== 'longhaul_memory') {
    return 'Long Haul: this tool is only available in the root session.'
  }
  if (input.toolName.startsWith('longhaul_')) return undefined

  if ((isWrite || isShell) && input.cwd === undefined) {
    return 'Long Haul: the effective working directory is unavailable; writes and shell commands are blocked.'
  }

  if (isWrite) {
    if (input.toolName === 'apply_patch') {
      if (state.phase === 'P0' || state.phase === 'P1') {
        return `Long Haul ${state.phase}: apply_patch is not allowed before P2; use write/edit for deliverables.`
      }
      if (!input.isRoot) {
        const paths = applyPatchPaths(input.args)
        if (paths === undefined) {
          return 'Long Haul: apply_patch payload cannot be parsed; use write/edit so file ownership can be checked.'
        }
        const ownedFiles = input.ownedFiles ?? []
        for (const path of paths) {
          const rel = workspacePath(input.cwd!, path)
          if (rel === undefined || !isOwnedPath(rel, ownedFiles)) {
            return `Long Haul: P2 child may only write files owned by its task: ${path}`
          }
        }
      }
      return undefined
    }

    const file = stringArg(input.args, 'path') ?? stringArg(input.args, 'file_path')
    if (file === undefined) return 'Long Haul: this write tool requires a path argument.'
    if ((state.phase === 'P0' || state.phase === 'P1') && !isDeliverablePath(input.cwd!, input.deliverableDir, file)) {
      return `Long Haul ${state.phase}: implementation writes are blocked until P1 Design is approved. `
        + `Write only inside ${input.deliverableDir}/, or submit the deliverable with longhaul_submit.`
    }
    if (!input.isRoot) {
      const rel = workspacePath(input.cwd!, file)
      if (rel === undefined) {
        return 'Long Haul: child sessions may only write inside the workspace.'
      }
      const ownedFiles = input.ownedFiles ?? []
      if (!isOwnedPath(rel, ownedFiles)) {
        return `Long Haul: P2 child may only write files owned by its task: ${rel}`
      }
    }
    return undefined
  }

  if (isShell) {
    const command = stringArg(input.args, 'command') ?? ''
    const classification = classifyShellCommand(command)
    if (classification.kind === 'read-only') return undefined
    if (classification.kind === 'integration') {
      if (state.phase === 'P0' || state.phase === 'P1') {
        return `Long Haul ${state.phase}: integration commands are not allowed before P2: ${classification.reason}`
      }
      if (!input.isRoot) {
        return `Long Haul: child sessions cannot run build, commit, push, or publish commands; ${classification.reason}`
      }
      return undefined
    }
    if (state.phase === 'P0' || state.phase === 'P1') {
      return `Long Haul ${state.phase}: ${classification.reason}. Only the read-only allowlist is available.`
    }
    if (!input.isRoot) {
      return `Long Haul: child sessions cannot run shell writes; use write/edit for owned files. ${classification.reason}`
    }
    return undefined
  }

  return undefined
}

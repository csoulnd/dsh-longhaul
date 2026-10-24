/**
 * Tool gate policy: phase writes, child integration commands, and ownership.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyShellCommand,
  isDeliverablePath,
  isIntegrationCommand,
  isReadOnlyCommand,
  toolDenial,
} from '../../src/guard.ts'
import { initialState } from '../../src/state.ts'
import type { LonghaulState } from '../../src/types.ts'

const cwd = 'C:/work/project'

function on(phase: LonghaulState['phase'] = 'P0'): LonghaulState {
  return { ...initialState('root', 1), mode: 'on', phase }
}

describe('deliverable paths', () => {
  it('accepts the deliverable directory and descendants', () => {
    expect(isDeliverablePath(cwd, '.longhaul', '.longhaul/deliverables/00-requirements.md')).toBe(true)
    expect(isDeliverablePath(cwd, '.longhaul', 'C:/work/project/.longhaul/x.md')).toBe(true)
  })

  it('rejects source files and escapes', () => {
    expect(isDeliverablePath(cwd, '.longhaul', 'src/index.ts')).toBe(false)
    expect(isDeliverablePath(cwd, '.longhaul', '../outside.md')).toBe(false)
    expect(isDeliverablePath(cwd, '.longhaul', 'C:/other/.longhaul/x.md')).toBe(false)
  })
})

describe('integration commands', () => {
  it('matches parent-only operations', () => {
    expect(isIntegrationCommand('git commit -m x')).toBe(true)
    expect(isIntegrationCommand('git push origin main')).toBe(true)
    expect(isIntegrationCommand('pnpm publish --access public')).toBe(true)
    expect(isIntegrationCommand('npm run build')).toBe(true)
    expect(isIntegrationCommand('gh release create v1')).toBe(true)
  })

  it('allows ordinary commands', () => {
    expect(isIntegrationCommand('git status')).toBe(false)
    expect(isIntegrationCommand('pnpm test')).toBe(false)
    expect(isIntegrationCommand('node scripts/check.mjs')).toBe(false)
  })
})

describe('shell classification', () => {
  it('classifies read-only commands and rejects write-capable ones', () => {
    expect(classifyShellCommand('git status')).toEqual({ kind: 'read-only' })
    expect(classifyShellCommand('git log --oneline -5')).toEqual({ kind: 'read-only' })
    expect(classifyShellCommand('rg -n "foo" src')).toEqual({ kind: 'read-only' })
    expect(classifyShellCommand('Get-ChildItem src')).toEqual({ kind: 'read-only' })
    expect(classifyShellCommand('pnpm typecheck')).toEqual({ kind: 'read-only' })
    expect(classifyShellCommand('Set-Content src/a.ts x')).toMatchObject({ kind: 'implementation-write' })
    expect(classifyShellCommand('git commit -m x')).toMatchObject({ kind: 'integration' })
    expect(classifyShellCommand('pnpm test')).toMatchObject({ kind: 'unknown' })
    expect(classifyShellCommand('pnpm build')).toMatchObject({ kind: 'integration' })
  })

  it('rejects metacharacters, pipes, redirection, and expansion', () => {
    expect(isReadOnlyCommand('git status && echo x')).toBe(false)
    expect(isReadOnlyCommand('git status | Out-File x')).toBe(false)
    expect(isReadOnlyCommand('git status > x')).toBe(false)
    expect(isReadOnlyCommand('Get-Content $(Get-ChildItem)')).toBe(false)
    expect(isReadOnlyCommand('git status')).toBe(true)
  })
})

describe('toolDenial', () => {
  const base = { sessionId: 'root', isRoot: true, cwd, deliverableDir: '.longhaul' }

  it('allows everything while the mode is off', () => {
    expect(toolDenial({ ...base, toolName: 'write', args: { path: 'src/a.ts' }, state: initialState('root', 1) })).toBeUndefined()
  })

  it('blocks implementation writes in P0 and P1 but allows deliverables', () => {
    for (const phase of ['P0', 'P1'] as const) {
      expect(toolDenial({ ...base, toolName: 'write', args: { path: 'src/a.ts' }, state: on(phase) })).toMatch(/blocked/)
      expect(toolDenial({ ...base, toolName: 'write', args: { path: '.longhaul/deliverables/01-design.md' }, state: on(phase) })).toBeUndefined()
    }
  })

  it('allows implementation writes in P2', () => {
    expect(toolDenial({ ...base, toolName: 'edit', args: { path: 'src/a.ts' }, state: on('P2') })).toBeUndefined()
  })

  it('blocks child integration commands and enforces positive file ownership', () => {
    const state: LonghaulState = { ...on('P2'), fileOwners: { 'src/a.ts': 'child-1' } }
    expect(toolDenial({
      ...base,
      sessionId: 'child-1',
      isRoot: false,
      toolName: 'pwsh',
      args: { command: 'git commit -m done' },
      state,
    })).toMatch(/cannot run build, commit/)
    expect(toolDenial({
      ...base,
      sessionId: 'child-1',
      isRoot: false,
      ownedFiles: ['src/a.ts'],
      toolName: 'write',
      args: { path: 'src/a.ts' },
      state,
    })).toBeUndefined()
    expect(toolDenial({
      ...base,
      sessionId: 'child-2',
      isRoot: false,
      ownedFiles: ['src/b.ts'],
      toolName: 'write',
      args: { path: 'src/a.ts' },
      state,
    })).toMatch(/may only write files owned/)
    expect(toolDenial({
      ...base,
      sessionId: 'child-2',
      isRoot: false,
      ownedFiles: [],
      toolName: 'write',
      args: { path: 'src/unowned.ts' },
      state,
    })).toMatch(/may only write files owned/)
  })

  it('never gates its own tools in the root session', () => {
    expect(toolDenial({ ...base, toolName: 'longhaul_submit', args: {}, state: on('P0') })).toBeUndefined()
  })

  it('gates root-only tools in a child but leaves memory open', () => {
    const state = on('P2')
    expect(toolDenial({
      ...base,
      sessionId: 'child-1',
      isRoot: false,
      toolName: 'longhaul_dispatch',
      args: {},
      state,
    })).toMatch(/only available in the root session/)
    expect(toolDenial({
      ...base,
      sessionId: 'child-1',
      isRoot: false,
      toolName: 'longhaul_memory',
      args: { action: 'append_finding', text: 'x' },
      state,
    })).toBeUndefined()
  })

  it('blocks shell writes in P0 and P1 but keeps read-only commands usable', () => {
    for (const phase of ['P0', 'P1'] as const) {
      const state = on(phase)
      expect(toolDenial({
        ...base,
        toolName: 'pwsh',
        args: { command: 'Set-Content src/a.ts x' },
        state,
      })).toMatch(/read-only allowlist/)
      expect(toolDenial({
        ...base,
        toolName: 'pwsh',
        args: { command: 'git status' },
        state,
      })).toBeUndefined()
      expect(toolDenial({
        ...base,
        toolName: 'pwsh',
        args: { command: 'git commit -m x' },
        state,
      })).toMatch(/integration commands are not allowed/)
    }
  })

  it('allows the parent to integrate in P2 but blocks child shell writes', () => {
    const state = on('P2')
    expect(toolDenial({ ...base, toolName: 'pwsh', args: { command: 'git commit -m x' }, state })).toBeUndefined()
    expect(toolDenial({ ...base, toolName: 'pwsh', args: { command: 'Set-Content src/a.ts x' }, state })).toBeUndefined()
    expect(toolDenial({
      ...base,
      sessionId: 'child-1',
      isRoot: false,
      ownedFiles: ['src/a.ts'],
      toolName: 'pwsh',
      args: { command: 'Set-Content src/a.ts x' },
      state,
    })).toMatch(/child sessions cannot run shell writes/)
    expect(toolDenial({
      ...base,
      sessionId: 'child-1',
      isRoot: false,
      toolName: 'pwsh',
      args: { command: 'git status' },
      state,
    })).toBeUndefined()
  })

  it('fails closed when the state is unreadable', () => {
    const state = on('P0')
    expect(toolDenial({
      ...base,
      toolName: 'write',
      args: { path: '.longhaul/deliverables/00-requirements.md' },
      state,
      stateError: 'state.json is not valid JSON',
    })).toMatch(/state is unreadable/)
    expect(toolDenial({
      ...base,
      toolName: 'pwsh',
      args: { command: 'git status' },
      state,
      stateError: 'state.json is not valid JSON',
    })).toBeUndefined()
  })

  it('fails closed when the working directory is unavailable', () => {
    expect(toolDenial({
      ...base,
      cwd: undefined,
      toolName: 'write',
      args: { path: '.longhaul/deliverables/00-requirements.md' },
      state: on('P0'),
    })).toMatch(/working directory is unavailable/)
  })

  it('denies apply_patch before P2 and checks child paths in P2', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch'
    expect(toolDenial({ ...base, toolName: 'apply_patch', args: { patch }, state: on('P0') }))
      .toMatch(/apply_patch is not allowed/)
    expect(toolDenial({
      ...base,
      sessionId: 'child-1',
      isRoot: false,
      ownedFiles: ['src/a.ts'],
      toolName: 'apply_patch',
      args: { patch },
      state: on('P2'),
    })).toBeUndefined()
    expect(toolDenial({
      ...base,
      sessionId: 'child-1',
      isRoot: false,
      ownedFiles: ['src/b.ts'],
      toolName: 'apply_patch',
      args: { patch },
      state: on('P2'),
    })).toMatch(/may only write files owned/)
  })
})

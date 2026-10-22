/**
 * Tool gate policy: phase writes, child integration commands, and ownership.
 */
import { describe, expect, it } from 'vitest'
import { isDeliverablePath, isIntegrationCommand, toolDenial } from '../../src/guard.ts'
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

  it('blocks child integration commands and foreign files', () => {
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
      toolName: 'write',
      args: { path: 'src/a.ts' },
      state,
    })).toBeUndefined()
    expect(toolDenial({
      ...base,
      sessionId: 'child-2',
      isRoot: false,
      toolName: 'write',
      args: { path: 'src/a.ts' },
      state,
    })).toMatch(/owned by session child-1/)
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
})

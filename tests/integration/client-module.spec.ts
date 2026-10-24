/**
 * Browser-module contract for the composer chip: the hand-written client
 * registers, injects, and writes the command through the public input actions.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Node {
  type: string
  props: Record<string, unknown>
  children: unknown[]
}

const React = {
  createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]): Node => ({
    type,
    props: props ?? {},
    children,
  }),
  useState: <T>(value: T): [T, (next: T) => void] => [
    value !== null && typeof value === 'object' ? { ...value, ...expandedInitial } as T : value,
    () => {},
  ],
  useCallback: <T>(fn: T): T => fn,
  useSyncExternalStore: (_subscribe: () => () => void, getSnapshot: () => unknown): unknown => getSnapshot(),
  Fragment: 'fragment',
}

let confirmAnswer = true
let expandedInitial: Record<string, boolean> = {}

function loadClient(): { inject: string[]; apply(ctx: unknown): void } {
  const source = readFileSync(new URL('../../client.js', import.meta.url), 'utf8')
  let registration: { id: string; factory(require: (name: string) => unknown): { inject: string[]; apply(ctx: unknown): void } } | undefined
  const window = {
    confirm: () => confirmAnswer,
    __ModuleLoader__: {
      load(value: typeof registration) { registration = value },
    },
  }
  const factory = new Function('window', 'require', source) as (window: unknown, require: (name: string) => unknown) => void
  factory(window, (name: string) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })
  expect(registration?.id).toBe('dsh-longhaul')
  return registration!.factory((name: string) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })
}

interface TabDescriptorLike {
  id: string
  title?: string | (() => string)
  component(props: unknown): Node
}

interface MountedClient {
  component: (props: unknown) => Node
  tabs: TabDescriptorLike[]
  opened: { type: string; path?: string; id?: string }[]
}

function mount(): MountedClient {
  const module = loadClient()
  let component: ((props: unknown) => Node) | undefined
  const tabs: TabDescriptorLike[] = []
  const opened: { type: string; path?: string; id?: string }[] = []
  const betterSidebar = {
    registerTab: (descriptor: TabDescriptorLike) => {
      tabs.push(descriptor)
      return () => {}
    },
    openTab: (seed: { type: string; path?: string; id?: string }) => { opened.push(seed) },
  }
  module.apply({
    locale: { register: () => {}, bind: () => (key: string) => key },
    slots: {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: (_options: unknown, render: (props: unknown) => Node) => {
        component = render
        return () => {}
      },
    },
    get: (name: string) => (name === 'betterSidebar' ? betterSidebar : undefined),
    effect: (fn: () => unknown) => {
      fn()
      return () => {}
    },
  } as never)
  expect(component).toBeTypeOf('function')
  return { component: component!, tabs, opened }
}

function chipOf(view: { mode: string; phase: string }, draft = ''): {
  tree: Node
  calls: string[]
} {
  const calls: string[] = []
  const component = mount().component
  const tree = component({
    t: (key: string) => key,
    useProjection: () => view,
    useInput: (selector: (state: { draft: string }) => unknown) => selector({ draft }),
    inputActions: {
      setDraft: (text: string) => { calls.push(`draft:${text}`) },
      submit: () => { calls.push('submit') },
    },
  })
  return { tree, calls }
}

describe('client module', () => {
  it('registers through the module loader with only slot and locale services', () => {
    const module = loadClient()
    expect(module.inject).toEqual(['slots', 'locale'])
  })

  it('renders an off chip', () => {
    const { tree } = chipOf({ mode: 'off', phase: 'P0' })
    expect(tree.type).toBe('span')
    const button = tree.children[0] as Node
    expect(button.type).toBe('button')
    expect(button.children).toContain('chip.label')
    expect(button.props.title).toBe('chip.off.title')
  })

  it('writes and submits /longhaul on when clicked while off', () => {
    const { tree, calls } = chipOf({ mode: 'off', phase: 'P0' })
    const button = tree.children[0] as Node
    ;(button.props.onClick as () => void)()
    expect(calls).toEqual(['draft:/longhaul on', 'submit'])
  })

  it('does not submit when the risk confirmation is declined', () => {
    confirmAnswer = false
    try {
      const { tree, calls } = chipOf({ mode: 'off', phase: 'P0' })
      const button = tree.children[0] as Node
      ;(button.props.onClick as () => void)()
      expect(calls).toEqual([])
    } finally {
      confirmAnswer = true
    }
  })

  it('writes and submits /longhaul off when clicked while on', () => {
    const { tree, calls } = chipOf({ mode: 'on', phase: 'P2' })
    expect((tree.children[0] as Node).children).toContain('chip.on')
    const button = tree.children[0] as Node
    ;(button.props.onClick as () => void)()
    expect(calls).toEqual(['draft:/longhaul off', 'submit'])
  })

  it('does not overwrite a non-empty composer draft', () => {
    const { tree, calls } = chipOf({ mode: 'off', phase: 'P0' }, 'existing text')
    const button = tree.children[0] as Node
    ;(button.props.onClick as () => void)()
    expect(calls).toEqual([])
  })

  it('registers a better-sidebar task tab and renders phases and tasks', () => {
    const { tabs, opened } = mount()
    const tab = tabs.find(candidate => candidate.id === 'longhaul:tasks')
    expect(tab).toBeDefined()
    expect(tab!.title?.()).toBe('tab.title')

    const jumped: string[] = []
    expandedInitial = { t2: true }
    let tree: Node
    try {
      tree = tab!.component({
        ctx: {
          locale: { bind: () => (key: string) => key },
          sessions: {
            list: {
              subscribe: () => () => {},
              getSnapshot: () => ({
                byId: { root: { id: 'root', cwd: 'C:/work' } },
                projectionsBySession: {
                  root: {
                    values: {
                      longhaul: {
                        mode: 'on',
                        phase: 'P2',
                        designVersion: 2,
                        taskCount: 2,
                        pending: 'P2',
                        steps: 9,
                        objective: 'ship the plugin',
                        planVersion: 3,
                        updatedAt: 1,
                        deliverables: {
                          P0: '.longhaul/deliverables/00-requirements.md',
                          P1: '.longhaul/deliverables/01-design.md',
                          P2: '.longhaul/deliverables/02-implementation.md',
                          P3: '.longhaul/deliverables/03-release.md',
                        },
                        gates: [
                          { phase: 'P0', status: 'done', deliverable: '.longhaul/deliverables/00-requirements.md' },
                          { phase: 'P1', status: 'done', deliverable: '.longhaul/deliverables/01-design.md' },
                          { phase: 'P2', status: 'active', deliverable: '.longhaul/deliverables/02-implementation.md' },
                          { phase: 'P3', status: 'pending', deliverable: '.longhaul/deliverables/03-release.md' },
                        ],
                        evidence: {
                          decisions: [{ id: 'd1', text: 'use the sidecar', time: 1 }],
                          findings: [],
                          artifacts: [],
                          counts: { decisions: 1, findings: 0, artifacts: 0 },
                        },
                        tasks: [
                          { id: 't1', title: 'gate hardening', status: 'done', files: ['src/guard.ts'], dependsOn: [] },
                          {
                            id: 't2',
                            title: 'stage flow',
                            status: 'running',
                            files: [],
                            dependsOn: ['t1'],
                            ownerSessionId: 'child-1',
                            budgetSteps: 60,
                          },
                        ],
                      },
                    },
                  },
                },
              }),
            },
          },
        },
        scope: { sessionId: 'root', cwd: 'C:/work' },
        onSubagentJump: (id: string) => { jumped.push(id) },
      })
    } finally {
      expandedInitial = {}
    }

    const text = JSON.stringify(tree)
    expect(text).toContain('gate hardening')
    expect(text).toContain('stage flow')
    expect(text).toContain('phase.P0')
    expect(text).toContain('tree.objective')
    expect(text).toContain('ship the plugin')
    expect(text).toContain('status.running')
    expect(text).toContain('.longhaul/deliverables/01-design.md')
    expect(text).toContain('use the sidecar')
    expect(text).toContain('tree.evidence')

    const findButton = (node: unknown, title: string): Node | undefined => {
      if (typeof node !== 'object' || node === null) return undefined
      const candidate = node as Node
      if (candidate.type === 'button' && candidate.props.title === title) return candidate
      for (const child of candidate.children ?? []) {
        const found = findButton(child, title)
        if (found !== undefined) return found
      }
      return undefined
    }

    const deliverable = findButton(tree, '.longhaul/deliverables/01-design.md')
    expect(deliverable).toBeDefined()
    ;(deliverable!.props.onClick as () => void)()
    expect(opened[0]).toMatchObject({
      type: 'editor',
      path: 'C:/work/.longhaul/deliverables/01-design.md',
      id: 'editor:C:/work/.longhaul/deliverables/01-design.md',
    })

    const button = findButton(tree, 'tree.openChild')
    expect(button).toBeDefined()
    ;(button!.props.onClick as () => void)()
    expect(jumped).toEqual(['child-1'])
  })
})

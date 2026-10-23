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
  useState: <T>(value: T): [T, (next: T) => void] => [value, () => {}],
  Fragment: 'fragment',
}

function loadClient(): { inject: string[]; apply(ctx: unknown): void } {
  const source = readFileSync(new URL('../../client.js', import.meta.url), 'utf8')
  let registration: { id: string; factory(require: (name: string) => unknown): { inject: string[]; apply(ctx: unknown): void } } | undefined
  const window = {
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

function mount(): (props: unknown) => Node {
  const module = loadClient()
  let component: ((props: unknown) => Node) | undefined
  module.apply({
    locale: { register: () => {} },
    slots: {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: (_options: unknown, render: (props: unknown) => Node) => {
        component = render
        return () => {}
      },
    },
  } as never)
  expect(component).toBeTypeOf('function')
  return component!
}

function chipOf(view: { mode: string; phase: string }, draft = ''): {
  tree: Node
  calls: string[]
} {
  const calls: string[] = []
  const component = mount()
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
})

/**
 * Browser-module contract for the composer chip: the hand-written client
 * registers, injects, and renders without a real browser.
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

function renderTree(node: unknown): Node | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  return node as Node
}

describe('client module', () => {
  it('registers through the module loader and injects its services', () => {
    const module = loadClient()
    expect(module.inject).toEqual(['slots', 'remote.commands', 'locale'])
  })

  it('registers the composer slot and renders an off chip', () => {
    const module = loadClient()
    let component: ((props: unknown) => Node) | undefined
    const ctx = {
      locale: { register: () => {} },
      slots: {
        inject: (_name: string, callback: () => () => void) => callback(),
        register: (_options: unknown, render: (props: unknown) => Node) => {
          component = render
          return () => {}
        },
      },
      remote: { commands: { execute: async () => ({ ok: true, value: {} }) } },
    } as never
    module.apply(ctx)
    expect(component).toBeTypeOf('function')

    const tree = component!({
      t: (key: string) => key,
      useProjection: () => ({ mode: 'off', phase: 'P0' }),
      execute: async () => null,
    })
    expect(tree.type).toBe('span')
    const button = tree.children[0] as Node
    expect(button.type).toBe('button')
    expect(button.children).toContain('chip.label')
    expect(button.props.title).toBe('chip.off.title')
  })

  it('renders the phase label while active', () => {
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
      remote: { commands: { execute: async () => ({ ok: true, value: {} }) } },
    } as never)
    const tree = renderTree(component!({
      t: (key: string) => key,
      useProjection: () => ({ mode: 'on', phase: 'P2' }),
      execute: async () => null,
    }))!
    const button = tree.children[0] as Node
    expect(button.children).toContain('chip.on')
    expect(button.props.title).toBe('chip.on.title')
    expect(button.props['aria-label']).toBe('chip.on')
  })
})

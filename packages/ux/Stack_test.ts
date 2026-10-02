import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { signal } from '@preact/signals'
import { h } from 'preact'
import { type Bundle } from '@yaks/graph'
import { Scroll } from '@yaks/tui'
import { mount } from '../tui/testing.ts'
import {
  cut,
  type PaneProps,
  scrolledPane,
  scrollOf,
  Stack,
  stacked,
} from './Stack.ts'

test('a stack keeps each pane scroll through push and cut', () => {
  let e: Bundle = { entity: { eid: 'stack' }, Stack: { panes: ['a'] } }
  e = scrolledPane(e, 'a', 23)
  e = stacked(e, 'b')
  e = scrolledPane(e, 'b', 7)
  e = cut(e, 0)
  assertEquals(scrollOf(e, 'a'), 23)
  assertEquals(scrollOf(e, 'b'), 7)
})

test('a returned-to stack page paints where it was scrolled', async () => {
  let e = signal<Bundle>({ entity: { eid: 's' }, Stack: { panes: ['a'] } })
  let Pane = ({ pane, top, onScroll }: PaneProps) =>
    h(
      Scroll,
      { id: pane, top, onScroll, follow: false, grow: '1' },
      ...Array.from(
        { length: 40 },
        (_, i) => h('div', {}, `${pane} line ${i}`),
      ),
    )
  let App = () =>
    h(Stack, {
      e: e.value,
      onChange: (b) => e.value = b,
      Pane,
      Strip: ({ pane }) => h('span', {}, pane),
    })
  let ui = await mount(App, 30, 5)
  try {
    await ui.send('\x1b[6~')
    let before = ui.text()
    assertEquals(scrollOf(e.value, 'a') > 0, true)
    e.value = stacked(e.value, 'b')
    await ui.send('')
    e.value = cut(e.value, 0)
    await ui.send('')
    assertEquals(ui.text(), before)
  } finally {
    ui.free()
  }
})

test('browser stack restores the scrolling body after returning from a strip', async () => {
  let { parseHTML } = await import('linkedom')
  let { render } = await import('preact')
  let { tick } = await import('@yaks/testing')
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let names = ['document', 'getComputedStyle', 'MutationObserver'] as const
  let prior = names.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name)
  )
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    getComputedStyle: {
      value: () => ({ overflowY: 'auto' }),
      configurable: true,
    },
    MutationObserver: {
      value: class {
        observe() {}
        disconnect() {}
      },
      configurable: true,
    },
  })
  let e: Bundle = { entity: { eid: 'browser-stack' }, Stack: { panes: ['a'] } }
  let root = document.querySelector('main')!
  let Pane = ({ pane }: PaneProps) =>
    h('div', {
      'data-body': pane,
      ref: (el: HTMLElement | null) => {
        if (!el) return
        Object.defineProperties(el, {
          scrollHeight: { value: 1000, configurable: true },
          clientHeight: { value: 100, configurable: true },
        })
      },
    }, pane)
  let draw = () =>
    render(
      h(Stack, {
        e,
        Pane,
        Strip: ({ pane }) => h('span', {}, pane),
        onChange: (b) => {
          e = b
          draw()
        },
      }),
      root,
    )
  try {
    draw()
    let body = root.querySelector('[data-body]')! as unknown as HTMLElement
    body.scrollTop = 320
    body.dispatchEvent(
      new document.defaultView!.Event('scroll', { bubbles: true }),
    )
    assertEquals(scrollOf(e, 'a'), 320)
    e = stacked(e, 'b')
    draw()
    root.querySelector('button')!.click()
    await tick()
    assertEquals(
      (root.querySelector('[data-body]') as unknown as HTMLElement).scrollTop,
      320,
    )
  } finally {
    render(null, root)
    names.forEach((name, i) => {
      if (prior[i]) Object.defineProperty(globalThis, name, prior[i]!)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
})

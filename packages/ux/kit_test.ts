// Kits are a bringer's boundary: declarations load in a page, and controlled
// components can be discovered and drawn without a plugin or a server.
import { assertEquals, assertThrows } from '@std/assert'
import { test, tick } from '@yaks/testing'
import { client, stash } from '@yaks/client'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { h, options, render } from 'preact'
import { parseHTML } from 'linkedom'
import { defineKit, kitDocs } from './kit.ts'
import { kit, ux } from './ui.ts'

let words: VocabDoc = {
  $defs: {
    Toggle: {
      component: true,
      sync: 'none',
      durable: 'connection',
      properties: { open: { type: 'boolean' } },
    },
  },
}
let Toggle = ({ open }: { open: boolean }) =>
  h('span', {}, open ? 'open' : 'closed')
let external = (vocab = words) =>
  defineKit({
    description: 'An outside kit',
    vocab,
    components: {
      Toggle: {
        Component: Toggle,
        description: 'A controlled toggle',
        state: ['Toggle'],
        specimens: () =>
          [['Open', h('div', {}, h(Toggle, { open: true }))]] as [
            string,
            ReturnType<typeof h>,
          ][],
      },
    },
  })

test('an external kit carries its component, specimens and own page words', async () => {
  let brought = external()
  assertEquals(brought.components.Toggle.Component, Toggle)
  assertEquals(kitDocs({ brought, again: brought }), [words])
  let disk = stash()
  let sent = 0
  let c = client(loadVocab(kitDocs({ brought })), [], {
    url: 'https://example.invalid',
    connect: () => {
      sent++
      throw new Error('page state opened a socket')
    },
    vault: disk,
    wireVault: false,
    fetch: () => {
      sent++
      throw new Error('page state crossed the wire')
    },
  })
  try {
    await c.ready
    await c.mutate([{ entity: { eid: 'toggle' }, Toggle: { open: true } }])
    assertEquals(c.ent('toggle')?.Toggle, { open: true })
    let watch = c.watch('.Toggle', { remote: false })
    assertEquals(watch.value.length, 1)
    watch.close()
    assertEquals(sent, 0)
    assertEquals(await disk.load(), [])
  } finally {
    c.close()
  }
})

test('kit state must be declared, CamelCase and page-only', () => {
  assertThrows(() => external({}), Error, 'CamelCase component')
  assertThrows(
    () =>
      external({
        $defs: {
          toggle: { component: true, sync: 'none', durable: 'connection' },
        },
      }),
    Error,
    'CamelCase',
  )
  assertThrows(
    () =>
      external({
        $defs: { Toggle: words.$defs!.Toggle, work: { rule: true } },
      }),
    Error,
    'not rules',
  )
  assertThrows(
    () => external({ $defs: { Toggle: { component: true } } }),
    Error,
    'sync: none',
  )
  assertThrows(
    () => external({ $defs: { Toggle: { component: true, sync: 'server' } } }),
    Error,
    'sync: none',
  )
  assertThrows(
    () =>
      external({
        $defs: {
          Toggle: { component: true, sync: 'none', durable: 'forever' },
        },
      }),
    Error,
    'page lifetime',
  )
})

test('base facet exposes Edit, Stack and Text with their shared state', () => {
  assertEquals(ux.base, kit)
  assertEquals(Object.keys(kit.components), ['Edit', 'Stack', 'Text'])
  assertEquals(kit.components.Text.state, kit.components.Edit.state)
  let v = loadVocab(kitDocs(ux))
  assertEquals(v.comp('Edit')?.sync, 'none')
  assertEquals(v.comp('Stack')?.durable, 'connection')
  assertEquals(v.comp('Refused')?.durable, '0s')
})

test('base and external specimens draw, Stack emits and keeps its controlled row', async () => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  // Let effects run on the next turn, as on a browser frame.
  let raf = options.requestAnimationFrame
  options.requestAnimationFrame = (f) => setTimeout(f)
  let root = document.querySelector('main')!
  try {
    for (
      let piece of Object.values({
        ...kit.components,
        ...external().components,
      })
    ) {
      for (let [label, node] of piece.specimens()) {
        assertEquals(typeof label, 'string')
        render(node, root)
        await tick()
        if (piece == kit.components.Stack) {
          assertEquals(root.textContent?.includes('Detail pane'), true)
          let strip = root.querySelector('button')!
          strip.click()
          await tick()
          assertEquals(root.textContent?.includes('Detail pane'), false)
          let buttons = root.querySelectorAll('button')
          buttons[buttons.length - 1].click()
          await tick()
          assertEquals(root.textContent?.includes('Detail pane'), true)
        } else {
          assertEquals(!!root.textContent, true)
        }
        render(null, root)
        await tick()
      }
    }
  } finally {
    render(null, root)
    options.requestAnimationFrame = raf
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

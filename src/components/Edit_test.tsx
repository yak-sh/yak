// The in-place editor leaves native text gestures alone once editing —
// and refuses to arm at all over a body it doesn't have.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { cache, config } from '../live.ts'
import { type Change } from '../types.ts'
import { Edit } from './Edit.tsx'

Deno.test('double-click selects words while already editing', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let priorSelection = Object.getOwnPropertyDescriptor(
    globalThis,
    'getSelection',
  )
  let positions = 0
  let { document, window } = parseHTML('<main></main>')
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    getSelection: {
      value: () => ({ setPosition: () => positions++ }),
      configurable: true,
    },
  })
  let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  cache.value = {
    [eid]: {
      entity: { eid, num: 1 },
      doc: { eid, title: 'hello `world`', body: '' },
    },
  }
  let root = document.querySelector('main')!
  try {
    render(
      h(Edit, {
        eid,
        comp: 'doc',
        prop: 'title',
        inline: true,
      }),
      root,
    )
    let edit = root.querySelector('span')!
    assertEquals(edit.innerHTML, 'hello <code>world</code>')
    edit.dispatchEvent(new window.Event('dblclick', { bubbles: true }))
    assertEquals(edit.dataset.was, 'hello `world`')
    assertEquals(edit.textContent, 'hello `world`')

    edit.textContent = 'hello brave world'
    edit.dispatchEvent(new window.Event('dblclick', { bubbles: true }))
    assertEquals(edit.dataset.was, 'hello `world`')
    assertEquals(positions, 1)
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
    if (priorSelection) {
      Object.defineProperty(globalThis, 'getSelection', priorSelection)
    } else delete (globalThis as { getSelection?: unknown }).getSelection
  }
})

// The wire, stubbed: mutate() lands in the cache AND sends, so a test that
// let the socket connect would write to whatever server holds the port.
let sent: Change[] = []
class Socket {
  static OPEN = 1
  readyState = 1
  send(frame: string) {
    // A write travels as {apply, id} — the acked delivery (T-21413); a bare
    // array is any other frame shape.
    let got = JSON.parse(frame) as Change[] | { apply?: Change[] }
    sent.push(...(Array.isArray(got) ? got : got.apply ?? []))
  }
  addEventListener() {}
  close() {}
}

// The bar gesture: double-click the body, type, blur. `body` undefined is a
// doc this client was never shipped a body for; the answer is what the
// editor did — whether it armed, what went out, what the cache holds.
let typeInto = (body: string | undefined, text: string) => {
  let prior = Object.entries({
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    getSelection: Object.getOwnPropertyDescriptor(globalThis, 'getSelection'),
    WebSocket: Object.getOwnPropertyDescriptor(globalThis, 'WebSocket'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
  })
  let { document, window } = parseHTML('<main></main>')
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    getSelection: {
      value: () => ({ setPosition: () => {} }),
      configurable: true,
    },
    WebSocket: { value: Socket, configurable: true },
    // want() must not decide this test: there is no server here.
    fetch: {
      value: () => Promise.reject(new Error('no server')),
      configurable: true,
    },
  })
  // This test names its own dead server; put back whatever the process had,
  // so a sibling file never inherits a host it did not ask for.
  let priorHost = config.host
  config.host = '127.0.0.1:0'
  sent = []
  let eid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  cache.value = {
    [eid]: {
      entity: { eid, num: 1 },
      doc: {
        eid,
        title: 'A document',
        ...(body === undefined ? {} : { body }),
      },
    },
  }
  let root = document.querySelector('main')!
  try {
    render(h(Edit, { eid, comp: 'doc', prop: 'body', multi: true }), root)
    let edit = root.querySelector('span')!
    edit.dispatchEvent(new window.Event('dblclick', { bubbles: true }))
    let armed = !!edit.isContentEditable
    edit.textContent = text
    edit.dispatchEvent(new window.Event('input', { bubbles: true }))
    edit.dispatchEvent(new window.Event('blur', { bubbles: true }))
    return { armed, sent, stored: cache.value[eid]?.doc?.body }
  } finally {
    render(null, root)
    cache.value = {}
    config.host = priorHost
    for (let [name, d] of prior) {
      if (d) Object.defineProperty(globalThis, name, d)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  }
}

Deno.test('an unloaded body refuses the editor and commits nothing', () => {
  let out = typeInto(undefined, 'a fragment')
  assertEquals(out.sent, []) // the whole bar: nothing reached the graph
  assertEquals(out.stored, undefined)
  assertEquals(out.armed, false)
})

Deno.test('a loaded body is still edited, empty or not', () => {
  let out = typeInto('', 'a fragment')
  assertEquals(out.armed, true)
  assertEquals(out.sent, [
    {
      eid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'doc',
      comp: { body: 'a fragment' },
    },
  ])
  assertEquals(out.stored, 'a fragment')
})

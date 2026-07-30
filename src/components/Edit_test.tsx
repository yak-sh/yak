// The in-place editor leaves native text gestures alone once editing.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { cache } from '../live.ts'
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
      doc: { eid, title: 'hello world', body: '' },
    },
  }
  let root = document.querySelector('main')!
  try {
    render(h(Edit, { eid, comp: 'doc', prop: 'title' }), root)
    let edit = root.querySelector('span')!
    edit.dispatchEvent(new window.Event('dblclick', { bubbles: true }))
    assertEquals(edit.dataset.was, 'hello world')

    edit.textContent = 'hello brave world'
    edit.dispatchEvent(new window.Event('dblclick', { bubbles: true }))
    assertEquals(edit.dataset.was, 'hello world')
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

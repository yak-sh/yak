// The Debug inspector exposes every component and gives its editing controls
// the same component vocabulary as its stored rows.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { compTone } from '../comp.ts'

Deno.test('addable components keep their component tones', async () => {
  await import('../Entity.tsx')
  let { AddComp } = await import('./Debug.tsx')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let e = {
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    num: 1,
    kind: 'entity',
    refs: [],
    kids: [],
  }
  try {
    render(h(AddComp, { e }), root)
    root.querySelector<HTMLButtonElement>('.Debug_AddBtn')!.click()
    await Promise.resolve()
    let labels = [...root.querySelectorAll('.Debug_AddItem .Debug_Comp')]
    assertEquals(labels.length > 1, true)
    for (let label of labels) {
      assertEquals(
        label.classList.contains(`Debug_Comp-${compTone(label.textContent!)}`),
        true,
      )
    }
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

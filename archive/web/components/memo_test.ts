// A memo boundary skips parent reconciliation but yields to its own signal.
import { signal } from '@preact/signals'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { assertEquals } from '@std/assert'
import { memo } from './memo.ts'

Deno.test('memo sleeps on equal props and wakes for an owned signal', async () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let value = signal(1)
  let runs = 0
  let Face = memo(({ label }: { label: string }) => {
    runs++
    return h('span', null, `${label}:${value.value}`)
  })
  let root = document.querySelector('main')!
  try {
    render(h(Face, { label: 'a' }), root)
    render(h(Face, { label: 'a' }), root)
    assertEquals(runs, 1)

    value.value = 2
    await Promise.resolve()
    assertEquals(runs, 2)

    render(h(Face, { label: 'b' }), root)
    assertEquals(runs, 3)
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

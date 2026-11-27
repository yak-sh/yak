// A memo boundary skips parent reconciliation but yields to its own signal.
import { test } from '@yaks/testing'
import '../testing.ts'
import { signal } from '@preact/signals-core'
import { createElement as h, memo } from 'react'
import { render } from '@yaks/react/draw'
import { act, useValue } from '@yaks/react/testing'
import { parseHTML } from 'linkedom'
import { assert, assertEquals } from '@std/assert'

let { document } = parseHTML('<main></main>')
let root = document.querySelector('main')!
let value = signal(1)
let runs = 0
let Face = memo(({ label }: { label: string }) => {
  runs++
  return h('span', null, `${label}:${useValue(value)}`)
})
let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', {
  value: document,
  configurable: true,
})
await act(() => render(h(Face, { label: 'a' }), root))

test('memo sleeps on equal props and wakes for an owned signal', async () => {
  try {
    render(h(Face, { label: 'a' }), root)
    assertEquals(runs, 1)

    await act(() => void (value.value = 2))
    assert(runs > 1)
    assertEquals(root.textContent, 'a:2')

    render(h(Face, { label: 'b' }), root)
    assertEquals(root.textContent, 'b:2')
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

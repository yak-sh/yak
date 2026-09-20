// ANSI rendering keeps terminal presentation while refusing terminal control.

import { h, render } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { Ansi, ansiRuns } from './Ansi.tsx'

Deno.test('ANSI runs retain SGR presentation and discard terminal commands', () => {
  assertEquals(
    ansiRuns('plain \x1b[1;31mred\x1b[22;39m ok\x1b[2J!\x1b]0;title\x07'),
    [
      { text: 'plain ', face: {} },
      { text: 'red', face: { bold: true, color: '#e67e80' } },
      { text: ' ok', face: {} },
      { text: '!', face: {} },
    ],
  )
})

Deno.test('ANSI output becomes escaped HTML spans', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    render(h(Ansi, { text: '<b>\x1b[38;2;1;2;3mcolor\x1b[0m' }), root)
    assertEquals(root.querySelector('b'), null)
    assertEquals(root.textContent, '<b>color')
    assertEquals(
      root.querySelector('span')?.style.color,
      'rgb(1, 2, 3)',
    )
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

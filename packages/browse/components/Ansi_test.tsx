// ANSI rendering keeps terminal presentation while refusing terminal control.

import { test } from '@yaks/testing'
import '../testing.ts'
import { h } from 'preact'
import { assertEquals } from '@std/assert'
import { mount } from './mount.ts'
import { Ansi, ansiRuns } from './Ansi.tsx'

test('ANSI runs retain SGR presentation and discard terminal commands', () => {
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

let escaped = mount(h(Ansi, { text: '<b>\x1b[38;2;1;2;3mcolor\x1b[0m' }))

test('ANSI output becomes escaped HTML spans', () => {
  let { root, free } = escaped
  try {
    assertEquals(root.querySelector('b'), null)
    assertEquals(root.textContent, '<b>color')
    assertEquals(
      root.querySelector('span')?.style.color,
      'rgb(1, 2, 3)',
    )
  } finally {
    free()
  }
})

// Plain output must keep the same control-byte boundary as coloured output.
// Every byte plus astral text catches a fast path accidentally passing C0/C1
// controls through, or discarding tabs/newlines and Unicode.
let controls = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i))
  .filter((c) => c != '\x1b').join('') + ' 🙂🦙漢字'
let clean = [...controls].filter((c) =>
  c == '\n' || c == '\t' || (c >= ' ' && c < '\x7f') || c > '\x9f'
).join('')
test('plain ANSI output strips controls while preserving Unicode and whitespace', () => {
  assertEquals(ansiRuns(controls), [{ text: clean, face: {} }])
  assertEquals(ansiRuns(''), [])
  assertEquals(ansiRuns('\x00\x01\x7f\x80'), [])
})

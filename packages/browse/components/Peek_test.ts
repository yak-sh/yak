// The Peek's keys: a field typed into spends its own Escape first.
import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { closes } from './Peek.tsx'

test('Esc and q close a peek, never while typing into a field', () => {
  let cases: [string, boolean, boolean][] = [
    ['Escape', false, true],
    ['q', false, true],
    ['Escape', true, false],
    ['q', true, false],
    ['j', false, false],
  ]
  for (let [key, typing, want] of cases) {
    assertEquals(closes(key, typing), want, `${key} typing=${typing}`)
  }
})

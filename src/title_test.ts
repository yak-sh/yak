// Derived titles say the same words at every display door.
import { assertEquals } from '@std/assert'
import { wakeTitle } from './title.ts'

let NOW = Date.parse('2026-08-10T12:00:00Z')

Deno.test('wake titles derive the recipient and relative clock', () => {
  let e = {
    wake: { at: '2026-08-10T13:00:00Z' },
    deliver: { to: 'project' },
  }
  assertEquals(
    wakeTitle(
      e,
      () => ({ eid: 'project', kind: 'project', num: 19 }),
      NOW,
    ),
    'wake P-19 · in 1 hour',
  )
  assertEquals(
    wakeTitle({ wake: { at: '2026-08-10T11:00:00Z' } }, () => undefined, NOW),
    'wake someone · 1 hour ago',
  )
})

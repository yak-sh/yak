// Derived titles say the same words at every display door.
import { assertEquals } from '@std/assert'
import { wakeList, wakeTitle } from './title.ts'
import { local } from './time.ts'

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

Deno.test('wake lists show every pending clock in time order', () => {
  let refs = [
    { eid: 'session', kind: 'session', num: 31 },
    { eid: 'first-task', kind: 'task', num: 42 },
  ]
  let wakes = [
    {
      eid: 'bbbbbbbb-later',
      kind: 'wake',
      wake: { at: '2026-08-10T14:00:00Z', note: 'check the gate' },
    },
    {
      eid: 'aaaaaaaa-first',
      kind: 'wake',
      wake: { at: '2026-08-10T13:00:00Z', target: 'first-task' },
    },
  ]
  assertEquals(
    wakeList(wakes, refs[0], (eid) => refs.find((r) => r.eid == eid)),
    'pending wakes for S-31 (2):\n' +
      `- aaaaaaaa ${local('2026-08-10T13:00:00Z')} → T-42\n` +
      `- bbbbbbbb ${local('2026-08-10T14:00:00Z')} — check the gate`,
  )
})

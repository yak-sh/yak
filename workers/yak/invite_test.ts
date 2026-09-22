// The inviter's hour (invite.ts `paced`): counted up, started over on a new
// hour, and refused at the cap. The door itself is held in workerd
// (invite_workerd_test.ts).
import { assertEquals, assertThrows } from '@std/assert'
import { CAP, paced } from './invite.ts'

let at = new Date('2026-09-22T15:30:00Z')

Deno.test('an invitation is counted on the hour it goes out in', () => {
  assertEquals(paced(null, at), { hour: '2026-09-22T15', sent: 1 })
  assertEquals(paced({ hour: '2026-09-22T15', sent: 7 }, at).sent, 8)
  assertEquals(paced({ hour: '2026-09-22T14', sent: CAP }, at).sent, 1)
  assertThrows(
    () => paced({ hour: '2026-09-22T15', sent: CAP }, at),
    Error,
    `${CAP} invitations this hour`,
  )
})

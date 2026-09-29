import { assertEquals } from '@std/assert'
import { invitations, memberOf } from './party.ts'
import type { Bundle } from './net.ts'

let now = Date.parse('2026-09-28T12:00:00Z')
let invite = (eid: string, by: string, at = now - 1000): Bundle => ({
  entity: { eid },
  created: { by },
  party_invite: {
    from: 'hero-a',
    to: 'hero-b',
    group: 'hero-a',
    at: new Date(at).toISOString(),
  },
})

Deno.test('only the invited hero sees an unanswered invitation from its sender', () => {
  let rows = [invite('good', 'owner-a'), invite('forged', 'someone-else')]
  let owners = new Map([['hero-a', 'owner-a']])
  assertEquals(
    invitations(rows, [], 'hero-b', now, owners).map((i) => i.eid),
    ['good'],
  )
  assertEquals(invitations(rows, [], 'hero-c', now, owners), [])
  let reply: Bundle = {
    entity: { eid: 'reply' },
    party_reply: { invite: 'good', to: 'hero-b', accept: false },
  }
  assertEquals(invitations(rows, [reply], 'hero-b', now, owners), [])
  assertEquals(
    invitations(
      [invite('old', 'owner-a', now - 25 * 60 * 60_000)],
      [],
      'hero-b',
      now,
      owners,
    ),
    [],
  )
})

Deno.test('a party member has a live location, then a last known land', () => {
  let row: Bundle = {
    entity: { eid: 'hero-a' },
    player: {},
    party: { group: 'hero-a' },
    position: { level: 'mossvale', x: 12, y: 4, z: 18, at: now },
    motion: { yaw: 1, gait: 'run' },
    seen: {
      level: 'birchmere',
      x: 3,
      z: 7,
      yaw: 0,
      at: new Date(now - 60_000).toISOString(),
    },
  }
  let live = memberOf(row, 'Ada', now)
  assertEquals([live.name, live.online, live.level, live.x, live.z], [
    'Ada',
    true,
    'mossvale',
    12,
    18,
  ])
  assertEquals(live.body?.gait, 'run')
  let away = memberOf(
    {
      ...row,
      position: null,
    },
    'Ada',
    now,
  )
  assertEquals([away.online, away.level, away.x, away.z, away.body], [
    false,
    'birchmere',
    3,
    7,
    null,
  ])
})

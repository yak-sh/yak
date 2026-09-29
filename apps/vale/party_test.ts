import { assertEquals } from '@std/assert'
import { groupOf, invitations, memberOf } from './party-state.ts'
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
  let owners = new Map([['hero-a', 'owner-a'], ['hero-b', 'owner-b']])
  assertEquals(
    invitations(rows, [], 'hero-b', now, owners).map((i) => i.eid),
    ['good'],
  )
  assertEquals(invitations(rows, [], 'hero-c', now, owners), [])
  let reply = (by: string): Bundle => ({
    entity: { eid: `reply-${by}` },
    created: { by },
    party_reply: { invite: 'good', to: 'hero-b', accept: false },
  })
  assertEquals(
    invitations(rows, [reply('someone-else')], 'hero-b', now, owners)
      .map((i) => i.eid),
    ['good'],
  )
  assertEquals(invitations(rows, [reply('owner-b')], 'hero-b', now, owners), [])
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

let step = (
  eid: string,
  by: string,
  group: string,
  at: number,
  made = now,
): Bundle => ({
  entity: { eid },
  created: { by, at: new Date(made).toISOString() },
  party_step: { player: 'hero-b', group, at },
})

Deno.test('only the hero owner can change membership', () => {
  let rows = [
    step('join', 'owner-b', 'hero-a', 10),
    step('forged-leave', 'someone-else', '', 100),
    step('forged-join', 'someone-else', 'hero-c', 101),
  ]
  assertEquals(groupOf(rows, 'hero-b', 'owner-b'), 'hero-a')
  assertEquals(groupOf(rows, 'hero-b', 'someone-else'), 'hero-c')
  assertEquals(groupOf(rows, 'hero-c', 'owner-b'), '')
})

Deno.test('latest authored step wins despite arrival order, then leave and rejoin', () => {
  let join = step('join', 'owner-b', 'hero-a', 10, now + 3000)
  let leave = step('leave', 'owner-b', '', 11, now + 2000)
  let rejoin = step('rejoin', 'owner-b', 'hero-a', 12, now + 1000)
  assertEquals(groupOf([join, leave], 'hero-b', 'owner-b'), '')
  assertEquals(groupOf([rejoin, join, leave], 'hero-b', 'owner-b'), 'hero-a')
  assertEquals(groupOf([leave, rejoin, join], 'hero-b', 'owner-b'), 'hero-a')
  let tied = step('zz', 'owner-b', 'hero-c', 12, now + 1000)
  assertEquals(groupOf([tied, rejoin], 'hero-b', 'owner-b'), 'hero-c')
  assertEquals(groupOf([rejoin, tied], 'hero-b', 'owner-b'), 'hero-c')
})

Deno.test('a party member has a live location, then a last known land', () => {
  let row: Bundle = {
    entity: { eid: 'hero-a' },
    player: {},
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

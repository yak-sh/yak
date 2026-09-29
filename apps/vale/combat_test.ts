// A receiver plays every nearby combat visual once, even when several arrive
// in one fight update or the sender's connection starts a new sequence.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type PeerEvent, publish, replay } from './combat.ts'

test('nearby combat events survive a coalesced fight update', () => {
  let now = 10000
  let cast: PeerEvent = {
    type: 'ability',
    id: 'blaze',
    by: 'hero',
    at: [1, 2, 3],
    yaw: 0,
  }
  let shot: PeerEvent = {
    type: 'shot',
    kind: 'bolt',
    from: [1, 2, 3],
    to: [4, 5, 6],
    ms: 300,
  }
  let burst: PeerEvent = {
    type: 'burst',
    id: 'blaze',
    at: [4, 5, 6],
    r: 2,
    ms: 300,
  }
  let hit: PeerEvent = {
    type: 'hit',
    eid: 'creature',
    beast: 'slime',
    at: [4, 5, 6],
    dmg: 7,
    great: true,
  }
  let sent = publish([cast, shot, burst, hit], [], 0, now)
  let first = replay(sent.events, sent.serial, 0, now + 100)
  assertEquals(first.events, [cast, shot, burst, {
    type: 'struck',
    eid: 'creature',
    at: hit.at,
    dmg: 7,
  }])
  assertEquals(
    replay(sent.events, sent.serial, first.seen, now + 200).events,
    [],
  )
  assertEquals(replay(sent.events, sent.serial, 0, now + 3000).events, [])
  let next = publish([cast], [], 0, now + 4000)
  assertEquals(
    replay(next.events, next.serial, first.seen, now + 4100).events,
    [cast],
  )
})

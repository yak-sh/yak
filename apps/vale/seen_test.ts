// A tab that returns after the land grows keeps its hero's saved world spot.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { recall, seenOf, sighting } from './seen.ts'
import type { Bundle, Net } from './net.ts'

test('a tab carries its last seen hero into the larger land', () => {
  let previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  let entries = new Map<string, string>()
  let storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  }
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: storage,
  })
  try {
    let old = {
      entity: { eid: 'hero' },
      seen: {
        level: 'mossvale',
        x: 65,
        z: 68,
        yaw: 1,
        at: '2026-09-27T12:00:00.000Z',
      },
    }
    entries.set('mossvale.seen', JSON.stringify(old))
    assertEquals(recall('hero', null), {
      level: 'mossvale',
      x: 129,
      z: 132,
      yaw: 1,
      at: Date.parse(old.seen.at),
    })
    assertEquals(entries.has('mossvale.seen'), false)
    assertEquals(JSON.parse(entries.get('mossvale.seen.256')!).seen.x, 129)
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'sessionStorage', previous)
    } else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

test('later sightings keep a tab’s teleport acknowledgment', () => {
  let now = 1000
  let kept: Bundle[] = []
  let net = {
    hero: 'hero',
    now: () => now,
    client: {
      ent: () => ({ entity: { eid: 'hero' }, created: { by: 'owner' } }),
    },
    keep: (row: Bundle) => kept.push(row),
    flush: () => {},
  } as unknown as Net
  let seen = sighting(net)
  seen.me({
    person: 'owner',
    name: 'Owner',
    role: null,
    reads: true,
    writes: true,
    signIn: null,
  })
  let frame = (x: number, ack?: string) => ({
    level: 'mossvale',
    down: false,
    teleported: null,
    teleportAck: ack,
    body: { x, y: 5, z: 50, yaw: 0 },
  })
  seen.tick(frame(50, 'move'))
  now += 31_000
  seen.tick(frame(55))
  assertEquals(kept.map((b) => (b.seen as { teleport: string }).teleport), [
    'move',
    'move',
  ])
})

test('a hero returning on another device keeps their saved frontier land', () => {
  let row: Bundle = {
    entity: { eid: 'frontier-hero' },
    seen: {
      level: 'frontier_5_0',
      x: 1408,
      z: 128,
      yaw: 1,
      at: '2026-10-02T03:58:54.076Z',
    },
  }
  let expected = {
    level: 'frontier_5_0',
    x: 1408,
    z: 128,
    yaw: 1,
    at: Date.parse('2026-10-02T03:58:54.076Z'),
  }
  assertEquals(seenOf(row), expected)
  assertEquals(recall(row.entity.eid, seenOf(row)), expected)
  for (let level of ['atlantis', 'frontier_0_0', 'frontier_100000_0']) {
    assertEquals(seenOf({ ...row, seen: { ...row.seen, level } }), null)
  }
})

// A tab that returns after the land grows keeps its hero's saved world spot.
import { assertEquals } from '@std/assert'
import { recall, sighting } from './seen.ts'
import type { Bundle, Net } from './net.ts'

Deno.test('a tab carries its last seen hero into the larger land', () => {
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

Deno.test('later sightings keep a tab’s teleport acknowledgment', () => {
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

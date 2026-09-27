// A tab that returns after the land grows keeps its hero's saved world spot.
import { assertEquals } from '@std/assert'
import { recall } from './seen.ts'

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

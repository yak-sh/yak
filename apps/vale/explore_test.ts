// Walking uncovers the chart for one hero, and the store restores that ground.
import { assertEquals } from '@std/assert'
import { exploration, exploredOf, revealed } from './explore.ts'
import type { Bundle, Me } from './net.ts'

Deno.test('a hero uncovers nearby ground once and keeps it across sessions', () => {
  let previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  let entries = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => entries.set(k, v),
    },
  })
  try {
    let hero = 'one'
    let stored: Bundle[] = []
    let writes: Bundle[] = []
    let net = {
      get hero() {
        return hero
      },
      client: {
        ent: () => ({
          entity: { eid: hero },
          created: { by: 'owner' },
        }),
      },
      mine: () => stored,
      keep: (b: Bundle) => writes.push(b),
      settled: () => true,
    }
    let owner: Me = {
      person: 'owner',
      name: 'Owner',
      reads: true,
      writes: true,
      signIn: null,
    }
    let first = exploration(net)
    first.me(owner)
    first.tick({ body: { x: 41, z: 42 }, down: false })
    first.tick({ body: { x: 59, z: 59 }, down: false })
    assertEquals(writes.length, 1)
    assertEquals(exploredOf(writes[0], hero), [2, 2])
    assertEquals(revealed([50, 50], first.known()), true)
    assertEquals(revealed([110, 110], first.known()), false)

    stored = writes
    writes = []
    entries.clear()
    let again = exploration(net)
    again.me(owner)
    assertEquals(again.known(), [[50, 50]])
    again.tick({ body: { x: 42, z: 43 }, down: false })
    assertEquals(writes.length, 0)

    hero = 'two'
    assertEquals(again.known(), [])
    again.tick({ body: { x: 101, z: 101 }, down: false })
    assertEquals(again.known(), [[110, 110]])
    assertEquals(writes.length, 1)
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'sessionStorage', previous)
    } else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

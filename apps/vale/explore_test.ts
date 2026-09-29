// A hero entering land keeps it uncovered across tabs and sessions.
import { assertEquals } from '@std/assert'
import { exploration, visitedOf } from './explore.ts'
import { regionsFromCells } from './explore-region.ts'
import type { Bundle, Me } from './net.ts'
import { regionOf } from './regions.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

Deno.test('a hero visits whole regions once and keeps them across sessions', () => {
  let previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  let entries = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => entries.set(k, v),
      removeItem: (k: string) => entries.delete(k),
    },
  })
  try {
    let hero = 'one', stored: Bundle[] = [], writes: Bundle[] = []
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
      role: null,
      reads: true,
      writes: true,
      signIn: null,
    }
    let first = exploration(net)
    first.me(owner)
    first.tick({ body: { x: 41, z: 42 }, down: false })
    first.tick({ body: { x: 128, z: 128 }, down: false })
    assertEquals(writes.length, 1)
    assertEquals(visitedOf(writes[0], hero), 'mossvale')
    assertEquals([...first.known()], ['mossvale'])

    stored = writes
    writes = []
    entries.clear()
    let again = exploration(net)
    again.me(owner)
    assertEquals([...again.known()], ['mossvale'])
    again.tick({ body: { x: 190, z: 180 }, down: false })
    assertEquals(writes.length, 0)

    hero = 'two'
    assertEquals([...again.known()], [])
    again.tick({ body: { x: -128, z: 128 }, down: false })
    assertEquals([...again.known()], ['birchmere'])
    assertEquals(visitedOf(writes[0], hero), 'birchmere')

    hero = 'three'
    stored = []
    entries.set(`mossvale.explored.${hero}`, '[[2,2]]')
    let migrated = exploration(net)
    migrated.me(owner)
    assertEquals([...migrated.known()], [...regionsFromCells([[2, 2]])])
    assertEquals(entries.has(`mossvale.explored.${hero}`), false)
    assertEquals(JSON.parse(entries.get(`mossvale.regions.${hero}`)!), [
      ...regionsFromCells([[2, 2]]),
    ])
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

Deno.test('saved cell circles become the regions they touched', () => {
  let cell: [number, number] | null = null
  for (let z = -10; z < 20 && !cell; z++) {
    for (let x = -10; x < 20 && !cell; x++) {
      let cx = (x + 0.5) * 20, cz = (z + 0.5) * 20
      if (regionOf(cx, cz) != regionOf(cx + 26, cz)) cell = [x, z]
    }
  }
  assertEquals(!!cell, true)
  let [x, z] = cell!
  let ids = regionsFromCells([cell!])
  assertEquals(ids.has(regionOf((x + 0.5) * 20, (z + 0.5) * 20)), true)
  assertEquals(ids.has(regionOf((x + 0.5) * 20 + 26, (z + 0.5) * 20)), true)
})

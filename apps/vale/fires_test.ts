import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { destination, fires } from './fires.ts'
import { hearthOf } from './terrain.ts'
import type { Bundle, Me } from './net.ts'
import words from './vocab.json' with { type: 'json' }

test('two visits write one fire discovery', async () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab })
  let visit = (eid: string) =>
    g.apply([{
      entity: { eid },
      fire: { player: 'hero', village: 'mossvale' },
    }])
  let first = await visit('$first')
  let second = await visit('$later')
  assertEquals(first[0].entity.eid, second[0].entity.eid)
  assertEquals((await g.read('.fire')).length, 1)
})

test('travel needs a known destination and a village fire underfoot', () => {
  let home = hearthOf('mossvale')!
  let known = new Set(['mossvale', 'birchmere'])
  assertEquals(destination(...home, known, 'birchmere')?.level, 'birchmere')
  assertEquals(destination(...home, known, 'mossvale'), null)
  assertEquals(destination(...home, known, 'glowcap'), null)
  assertEquals(destination(home[0] + 20, home[1], known, 'birchmere'), null)
})

test('a fire discovery belongs to its hero and survives a tab reload', () => {
  let previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  let entries = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    },
  })
  try {
    let hero = 'hero', rows: Bundle[] = [], writes: Bundle[] = []
    let net = {
      get hero() {
        return hero
      },
      client: {
        ent: (id: string) => ({
          entity: { eid: id },
          created: { by: 'person' },
        }),
      },
      mine: (_name: string) => rows,
      keep: (...bundles: Bundle[]) => writes.push(...bundles),
    }
    let me: Me = {
      person: 'person',
      name: 'Person',
      role: null,
      reads: true,
      writes: true,
      signIn: null,
    }
    let home = hearthOf('mossvale')!
    let at = { body: { x: home[0], z: home[1] }, down: false }
    let found = fires(net)
    found.me(me)
    assertEquals(found.tick(at)?.level, 'mossvale')
    assertEquals(found.tick(at), null)
    assertEquals(writes.length, 1)
    assertEquals(writes[0].fire, { player: hero, village: 'mossvale' })
    assertEquals(entries.get(`mossvale.fires.${hero}`), '["mossvale"]')

    // The store may be late or refuse a write. The tab keeps the discovery
    // for another attempt on its next load.
    let reloaded = fires(net)
    reloaded.me(me)
    assertEquals([...reloaded.known()], ['mossvale'])
    reloaded.tick(at)
    assertEquals(writes.length, 2)

    hero = 'guest'
    reloaded.me({ ...me, person: null })
    assertEquals(reloaded.tick(at)?.level, 'mossvale')
    assertEquals([...reloaded.known()], ['mossvale'])
    assertEquals(writes.length, 2)
    assertEquals(entries.get('mossvale.fires.guest'), '["mossvale"]')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

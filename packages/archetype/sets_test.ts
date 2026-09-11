import { derivedEid, sha256 } from '@yaks/graph'
import {
  assertEquals,
  assertNotEquals,
  assertStrictEquals,
  assertThrows,
} from '@std/assert'
import { Archetypes, canonical, eidOf, satisfies, tablesOf } from './mod.ts'

Deno.test('archetype identity is namespaced, bytewise, duplicate/order independent', () => {
  let names = ['\u{10000}', 'z', 'a', '\ue000', 'a']
  assertEquals(canonical(names), ['a', 'z', '\ue000', '\u{10000}'])
  let id = derivedEid('archetype|a,z,\ue000,\u{10000}')
  assertEquals(eidOf(names), id)
  assertEquals(eidOf(names.reverse()), id)
  assertEquals(tablesOf('["z","a"]'), ['a', 'z'])
  assertThrows(() => eidOf(['a|b']))
  assertThrows(() => eidOf(['a,b']))
  assertThrows(() => tablesOf('[1]'))
  for (let tables of [[], ['doc'], ['doc', 'task']]) {
    let eid = eidOf(tables)
    assertEquals(eid, new Archetypes().intern(tables).eid)
    // UUID vs full hex is a disjoint address space, not merely a different hash
    // preimage: even a blob containing our exact sentence cannot collide.
    assertEquals(eid.length, 36)
    for (let text of ['', tables.join('|'), 'archetype|' + tables.join(',')]) {
      assertNotEquals(eid, sha256(text))
      assertEquals(sha256(text).length, 64)
    }
  }
})

Deno.test('archetype transitions and presence answers are cached and invalidate on new sets', () => {
  let cache = new Archetypes()
  let a = cache.intern(['doc'])
  let b = cache.move(a, 'task', true)
  assertStrictEquals(cache.move(a, 'task', true), b)
  assertStrictEquals(cache.move(b, 'task', false), a)
  assertStrictEquals(cache.move(a, 'task', false), a)
  assertEquals(satisfies({ all: ['doc'], none: ['task'] }, a), true)
  assertEquals(satisfies({ all: ['doc'], none: ['task'] }, b), false)
  let p = { all: ['task'] }
  let first = cache.matching(p)
  assertStrictEquals(cache.matching(p), first)
  let c = cache.intern(['task'])
  assertEquals(cache.matching(p), [b.eid, c.eid])
  assertEquals(new Archetypes().intern(['task', 'doc']).eid, b.eid)
})

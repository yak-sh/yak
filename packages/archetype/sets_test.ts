import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert'
import { Archetypes, canonical, eidOf, satisfies, tablesOf } from './mod.ts'

Deno.test('archetype identity is full SHA-256, bytewise, duplicate/order independent', async () => {
  let names = ['\u{10000}', 'z', 'a', '\ue000', 'a']
  assertEquals(canonical(names), ['a', 'z', '\ue000', '\u{10000}'])
  let digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('a|z|\ue000|\u{10000}'),
  )
  let hex = [...new Uint8Array(digest)].map((n) =>
    n.toString(16).padStart(2, '0')
  ).join('')
  assertEquals(eidOf(names), hex)
  assertEquals(eidOf(names.reverse()), hex)
  assertEquals(tablesOf('["z","a"]'), ['a', 'z'])
  assertThrows(() => eidOf(['a|b']))
  assertThrows(() => tablesOf('[1]'))
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

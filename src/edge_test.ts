// The edge identity derivation and the transition table (D-23820, T-23825).
import { assertEquals, assertMatch, assertNotEquals } from '@std/assert'
import { edgeEid, natureOf, natures, typeOf } from './edge.ts'
import { comps, edges } from './types.ts'

let UUID8 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

Deno.test('edgeEid: one sentence, one uuid; direction and nature distinguish', () => {
  let a = edgeEid('a', 'requires', 'b')
  assertMatch(a, UUID8)
  assertEquals(a, edgeEid('a', 'requires', 'b'))
  assertNotEquals(a, edgeEid('b', 'requires', 'a'))
  assertNotEquals(a, edgeEid('a', 'contains', 'b'))
})

Deno.test('natureOf: every edge type but recalled, present tense, each a comp', () => {
  assertEquals(
    Object.keys(natureOf).sort(),
    edges.filter((t) => t != 'recalled').sort(),
  )
  assertEquals(natureOf.referenced, 'references')
  assertEquals(natureOf.requires, 'requires')
  for (let n of natures) {
    assertEquals(n in comps, true, `${n} is not a comp`)
    assertEquals(natureOf[typeOf[n]], n)
  }
})

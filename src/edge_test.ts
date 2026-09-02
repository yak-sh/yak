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

// The cross-language vector: the kernel derives the same eid in Rust
// (crates/yak-kernel/src/edge.rs, edge_eid_matches_ts_byte_for_byte pins this
// exact table), so a sentence names ONE entity whichever door writes it.
Deno.test('edgeEid: the derivation both languages pin', () => {
  let cases: [string, string, string, string][] = [
    ['a', 'requires', 'b', '07c39ec4-e16c-8322-ad59-44178f02e45a'],
    ['b', 'requires', 'a', 'd5e0b374-7e61-80dc-97e3-9975c5353a45'],
    ['a', 'contains', 'b', '1a0f3522-3bdb-8223-b79f-a80f68f86241'],
    ['', 'requires', '', '79add936-c3db-860a-8061-ecf44caa8d79'],
    [
      'bbbbbbbb-0000-4000-8000-000000000011',
      'requires',
      'bbbbbbbb-0000-4000-8000-000000000004',
      '72e9e7c7-0650-83d4-af97-c1475d68d378',
    ],
    [
      'bbbbbbbb-0000-4000-8000-000000000002',
      'worked',
      'bbbbbbbb-0000-4000-8000-000000000011',
      '9fa90ea2-3890-8f93-a191-605763815652',
    ],
    [
      'bbbbbbbb-0000-4000-8000-000000000011',
      'references',
      'bbbbbbbb-0000-4000-8000-000000000004',
      'b6c37328-373f-8296-a188-41798035cf04',
    ],
    [
      'bbbbbbbb-0000-4000-8000-000000000011',
      'recalled',
      'bbbbbbbb-0000-4000-8000-000000000004',
      '7219d40a-50fa-8c47-ac83-80f568377fe8',
    ],
  ]
  for (let [from, nature, to, want] of cases) {
    assertEquals(edgeEid(from, nature, to), want, `${from}|${nature}|${to}`)
  }
})

Deno.test('natureOf: every edge type, present tense but the event, each a comp', () => {
  assertEquals(Object.keys(natureOf).sort(), [...edges].sort())
  assertEquals(natureOf.referenced, 'references')
  assertEquals(natureOf.requires, 'requires')
  // The one nature that is an event, so the one that stays past tense.
  assertEquals(natureOf.recalled, 'recalled')
  for (let n of natures) {
    assertEquals(n in comps, true, `${n} is not a comp`)
    assertEquals(natureOf[typeOf[n]], n)
  }
})

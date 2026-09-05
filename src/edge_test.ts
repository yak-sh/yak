// The edge identity derivation and the transition table (D-23820, T-23825).
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from '@std/assert'
import {
  edgeEid,
  link,
  moves,
  natureOf,
  natures,
  typeOf,
  unlink,
} from './edge.ts'
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

// The derivation is pinned to this exact table, so a sentence names ONE
// entity whichever door writes it.
Deno.test('edgeEid: the pinned derivation', () => {
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

// The two changes that SAY a sentence, and the reader that takes them back
// apart — the seam every consumer of the wire now goes through.
Deno.test('link/unlink: the entity is the sentence, both halves or neither', () => {
  let said = edgeEid('a', 'references', 'b')
  assertEquals(link('a', 'referenced', 'b'), [
    { eid: said, name: 'edge', comp: { from: 'a', to: 'b' } },
    { eid: said, name: 'references', comp: {} },
  ])
  // ord is patch-shaped: naming it sets the listing order, omitting it leaves
  // the stored one alone.
  assertEquals(link('a', 'referenced', 'b', 3)[0].comp, {
    from: 'a',
    to: 'b',
    ord: 3,
  })
  // An unlink takes the comps, never the spine: the eid IS the sentence, so a
  // grave would make it unsayable forever.
  assertEquals(unlink('a', 'referenced', 'b'), [
    { eid: said, name: 'references', comp: null },
    { eid: said, name: 'edge', comp: null },
  ])
  // The recalling edge is the one that is an EVENT, so it carries a clock.
  assertMatch(String(link('e', 'recalled', 'm')[1].comp?.at), /^20\d\d-/)
  assertThrows(() => link('a', 'blocks', 'b'), Error, 'unknown edge type')
})

Deno.test('moves: a batch read back as the sentences it says and unsays', () => {
  let said = edgeEid('a', 'requires', 'b')
  assertEquals(moves(link('a', 'requires', 'b')), [{
    dep: { parent: 'a', type: 'requires', child: 'b' },
    gone: false,
  }])
  // An unlink names only the eid, so whoever HELD the sentence answers.
  let held = (eid: string) =>
    eid == said
      ? { parent: 'a', type: 'requires' as const, child: 'b' }
      : undefined
  assertEquals(moves(unlink('a', 'requires', 'b'), held), [{
    dep: { parent: 'a', type: 'requires', child: 'b' },
    gone: true,
  }])
  // Without a holder there is nothing to name, so the loss is silent rather
  // than a sentence with a hole in it.
  assertEquals(moves(unlink('a', 'requires', 'b')), [])
  // A tag written beside a stored sentence is that sentence, said again.
  assertEquals(moves([{ eid: said, name: 'requires', comp: {} }], held), [{
    dep: { parent: 'a', type: 'requires', child: 'b' },
    gone: false,
  }])
  // Order decides: a stream that mints an edge and then reaps it is a LOSS.
  assertEquals(
    moves([
      ...link('a', 'requires', 'b'),
      { eid: said, name: 'entity', comp: null },
    ]),
    [{ dep: { parent: 'a', type: 'requires', child: 'b' }, gone: true }],
  )
  // An ordinary entity's death is not an edge move.
  assertEquals(moves([{ eid: 'x', name: 'entity', comp: null }]), [])
})

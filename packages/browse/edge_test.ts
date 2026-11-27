// The edge identity derivation and the transition table (D-23820, T-23825).
import { test } from '@yaks/testing'
import { edgeEid as storedEid } from '@yaks/edge'
import './testing.ts'
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from '@std/assert'
import {
  cameraEid,
  cursorEid,
  edgeEid,
  link,
  moves,
  natureOf,
  typeOf,
  unlink,
} from './edge.ts'
import { comps, edges, vocab } from './types.ts'

let UUID8 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('edgeEid: one sentence, one uuid; direction and nature distinguish', () => {
  let a = edgeEid('a', 'requires', 'b')
  assertMatch(a, UUID8)
  assertEquals(a, edgeEid('a', 'requires', 'b'))
  assertNotEquals(a, edgeEid('b', 'requires', 'a'))
  assertNotEquals(a, edgeEid('a', 'contains', 'b'))
})

test('browser edges use the vocabulary identity when deriving their eid', () => {
  for (
    let nature of ['requires', 'contains', 'worked', 'references', 'recalled']
  ) {
    let id = vocab.comp(nature)?.id
    assertMatch(id ?? '', /^[\da-f-]{36}$/)
    assertEquals(edgeEid('a', nature, 'b'), storedEid('a', id!, 'b'))
  }
})

test('natureOf: every edge type, present tense but the event, each a comp', () => {
  assertEquals(natureOf('referenced'), 'references')
  assertEquals(natureOf('requires'), 'requires')
  // The one nature that is an event, so the one that stays past tense.
  assertEquals(natureOf('recalled'), 'recalled')
  for (let type of edges) {
    let n = natureOf(type)!
    assertEquals(n in comps, true, `${n} is not a comp`)
    assertEquals(typeOf(n), type)
  }
})

// The two changes that SAY a sentence, and the reader that takes them back
// apart — the seam every consumer of the wire now goes through.
test('link/unlink: the entity is the sentence, both halves or neither', () => {
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

test('moves: a batch read back as the sentences it says and unsays', () => {
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

test('client singleton sentences have stable, distinct UUID8 identities', () => {
  assertEquals(cameraEid('a', 'b'), 'f8ed5a9a-5e24-8055-88d4-27e39fdc4bbd')
  assertEquals(cursorEid('a'), '2a752f2b-add0-8957-9f0d-710fadcfc6c6')
  assertMatch(cameraEid('a', 'b'), UUID8)
  assertMatch(cursorEid('a'), UUID8)
  assertNotEquals(cameraEid('a', 'b'), cameraEid('b', 'a'))
  assertNotEquals(cameraEid('a', 'b'), cameraEid('a', 'c'))
  assertNotEquals(cursorEid('a'), cursorEid('b'))
  assertNotEquals(cameraEid('a', 'b'), cursorEid('a'))
  assertNotEquals(cameraEid('a', 'b'), edgeEid('a', 'camera', 'b'))
})

// Admission's three answers: drop, refuse, or let through — one test per rule,
// because which mistakes are loud is the whole design of this phase.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { admit, Refused } from './admit.ts'
import { formed as shaped } from './bundle.ts'
import { formed } from './mod.ts'
import { loadVocab } from '@yaks/vocab'
import { books } from './testing.ts'

let one = (b: Record<string, unknown>, trusted = false) =>
  admit([b as never], books, trusted)

test('the write door validates prune after the shared bundle shape', () => {
  let invalid = [{ entity: { eid: 'orphan' }, $prune: true, doc: {} }]
  assertEquals(shaped(invalid), invalid)
  assertThrows(() => formed(invalid), Refused, '$prune removes only')
  assertEquals(formed([{ entity: { eid: '' }, $prune: true }]), [{
    entity: { eid: '' },
    $prune: true,
  }])
})

test('an unknown component refuses the batch, naming it', () => {
  assertThrows(
    () =>
      one({
        entity: { eid: 'b1' },
        doc: { title: 'Dune' },
        audiobook: { minutes: 400 },
      }),
    Refused,
    'unknown component: audiobook',
  )
})

test('an unknown property on a known component refuses the batch', () => {
  assertThrows(
    () => one({ entity: { eid: 'b1' }, book: { pagez: 3 } }),
    Refused,
    'book.pagez',
  )
})

test('a name every object inherits is still unknown', () => {
  assertThrows(
    () => one({ entity: { eid: 'b1' }, book: { constructor: 3 } }),
    Refused,
    'book.constructor',
  )
  assertThrows(
    () => one({ entity: { eid: 'b1' }, toString: { x: 1 } }),
    Refused,
    'unknown component: toString',
  )
})

test('a server-owned property is refused, and admitted when trusted', () => {
  for (let at of ['now', null]) {
    assertThrows(
      () => one({ entity: { eid: 'b1' }, created: { at }, doc: {} }),
      Refused,
      'created.at is server-owned (stamped); only trusted writers may write it',
    )
    let [ok] = one({ entity: { eid: 'b1' }, created: { at } }, true)
    assertEquals(ok.created, { at })
  }
})

test('an identity copied from a read is the address, and its stamps are dropped', () => {
  let sent = [{ entity: { eid: 'b1', num: 7 }, book: { pages: 3 } }]
  assertEquals(admit(sent, books), [{
    entity: { eid: 'b1' },
    book: { pages: 3 },
  }])
  assertEquals(sent[0].entity.num, 7)
  assertEquals(admit(sent, books, true), sent)
})

test('a bundle of nothing but server-owned properties is refused', () => {
  assertThrows(
    () => one({ entity: { eid: 'b1' }, created: { at: 'now' } }),
    Refused,
    'created.at is server-owned',
  )
})

test('a component sent with only computed properties is still there', () => {
  let tasks = loadVocab({
    $defs: {
      task: {
        component: true,
        type: 'object',
        properties: { status: { type: 'string', computed: true } },
      },
    },
  })
  let sent = { entity: { eid: 't1' }, task: { status: 'open' } }
  assertEquals(admit([sent], tasks, true), [{
    entity: { eid: 't1' },
    task: {},
  }])
  assertEquals(admit([sent], tasks), [{ entity: { eid: 't1' }, task: {} }])
})

test('a bare touch names an entity and asks for nothing', () => {
  assertEquals(one({ entity: { eid: 'b1' } }), [{ entity: { eid: 'b1' } }])
})

test('a value the vocabulary cannot hold refuses the batch', () => {
  assertThrows(
    () => one({ entity: { eid: 'b1' }, book: { status: 'shipped' } }),
    Refused,
    'draft, stocked, sold',
  )
  assertThrows(
    () => one({ entity: { eid: 'b1' }, book: { pages: 'many' } }),
    Refused,
    'book.pages is a number',
  )
})

test('a null component, a null property and a bare tag all pass', () => {
  let [out] = one({
    entity: { eid: 'b1' },
    book: { publisher: null },
    review: null,
    bookmark: {},
  })
  assertEquals(out.book, { publisher: null })
  assertEquals(out.review, null)
  assertEquals(out.bookmark, {})
})

test('a delete does not excuse writing a server-owned property', () => {
  assertThrows(
    () => one({ entity: { eid: 'b1' }, $delete: true, created: { at: 'now' } }),
    Refused,
    'created.at is server-owned',
  )
  let [out] = one({ entity: { eid: 'b1' }, $delete: true })
  assertEquals(out.$delete, true)
})

test('the reserved keys ride through untouched', () => {
  let was = { doc: { title: 'abc' } }
  let [out] = one({ entity: { eid: 'b1' }, doc: { title: 'x' }, $was: was })
  assertEquals(out.$was, was)
})

test('a non-wire component does not silently drop a stamped property', () => {
  let vocab = loadVocab({
    $defs: {
      run: {
        component: true,
        wire: false,
        type: 'object',
        properties: { state: { type: 'string', stamped: true } },
      },
    },
  })
  let sent = [{ entity: { eid: 'r1' }, run: { state: 'done' } }]
  assertThrows(() => admit(sent, vocab), Refused, 'run.state is server-owned')
  assertEquals(admit(sent, vocab, true), sent)
})

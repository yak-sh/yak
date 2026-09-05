// The gather, counted: what a batch asks the storage, and how often.
//
// The unit that matters is not "is the answer right" — the parity script
// already holds every adapter to that — it is HOW MANY CALLS the answer took.
// So every case here runs over a storage that tallies its own doors, and
// asserts the tally.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Plugin, Storage, Tx } from './mod.ts'
import { about, graph } from './mod.ts'
import { books, memory } from './harness.ts'

// The same storage, with every read door counted. A transaction's calls count
// too — they are what `apply()` makes.
let tally = (base: Storage) => {
  let n = { get: 0, read: 0 }
  let watch = (tx: Tx): Tx => ({
    ...tx,
    get: (eids) => {
      n.get++
      return tx.get(eids)
    },
    read: (q, o) => {
      n.read++
      return tx.read(q, o)
    },
  })
  return {
    n,
    storage: {
      ...base,
      read: (q, o) => {
        n.read++
        return base.read(q, o)
      },
      tx: <R>(body: (tx: Tx) => R) => base.tx((tx) => body(watch(tx))),
    } as Storage,
  }
}

// A book, its publisher, a review of it and a bookmark of it — one of every
// death word the fixture declares.
let shelf: Bundle[] = [
  { entity: { eid: 'pub' }, doc: { title: 'Chilton' } },
  { entity: { eid: 'b1' }, book: { pages: 412, publisher: 'pub' } },
  { entity: { eid: 'r1' }, review: { stars: 5, book: 'b1' } },
  { entity: { eid: 'm1' }, bookmark: { of: 'b1' } },
]

Deno.test('a batch reads the storage once, whatever the hooks ask', () => {
  let { n, storage } = tally(memory())
  // A hook that reads every entity in the batch, twice, the way a guard and a
  // journal both would.
  let nosy: Plugin = {
    name: 'nosy',
    wants: (bundles) => [{ eids: bundles.map((b) => b.entity.eid) }],
    hooks: {
      precondition: (bundles, tx) => {
        tx.get(bundles.map((b) => b.entity.eid))
        tx.get(bundles.map((b) => b.entity.eid))
        return bundles
      },
    },
  }
  let g = graph({ storage, vocab: books, plugins: [nosy] })
  g.apply(shelf)
  n.get = 0
  n.read = 0
  g.apply([{ entity: { eid: 'b1' }, book: { pages: 500 } }])
  assertEquals(n, { get: 1, read: 0 })
})

Deno.test('what a wants forgot is read from the storage, and kept', () => {
  let { n, storage } = tally(memory())
  let g = graph({ storage, vocab: books })
  g.apply(shelf)
  let seen: Bundle[] = []
  let forgetful: Plugin = {
    name: 'forgetful',
    // Says nothing about `pub`, and then reads it — twice.
    hooks: {
      precondition: (bundles, tx) => {
        seen = tx.get(['pub']) as Bundle[]
        tx.get(['pub'])
        return bundles
      },
    },
  }
  let h = graph({ storage, vocab: books, plugins: [forgetful] })
  n.get = 0
  h.apply([{ entity: { eid: 'b1' }, book: { pages: 500 } }])
  // One extra call for the miss, and only one: the answer is kept.
  assertEquals(n.get, 2)
  assertEquals((seen[0].doc as { title: string }).title, 'Chilton')
})

Deno.test('about answers backwards, narrowed to the components asked', () => {
  let { n, storage } = tally(memory())
  let g = graph({ storage, vocab: books })
  g.apply(shelf)
  let found: Record<string, string[]> = {}
  let backwards: Plugin = {
    name: 'backwards',
    wants: () => [{ about: ['b1'], comps: ['review', 'bookmark'] }],
    hooks: {
      precondition: (bundles, tx) => {
        let all = about(tx, books, ['b1']) as Bundle[]
        found.wide = all.map((b) => b.entity.eid).sort()
        let some = about(tx, books, ['b1'], ['review']) as Bundle[]
        found.narrow = some.map((b) => b.entity.eid)
        return bundles
      },
    },
  }
  let h = graph({ storage, vocab: books, plugins: [backwards] })
  n.read = 0
  h.apply([{ entity: { eid: 'b1' }, book: { pages: 500 } }])
  assertEquals(found.narrow, ['r1'])
  // The wide ask reaches columns nobody gathered (`book.publisher`,
  // `created.by`) and pays one read for them — the answer is right either way.
  assertEquals(found.wide, ['m1', 'r1'])
  assertEquals(n.read, 2)
})

Deno.test('a hook reads what the hook before it wrote', () => {
  let { storage } = tally(memory())
  let g = graph({ storage, vocab: books })
  g.apply(shelf)
  let read: string | null = null
  let writer: Plugin = {
    name: 'writer',
    wants: () => [{ eids: ['b1'] }, { about: ['b1'], comps: ['review'] }],
    hooks: {
      precondition: (bundles, tx) => {
        tx.patch([
          { entity: { eid: 'b1' }, doc: { title: 'Emma' } },
          { entity: { eid: 'r2' }, review: { stars: 1, book: 'b1' } },
        ])
        return bundles
      },
    },
  }
  let reader: Plugin = {
    name: 'reader',
    hooks: {
      precondition: (bundles, tx) => {
        let [b] = tx.get(['b1']) as Bundle[]
        read = (b.doc as { title: string }).title
        let backs = about(tx, books, ['b1'], ['review']) as Bundle[]
        assertEquals(backs.map((x) => x.entity.eid).sort(), ['r1', 'r2'])
        return bundles
      },
    },
  }
  let h = graph({ storage, vocab: books, plugins: [writer, reader] })
  h.apply([{ entity: { eid: 'b1' }, book: { pages: 500 } }])
  assertEquals(read, 'Emma')
})

Deno.test('a delete reads backwards once per rung, not once per column', () => {
  let { n, storage } = tally(memory())
  let g = graph({ storage, vocab: books })
  g.apply(shelf)
  n.read = 0
  n.get = 0
  let out = g.apply([{ entity: { eid: 'b1' }, $delete: true }]) as Bundle[]
  // The book dies, its review with it, the bookmark's row is released and the
  // publisher is untouched.
  assert(out.some((b) => b.entity.eid == 'r1' && b.tombstone != null))
  assert(out.some((b) => b.entity.eid == 'm1' && b.bookmark === null))
  // One read for the batch's own casualties, one for the frontier the walk
  // turned up. The vocabulary declares four reference columns; the old walk
  // paid a read per column per casualty per death word.
  assertEquals(n.read, 2)
})

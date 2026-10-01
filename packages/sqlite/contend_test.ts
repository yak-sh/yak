// Two connections on one file. While one holds the write lock, the other's
// lookups and opens stay prompt: WAL readers do not wait for its writer.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { archetypeDoc } from '@yaks/archetype'
import { loadVocab, type Vocab } from '@yaks/vocab'
import type { Stmt } from '@yaks/sql'
import { storage } from './mod.ts'
import { open } from './db.ts'
import { shop } from './testing.ts'

// The shop, indexed by archetype, as a live graph is: a query then reads the
// archetype catalog and the entities as one unit.
let indexed = loadVocab([...shop.docs, archetypeDoc])

// This process's store, with a task in it, beside another connection that has
// begun writing and not finished.
let beside = (vocab: Vocab = shop) => {
  let dir = Deno.makeTempDirSync()
  let mine = open(`${dir}/graph.db`)
  let theirs = open(`${dir}/graph.db`)
  let store = storage(mine, vocab)
  store.install()
  store.tx((tx) => tx.patch([{ entity: { eid: 'x' }, doc: { title: 'Hi' } }]))
  theirs.query({ t: 'begin', mode: 'immediate' })
  return {
    store,
    mine,
    [Symbol.dispose]: () => {
      theirs.query({ t: 'rollback' })
      theirs.close()
      mine.close()
      Deno.removeSync(dir, { recursive: true })
    },
  }
}

let prompt = <T>(f: () => T): T => {
  let t = performance.now()
  let out = f()
  let ms = performance.now() - t
  assert(ms < 1000, `waited ${Math.round(ms)}ms on the other writer`)
  return out
}

test('a lookup answers while another process is writing', () => {
  using p = beside()
  let [x] = prompt(() => p.store.get(['x']))
  assertEquals(x.entity.eid, 'x')
})

test('a query answers while another process is writing', () => {
  using p = beside(indexed)
  let found = prompt(() => p.store.read('.doc'))
  assertEquals(found.map((b) => b.entity.eid), ['x'])
})

test('an open beside a writer goes on without it', () => {
  using p = beside()
  prompt(() => storage(p.mine, shop).install())
})

// This process's store, holding x titled Hi, whose reads another connection
// races: it commits x retitled Bye just after a read's first select, the
// moment a read made of several statements would see the commit in pieces.
let racing = (vocab: Vocab) => {
  let dir = Deno.makeTempDirSync()
  let mine = open(`${dir}/graph.db`)
  let theirs = open(`${dir}/graph.db`)
  let armed = false
  let store = storage({
    ...mine,
    query: (s: Stmt) => {
      let out = mine.query(s)
      if (armed && s.t == 'select') {
        armed = false
        storage(theirs, vocab).tx((tx) =>
          tx.patch([{ entity: { eid: 'x' }, doc: { title: 'Bye' } }])
        )
      }
      return out
    },
  }, vocab)
  store.install()
  store.tx((tx) => tx.patch([{ entity: { eid: 'x' }, doc: { title: 'Hi' } }]))
  return {
    read: (q: string) => {
      armed = true
      return store.read(q)
    },
    [Symbol.dispose]: () => {
      theirs.close()
      mine.close()
      Deno.removeSync(dir, { recursive: true })
    },
  }
}

test('a query sees another process’s commit whole or not at all', () => {
  for (let vocab of [shop, indexed]) {
    using p = racing(vocab)
    let found = p.read('.doc.title=Hi')
    assertEquals(found.map((b) => [b.entity.eid, b.doc]), [
      ['x', { title: 'Hi', body: null }],
    ])
  }
})

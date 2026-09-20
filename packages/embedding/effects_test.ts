// The effects facet: which writes are news, and what they wake.

import { assert, assertEquals } from '@std/assert'
import type { Watch } from '@yaks/effects'
import { effects } from './effects.ts'
import { TABLE } from './ddl.ts'
import type { Driver } from './driver.ts'
import { shelf, shop } from './harness.ts'

let now = { embedder: { via: 'hash' }, after: 0 } as const

let count = (db: Driver) =>
  Number(db.query(`select count(*) as n from "${TABLE}"`, [])[0].n)

// The sweep runs on its own after the commit, so a test waits for it the way a
// host does: by looking at the vectors.
let until = async (want: () => boolean) => {
  for (let i = 0; i < 200 && !want(); i++) {
    await new Promise((go) => setTimeout(go, 1))
  }
  assert(want(), 'the sweep never ran')
}

let fire = (w: Watch) => (w.created as () => void)()

Deno.test('one watch per embedded component, over its own columns', () => {
  let watches = effects({ vocab: shop, sql: shelf() }, now)
  assertEquals(watches.map((w) => w.comp), ['book', 'review'])
  assertEquals(Object.keys(watches[0].changed ?? {}), ['title', 'blurb'])
  assertEquals(Object.keys(watches[1].changed ?? {}), ['prose'])
  // a component gone is news too: a vector has to stop being a neighbour
  assert(watches.every((w) => w.created && w.removed))
})

Deno.test('the config chooses which text is watched at all', () => {
  let watches = effects({ vocab: shop, sql: shelf() }, {
    ...now,
    text: ['review.prose'],
  })
  assertEquals(watches.map((w) => w.comp), ['review'])
})

Deno.test('a write wakes the sweep, and the whole corpus is what it reconciles', async () => {
  let db = shelf()
  let watches = effects({ vocab: shop, sql: db }, now)
  assertEquals(count(db), 0)
  fire(watches[0])
  await until(() => count(db) == 4)
})

Deno.test('a burst of writes is one sweep, and it never holds the write open', async () => {
  let db = shelf()
  let [book] = effects({ vocab: shop, sql: db }, { ...now, after: 2 })
  for (let i = 0; i < 5; i++) assertEquals(fire(book), undefined)
  assertEquals(count(db), 0)
  await until(() => count(db) == 4)
})

// A slow, counting embedder, named the way a config names one — which is also
// how a test reaches inside a facet that otherwise only takes JSON.
let counted = (during: (call: number) => void = () => {}) => {
  let calls = 0
  let embedder = {
    via: 'ollama',
    model: 'counted',
    base: 'http://box',
    fetch: async () => {
      during(++calls)
      await new Promise((go) => setTimeout(go, 1))
      return {
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"embeddings":[[1,0,0]]}'),
      }
    },
  } as const
  return { embedder, calls: () => calls }
}

// A write that lands WHILE a pass is asking the model belongs to no pass: the
// one running chose its work before that write existed. So the nudge it fires
// has to survive until the pass is over — and the pass that follows must not
// re-embed what the first one already did.
Deno.test('a nudge mid-pass runs after it, and nothing is embedded twice', async () => {
  let db = shelf()
  let model = counted((call) => {
    if (call != 2) return
    db.exec(`insert into entity (id, eid, num) values (9, 'book-9', 9)`)
    db.query(
      `insert into book (entity, title, blurb, price) values (?, ?, ?, ?)`,
      [9, 'Late', 'A book that arrived mid-sweep.', 5],
    )
    fire(watches[0])
  })
  let watches = effects({ vocab: shop, sql: db }, {
    after: 0,
    embedder: model.embedder,
  })
  fire(watches[0])
  await until(() => count(db) == 5)
  assertEquals(model.calls(), 5, 'one call per entity, not one per nudge')
})

Deno.test('an embedder that cannot be reached leaves the vectors stale, not the write broken', async () => {
  let db = shelf()
  let warned: unknown[] = []
  let warn = console.warn
  console.warn = (...said: unknown[]) => warned.push(said[1])
  try {
    let [book] = effects({ vocab: shop, sql: db }, {
      ...now,
      embedder: { via: 'ollama', model: 'gone', base: 'http://0.0.0.0:1' },
    })
    fire(book)
    await until(() => warned.length > 0)
  } finally {
    console.warn = warn
  }
  assertEquals(count(db), 0)
})

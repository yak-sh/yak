// Shared test fixtures (not part of the published package — see deno.json): a
// blog, written as a vocabulary. A post has a short title kept in the row and a
// long body kept in the blob store, which is the whole distinction this package
// exists to make.
//
// The store is @yaks/sqlite over an in-memory database, which is how an
// application composes this package: the adapter owns the rows, the graph owns
// the rules, this package moves the long values out of the way.

import { Database } from '@db/sqlite'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph } from '@yaks/graph'
import { storage, type Store } from '@yaks/sqlite'
import type { Driver } from './driver.ts'
import { blobKeywords } from './keywords.ts'
import { blobRead, blobSchema, sqliteBlobs } from './sqlite.ts'
import { blobs } from './plugin.ts'
import type { Blobs } from './store.ts'

/** A Driver over a fresh in-memory database. */
export let mem = (): Driver => {
  let db = new Database(':memory:')
  db.exec('pragma foreign_keys = on')
  return {
    query: (sql, params) => db.prepare(sql).all(...params),
    exec: (sql) => db.exec(sql),
  }
}

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    post: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string', store: 'blob' },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    person: { type: 'object', kind: true, properties: { name: {} } },
    // a component with no body column at all, to prove the swap is per column
    tag: { type: 'object', properties: { label: { type: 'string' } } },
  },
}

/** The blog vocabulary, loaded with the `store` keyword registered. */
export let blog: Vocab = loadVocab(doc, [blobKeywords])

/** The same vocabulary with the keyword NOT registered — what a loader that
 * never heard of this package sees. */
export let plain: Vocab = loadVocab(doc)

/** A graph over an in-memory database with the blob plugin installed, plus the
 * pieces a test wants to poke at directly. */
export let fixture = (
  store?: Blobs,
): { g: Graph; db: Store; driver: Driver; blobs: Blobs } => {
  let driver = mem()
  let bytes = store ?? sqliteBlobs(driver)
  let db = storage(driver, blog, { derived: blobRead(blog) })
  for (let stmt of [...db.ddl(), ...blobSchema()]) driver.exec(stmt)
  return {
    driver,
    db,
    blobs: bytes,
    g: graph({ storage: db, vocab: blog, plugins: [blobs(blog, bytes)] }),
  }
}

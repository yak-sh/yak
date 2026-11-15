import { statements } from '@yaks/sqlite'
// Shared test fixtures (not part of the published package — see deno.json): a
// blog, written as a vocabulary. A post has a short title kept in the row and a
// long body kept in the blob store, which is the whole distinction this package
// exists to make.
//
// Storage is @yaks/sqlite over an in-memory database, which is how an
// application composes this package: the adapter owns the rows, the graph owns
// the rules, and this package moves the long values out of the way.

import { open } from '@yaks/sqlite/db'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph } from '@yaks/graph'
import { storage, type Store } from '@yaks/sqlite'
import type { Driver } from '@yaks/sql'
import { blobKeywords } from './keywords.ts'
import { blobRead, blobSchema, sqliteBlobs } from './sqlite.ts'
import { blobs } from './plugin.ts'
import type { Blobs } from './store.ts'
import type { Bucket } from './object.ts'

/** A Driver over a fresh in-memory database. */
export let mem = (): Driver => open(':memory:')

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    post: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string', search: true },
        body: { type: 'string', store: 'blob', search: true },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: { type: 'string' } },
    },
    // a component with no body property at all, to prove the substitution is
    // made per property
    tag: {
      component: true,
      type: 'object',
      properties: { label: { type: 'string' } },
    },
  },
}

/** The blog vocabulary, loaded with the `store` keyword registered. */
export let blog: Vocab = loadVocab(doc, [blobKeywords])

/** The same vocabulary with the keyword not registered — what a loader that
 * never heard of this package sees. */
export let plain: Vocab = loadVocab(doc)

/** A graph over an in-memory database with the blob plugin installed, plus the
 * pieces a test wants to poke at directly. */
export let fixture = (
  store?: Blobs,
): { g: Graph; db: Store; driver: Driver; blobs: Blobs } => {
  let driver = mem()
  let bytes = store ?? sqliteBlobs(statements(driver))
  let db = storage(driver, blog, { derived: blobRead(blog) })
  for (let stmt of [...db.ddl(), ...blobSchema()]) driver.query(stmt)
  return {
    driver,
    db,
    blobs: bytes,
    g: graph({ storage: db, vocab: blog, plugins: [blobs(blog, bytes)] }),
  }
}

// These doors pass bytes, not HTTP metadata.
let stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

/** A bucket in this process's memory, its objects in `held`, each landing a
 * tick after the one before. */
export let memoryBucket = (): {
  bucket: Bucket
  held: Map<string, Uint8Array>
} => {
  let held = new Map<string, Uint8Array>()
  let at = new Map<string, number>()
  let clock = 0
  let now = <T>(v: T) => Promise.resolve(v)
  let bucket: Bucket = {
    head: (key) =>
      now(held.has(key) ? { size: held.get(key)!.length, etag: 'v' } : null),
    get: (key, options) => {
      let bytes = held.get(key)
      if (!bytes) return now(null)
      let from = options?.range.offset ?? 0
      let part = bytes.slice(
        from,
        options ? from + options.range.length : undefined,
      )
      return now({
        etag: 'v',
        body: stream(part),
        arrayBuffer: () => now(part.buffer),
      })
    },
    put: (key, value) => {
      held.set(key, new Uint8Array(value as Uint8Array))
      return now(at.set(key, ++clock))
    },
    delete: (keys) => now([keys].flat().forEach((key) => held.delete(key))),
    list: ({ prefix }) =>
      now({
        truncated: false,
        objects: [...held].filter(([key]) => key.startsWith(prefix))
          .map(([key, bytes]) => ({
            key,
            size: bytes.length,
            uploaded: new Date(at.get(key)!),
          })),
      }),
  }
  return { bucket, held }
}

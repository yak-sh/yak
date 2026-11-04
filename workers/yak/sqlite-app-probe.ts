// The app's wire over SQLite, without a Durable Object or its duties. Schema,
// blob substitution, personal scope and FTS are the same package interfaces
// the Store composes; the query door is its production appRead seam.
import { blobRead, blobs, blobSchema, sqliteBlobs } from '@yaks/blob'
import { fields, find, schema as ftsSchema, screens, search } from '@yaks/fts'
import { type Graph, graph, type ReadOpts } from '@yaks/graph'
import { personal } from '@yaks/member'
import { storage } from '@yaks/sqlite'
import { cleanup } from '@yaks/testing'
import type { Vocab } from '@yaks/vocab'
import { preparedDriver, snapshot } from '../../packages/sqlite/testing.ts'
import { appDerived } from './vocab.ts'
import type { Driver } from '@yaks/sql'
import type { Snapshot } from '../../packages/sqlite/testing.ts'

/** Each named app gets private bytes and the vocabulary's read/search shape. */
export let sqliteApp = (
  using: (dispose: () => void) => unknown = cleanup,
  open: (from: Snapshot) => Driver & Disposable = preparedDriver,
) => {
  let drivers = new WeakMap<Graph, Driver & Disposable>()
  let initial: (Driver & Disposable) | undefined
  let adopt = (driver: Driver & Disposable) => {
    if (initial) throw new Error('SQLite graph already has initial storage')
    initial = driver
    using(() => driver[Symbol.dispose]())
  }
  let make = (
    vocab: Vocab,
    previous?: Graph,
    prepare?: (driver: Driver) => void,
  ) => {
    let bodies = blobRead(vocab)
    let derived = { ...bodies, ...appDerived(vocab, bodies) }
    let searchable = fields(vocab)
    let extra = [...blobSchema(), ...ftsSchema(searchable, bodies)]
    let driver = previous && drivers.get(previous)
    if (!driver) {
      if (initial) {
        driver = initial
        initial = undefined
      } else {
        driver = open(snapshot(vocab, { derived }, extra))
        let owned = driver
        using(() => owned[Symbol.dispose]())
      }
    }
    prepare?.(driver)
    let rows = storage(driver, vocab, {
      derived,
      extend: [search(searchable, driver)],
      schemaReady: () => true,
    })
    if (previous || prepare) {
      let [failure] = rows.install(extra)
      if (failure) throw failure
    }
    let g = graph({
      vocab,
      storage: rows,
      plugins: [
        blobs(vocab, sqliteBlobs(driver)),
        personal(vocab, {}, { document_page: 'document' }),
      ],
    })
    drivers.set(g, driver)
    return g
  }
  let found = (g: Graph, text: string, opts: ReadOpts, limit: number) => {
    let searchable = fields(g.vocab)
    return find(drivers.get(g)!, searchable, text, {
      limit,
      screens: screens(searchable, g.vocab, g.scope(opts)),
    })
  }
  let atomic = <T>(g: Graph, run: () => T) => g.storage.tx(() => run())
  return { graph: make, found, atomic, adopt }
}

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

/** Each named app gets private bytes and the vocabulary's read/search shape. */
export let sqliteApp = () => {
  let drivers = new WeakMap<Graph, ReturnType<typeof preparedDriver>>()
  let make = (vocab: Vocab) => {
    let bodies = blobRead(vocab)
    let derived = { ...bodies, ...appDerived(vocab, bodies) }
    let searchable = fields(vocab)
    let driver = preparedDriver(snapshot(vocab, { derived }, [
      ...blobSchema(),
      ...ftsSchema(searchable, bodies),
    ]))
    cleanup(() => driver[Symbol.dispose]())
    let g = graph({
      vocab,
      storage: storage(driver, vocab, {
        derived,
        extend: [search(searchable, driver)],
        schemaReady: () => true,
      }),
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
  return { graph: make, found }
}

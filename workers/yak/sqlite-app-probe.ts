// The app's wire over SQLite, without a Durable Object or its duties. Schema,
// blob substitution, personal scope and FTS are the same package interfaces
// the Store composes; the query door is its production appRead seam.
import { blobRead, blobs, blobSchema, sqliteBlobs } from '@yaks/blob'
import { find, indexed, schema as ftsSchema, search } from '@yaks/fts'
import { type Graph, graph, type ReadOpts } from '@yaks/graph'
import { personal } from '@yaks/member'
import { aliases } from '@yaks/alias'
import { keys } from '@yaks/key'
import { storage } from '@yaks/sqlite'
import { cleanup } from '@yaks/testing'
import type { Vocab } from '@yaks/vocab'
import { preparedDriver, snapshot } from '../../packages/sqlite/testing.ts'
import { appDerived } from './vocab.ts'
import type { Driver } from '@yaks/sql'
import type { Snapshot } from '../../packages/sqlite/testing.ts'

// A loaded vocabulary is immutable. Share its pure read/schema data while
// every host still opens its own snapshot and supplies its own graph plugins.
let shapes = new WeakMap<Vocab, ReturnType<typeof shape>>()
let shape = (vocab: Vocab) => {
  let bodies = blobRead(vocab)
  let derived = { ...bodies, ...appDerived(vocab, bodies) }
  let searchable = indexed(vocab)
  let extra = [...blobSchema(), ...ftsSchema(searchable, bodies)]
  let image: Snapshot | undefined
  return {
    derived,
    searchable,
    extra,
    snapshot: () => image ??= snapshot(vocab, { derived }, extra),
  }
}
let shapeOf = (vocab: Vocab) => {
  let held = shapes.get(vocab)
  if (!held) shapes.set(vocab, held = shape(vocab))
  return held
}

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
    reset = false,
  ) => {
    let held = shapeOf(vocab)
    let { derived, searchable, extra } = held
    // An adopted driver comes first: a store emptied under its previous one
    // is planted through a new one, whose caches have seen nothing.
    let driver = initial ?? (previous && drivers.get(previous))
    initial = undefined
    if (!driver) {
      let owned = driver = open(held.snapshot())
      using(() => owned[Symbol.dispose]())
    }
    prepare?.(driver)
    let rows = storage(driver, vocab, {
      derived,
      extend: [search(searchable, driver)],
      schemaReady: () => true,
    })
    if ((previous && (previous.vocab !== vocab || reset)) || prepare) {
      let [failure] = rows.install(extra)
      if (failure) throw failure
    }
    let g = graph({
      vocab,
      storage: rows,
      plugins: [
        keys(vocab),
        aliases(),
        blobs(vocab, sqliteBlobs(rows.statements)),
        personal(vocab, {}, { document_page: 'document' }),
      ],
    })
    drivers.set(g, driver)
    return g
  }
  let found = (g: Graph, text: string, opts: ReadOpts, limit: number) => {
    let { searchable } = shapeOf(g.vocab)
    return find(drivers.get(g)!, searchable, text, {
      limit,
      vocab: g.vocab,
      scope: g.scope(opts),
    })
  }
  let atomic = <T>(g: Graph, run: () => T) => g.storage.tx(() => run())
  return { graph: make, found, atomic, adopt }
}

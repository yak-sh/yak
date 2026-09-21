// Shared test fixtures (not part of the published package — see deno.json): a
// library, as a vocabulary. Books, and two kinds of value identifying a book or
// a person: an `isbn`, declared the plain way, and an `email` declared as
// `mailbox`, so the tests also cover a vocabulary where the component written
// and the kind queries name differ.
//
// Storage is @yaks/sqlite over an in-memory database, which is how an
// application composes this package: the adapter owns the bytes, the graph owns
// the rules, and this package brings the key.

import { Database } from '@yaks/sqlite/db'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { type Driver, storage } from '@yaks/sqlite'
import { keyDoc } from './comp.ts'
import { keyKeywords } from './keywords.ts'
import { keys } from './plugin.ts'

// A Driver over a fresh in-memory database.
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
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    book: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      properties: {},
    },
    // A book's isbn. The component's own name is the kind.
    isbn: {
      component: true,
      type: 'object',
      key: true,
    },
    // A person's address — the component is `email`, the kind is `mailbox`.
    email: {
      component: true,
      type: 'object',
      key: 'mailbox',
    },
    // Something that is NOT a kind, so the tests can prove an ordinary
    // component stored beside a key is never mistaken for one.
    pinned: {
      component: true,
      type: 'object',
    },
  },
}

/** The library vocabulary: books, people, two kinds, and the key itself. */
export let library: Vocab = loadVocab([keyDoc, doc], [keyKeywords])

/** A store over a fresh in-memory database with the schema installed. */
export let store = (): Storage => {
  let s = storage(mem(), library)
  s.install()
  return s
}

/** The whole stack: a graph over that store, with the key plugin registered. */
export let libraryGraph = (s: Storage = store()): Graph =>
  graph({ storage: s, vocab: library, plugins: [keys(library)] })

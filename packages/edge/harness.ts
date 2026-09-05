// Shared test fixtures (not part of the published package — see deno.json): a
// blog, written as a vocabulary. Posts, and two relations between them: a post
// CITES another, and a post LINKS to another. `cites` is declared the plain way
// (the component's own name is the relation); `links` is declared as `linked`,
// so the tests also cover a vocabulary whose tag and its reading differ.
//
// The store is @yaks/sqlite over an in-memory database, which is how an
// application composes this package: the adapter owns the bytes, the graph owns
// the rules, and this package brings the edge.

import { Database } from '@db/sqlite'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { type Driver, storage } from '@yaks/sqlite'
import { edgeDoc } from './comp.ts'
import { edgeKeywords } from './keywords.ts'
import { edges } from './plugin.ts'
import { traverse } from './sql.ts'

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
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // What is written: a post on the blog.
    post: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    // A post citing another. The component's own name is the relation.
    cites: { type: 'object', relation: true },
    // A post linking to another — written `links`, read `linked`.
    links: { type: 'object', relation: 'linked' },
    // Something that is NOT a relation, so the tests can prove an ordinary
    // component riding beside an edge is never mistaken for one.
    pinned: { type: 'object' },
  },
}

/** The blog vocabulary: posts, two relations, and the edge itself. */
export let blog: Vocab = loadVocab([edgeDoc, doc], [edgeKeywords])

/** A store over a fresh in-memory database with the schema installed. */
export let store = (): Storage => {
  let s = storage(mem(), blog, { extend: [traverse(blog)] })
  s.install()
  return s
}

/** The whole stack: a graph over that store, with the edge plugin registered. */
export let blogGraph = (s: Storage = store()): Graph =>
  graph({ storage: s, vocab: blog, plugins: [edges(blog)] })

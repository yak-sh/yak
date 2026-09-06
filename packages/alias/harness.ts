// Shared test fixtures (not part of the published package — see deno.json): a
// cookbook, written as a vocabulary. Recipes and comments, the carrier from
// @yaks/key, and the `alias` kind this package declares.
//
// The store is @yaks/sqlite over an in-memory database, which is how an
// application composes this package: the adapter owns the bytes, the graph owns
// the rules, @yaks/key brings the carrier, and this package brings the name.

import { Database } from '@db/sqlite'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { type Driver, storage } from '@yaks/sqlite'
import { aliasDoc } from './comp.ts'
import { aliases } from './plugin.ts'

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
    doc: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    recipe: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { serves: { type: 'number' } },
    },
    comment: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        target: { type: 'string', ref: 'entity', death: 'cascade' },
      },
    },
  },
}

/** The cookbook vocabulary: recipes, comments, the key and the name. */
export let cookbook: Vocab = loadVocab([keyDoc, aliasDoc, doc], [keyKeywords])

/** A store over a fresh in-memory database with the schema installed. */
export let store = (): Storage => {
  let s = storage(mem(), cookbook)
  s.install()
  return s
}

/** The whole stack: a graph over that store, with both plugins registered — the
 * carrier first, since the name rides it. */
export let cookbookGraph = (s: Storage = store()): Graph =>
  graph({
    storage: s,
    vocab: cookbook,
    plugins: [keys(cookbook), aliases(cookbook)],
  })

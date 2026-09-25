// Shared test fixtures (not part of the published package — see deno.json): a
// cookbook, written as a vocabulary. Recipes and comments, the `key` component
// from @yaks/key, and the `alias` kind of key this package declares.
//
// The store is @yaks/ram, which is how an application composes this package:
// the adapter owns the bytes, the graph owns the write-time behaviour,
// @yaks/key brings the `key` component, and this package brings the name.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Graph, graph, type Storage } from '@yaks/graph'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { ram } from '@yaks/ram'
import { aliasDoc } from './comp.ts'
import { aliases } from './plugin.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    recipe: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { serves: { type: 'number' } },
    },
    comment: {
      component: true,
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

/** A fresh store in memory. */
export let store = (): Storage => ram(cookbook)

/** The whole stack: a graph over that store, with both plugins registered —
 * @yaks/key first, since an alias is stored as one of its keys. */
export let cookbookGraph = (s: Storage = store()): Graph =>
  graph({
    storage: s,
    vocab: cookbook,
    plugins: [keys(cookbook), aliases()],
  })

// Shared test fixtures (not part of the published package — see deno.json): a
// blog, written as a vocabulary, over @yaks/memory. Posts that get published,
// subscribers who get notified, and comments that exist ABOUT a post — so a
// deleted post takes its comments with it and the cascade's casualties are
// something the tests can watch.

import { type Graph, graph, type Options } from '@yaks/graph'
import { memory } from '@yaks/memory'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { effectDoc } from './durable.ts'

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
        body: { type: 'string' },
        published: { type: 'boolean' },
      },
    },
    // A comment has nothing left to be about once its post is gone.
    comment: {
      type: 'object',
      kind: true,
      properties: {
        text: { type: 'string' },
        post: { type: 'string', ref: 'post', death: 'cascade' },
      },
    },
    subscriber: {
      type: 'object',
      kind: true,
      properties: { email: { type: 'string' } },
    },
    // The provenance @yaks/graph stamps, so the tests see the components a
    // batch grows on its own beside the ones it was given.
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
  },
}

/** The blog vocabulary the tests write against. */
export let blog: Vocab = loadVocab([doc])

/** The same blog, plus the `effect` component the durability tier needs. */
export let durableBlog: Vocab = loadVocab([doc, effectDoc])

/** A graph over a fresh Map, with whatever plugins a test brings. */
export let blogGraph = (
  plugins: Options['plugins'] = [],
  vocab: Vocab = blog,
): Graph => graph({ storage: memory(vocab), vocab, plugins })

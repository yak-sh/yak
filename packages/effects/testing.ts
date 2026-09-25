// Shared test fixtures (not part of the published package — see deno.json): a
// blog, written as a vocabulary, over @yaks/ram. Posts that get published,
// subscribers who get notified, and comments that point at a post — so a
// deleted post takes its comments with it and the cascade's casualties are
// something the tests can watch.

import { type Graph, graph, type Options } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { effectDoc } from './pool.ts'

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
        title: { type: 'string' },
        body: { type: 'string' },
        published: { type: 'boolean' },
      },
    },
    // A comment has nothing left to be about once its post is gone.
    comment: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        text: { type: 'string' },
        post: { type: 'string', ref: 'post', death: 'cascade' },
      },
    },
    subscriber: {
      component: true,
      type: 'object',
      kind: true,
      properties: { email: { type: 'string' } },
    },
    // The provenance @yaks/graph stamps, so the tests see the components a
    // batch gains on its own beside the ones it was given.
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    updated: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
  },
}

/** The blog vocabulary the tests write against. */
export let blog: Vocab = loadVocab([doc])

/** What the blog owes after a commit: a note for every post, and one more
 * whenever a post is published. */
export let owes: VocabDoc = {
  $defs: {
    post_note: {
      effect: true,
      created: ['post'],
      changed: ['post.published'],
      tries: 2,
    },
    post_gone: { effect: true, removed: ['post'], idempotent: false },
    post_swept: { effect: true, created: ['post'], sweep: '.post' },
  },
}

/** The blog with its effects declared, and the `effect` rows a pool of
 * workers runs them from. */
export let pooledBlog: Vocab = loadVocab([doc, effectDoc, owes])

/** The blog with its effects declared and no pool: a handled effect runs in
 * the process that committed. */
export let owingBlog: Vocab = loadVocab([doc, owes])

/** A graph over a fresh Map, with whatever plugins a test brings. */
export let blogGraph = (
  plugins: Options['plugins'] = [],
  vocab: Vocab = blog,
): Graph => graph({ storage: ram(vocab, { number: true }), vocab, plugins })

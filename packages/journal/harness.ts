// Shared test fixtures (not part of the published package — see deno.json): a
// wiki, written as a vocabulary. Pages several people edit, and notes that
// exist ABOUT a page — so a deleted page takes its notes with it and a
// cascade's casualties are something the tests can watch a journal record.

import { type Graph, graph, type Options, type Plugin } from '@yaks/graph'
import { memory } from '@yaks/memory'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { journal, type JournalOpts } from './record.ts'
import { journalDoc } from './vocab.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    page: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        text: { type: 'string' },
        locked: { type: 'boolean' },
      },
    },
    // A note has nothing left to be about once its page is gone.
    note: {
      type: 'object',
      kind: true,
      properties: {
        text: { type: 'string' },
        page: { type: 'string', ref: 'page', death: 'cascade' },
      },
    },
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

/** A journal plugin with a fixed clock, so a test can assert on the moment it
 * stamped. */
export let logger = (vocab: Vocab, opts: JournalOpts = {}): Plugin =>
  journal(vocab, { now: () => '2026-01-01T00:00:00.000Z', ...opts })

/** The wiki vocabulary the tests write against, journal included. */
export let wiki: Vocab = loadVocab([doc, journalDoc])

/** A graph over a fresh Map, journaling, plus whatever a test brings. */
export let wikiGraph = (plugins: Options['plugins'] = []): Graph =>
  graph({
    storage: memory(wiki),
    vocab: wiki,
    plugins: [logger(wiki), ...plugins],
  })

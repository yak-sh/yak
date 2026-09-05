// Shared test fixtures (not part of the published package — see deno.json): a
// bookshop vocabulary over an in-memory SQLite graph, and a stand-in socket
// the socket tests drive by hand. The domain is a shop — books with a price
// and a status, reviews about them, members who joined — so nothing here needs
// knowledge from outside this file.

import { Database } from '@db/sqlite'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import type { Socket } from './socket.ts'
import type { Frame } from './subs.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A named thing: everything in the shop wears one.
    doc: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    // A book on sale, and the author who wrote it.
    book: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        status: { enum: ['draft', 'shelved', 'sold'] },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    // A review exists ABOUT a book — deleting the book takes its reviews too.
    review: {
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
    // Provenance: server-owned, so the graph's stamp phase is their only
    // writer — which is what makes the door's actor visible in a read.
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

/** The bookshop vocabulary the package's tests read and write against. */
export let shop: Vocab = loadVocab(doc)

/** A graph over a fresh in-memory SQLite database, schema installed. */
export let shopGraph = (): Graph => {
  let db = new Database(':memory:')
  db.exec('pragma foreign_keys = on')
  let store = storage({
    query: (sql, params) => db.prepare(sql).all(...params),
    exec: (sql) => db.exec(sql),
  }, shop)
  store.install()
  return graph({ storage: store, vocab: shop })
}

/** One component off a bundle, for a test that wants a column out of it. */
export let comp = (b: Bundle, name: string): Record<string, unknown> => {
  let c = b[name]
  return c && typeof c == 'object' ? { ...c } : {}
}

/** A request, spelled the way a test wants to say it. */
export let req = (
  path: string,
  init: RequestInit = {},
): Request => new Request(`http://shop.test${path}`, init)

/** A `POST /apply` request carrying a batch. */
export let post = (path: string, body: unknown): Request =>
  req(path, { method: 'POST', body: JSON.stringify(body) })

/** A socket a test drives by hand: it records the frames sent to it, and
 * `emit` plays the events a real one would fire. */
export type Fake = Socket & {
  /** every frame the server has sent, parsed */
  sent: Frame[]
  /** fire an event at the listeners the server registered */
  emit: (type: string, data?: unknown) => void
  /** frames sent since the last read, and forget them */
  taken: () => Frame[]
}

/** A stand-in socket, open by default. Set `readyState = 0` before attaching
 * to watch frames queue until `emit('open')`. */
export let fake = (): Fake => {
  let at: Record<string, ((event: Event & { data?: unknown }) => void)[]> = {}
  let sent: Frame[] = []
  let f: Fake = {
    readyState: 1,
    sent,
    send: (data) => {
      sent.push(JSON.parse(data))
    },
    addEventListener: (type, listener) => {
      ;(at[type] ??= []).push(listener)
    },
    emit: (type, data) => {
      let event = type == 'message'
        ? new MessageEvent('message', { data })
        : new Event(type)
      for (let l of at[type] ?? []) l(event)
    },
    taken: () => sent.splice(0, sent.length),
  }
  return f
}

// Shared test fixtures (not part of the published package — see deno.json): a
// bookshop vocabulary over an in-memory SQLite graph, and a stand-in socket
// the socket tests drive by hand. The subject is a shop — books with a price
// and a status, reviews about them, members who joined — so nothing here
// needs knowledge from outside this file.

import { Database } from '@yaks/sqlite/db'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import type { Socket } from './socket.ts'
import type { Frame } from './subs.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A named thing: everything in the shop has one.
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    // A book on sale, and the author who wrote it.
    book: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        status: { type: 'string', enum: ['draft', 'shelved', 'sold'] },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    // A review exists about a book — deleting the book deletes its reviews
    // too.
    review: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
    // Where a browsing customer's pointer is on a book's page. Everyone in
    // the shop sees it, the shop stores none of it, and it disappears when
    // that browser disconnects.
    browsing: {
      component: true,
      type: 'object',
      sync: 'peers',
      durable: 'connection',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    // A typing indicator that clears itself after a few seconds.
    typing: {
      component: true,
      type: 'object',
      sync: 'peers',
      durable: '5s',
      properties: { who: { type: 'string' } },
    },
    // Provenance: server-owned, so the graph's stamp phase is their only
    // writer — which is what makes the authenticated actor readable back.
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      component: true,
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
  // Numbered entities: a person refers to a book by its number.
  let store = storage(
    {
      query: (sql, params) => db.prepare(sql).all(...params),
      exec: (sql) => db.exec(sql),
    },
    shop,
    { number: true },
  )
  store.install()
  return graph({ storage: store, vocab: shop })
}

/** One component off a bundle, for a test that wants a column out of it. */
export let comp = (b: Bundle, name: string): Record<string, unknown> => {
  let c = b[name]
  return c && typeof c == 'object' ? { ...c } : {}
}

/** A request against the fixture's host, built from a path. */
export let req = (
  path: string,
  init: RequestInit = {},
): Request => new Request(`http://shop.test${path}`, init)

/** A `POST /apply` request carrying a JSON body. */
export let post = (path: string, body: unknown): Request =>
  req(path, { method: 'POST', body: JSON.stringify(body) })

/** A socket a test drives by hand: it records the frames sent to it, and
 * `emit` fires the events a WebSocket would fire. */
export type Fake = Socket & {
  /** every frame the server has sent, parsed */
  sent: Frame[]
  /** fire an event at the listeners the server registered */
  emit: (type: string, data?: unknown) => void
  /** the frames sent since the last call, which it then forgets */
  taken: () => Frame[]
}

/** A stand-in socket, open by default. Set `readyState = 0` before attaching
 * to watch frames queue up until `emit('open')`. */
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

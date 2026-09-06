// The assembly: one call for the whole client side.
//
// A graph in a page is four things that always go together — a map to hold the
// entities, the wire to a server, somewhere durable for what the server will
// never send back, and a way for a render to hear that an answer moved. Wiring
// them up is the same twenty lines in every application, so it is this
// function instead.
//
// Everything it builds stays reachable on the returned object: the graph is the
// graph, and `apply()`, `read()`, plugins and hooks are all still there. This
// package adds no layer over them — `mutate` and `ent` below are two lines
// each, kept because a page reaches for them constantly and because the
// application this package was cut from spells them that way.

import type { Bundle, Change, Eid, Graph, Plugin, ReadOpts } from '@yaks/graph'
import { graph } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { type Query, ram, type Store } from '@yaks/ram'
import {
  type Connect,
  type Fetch,
  type Report,
  type Sync,
  sync,
  type Timer,
} from '@yaks/sync'
import { idb } from './idb.ts'
import { keep, type Vault } from './vault.ts'
import {
  type Make,
  type Watch,
  type Watches,
  watches,
  type WatchOpts,
} from './watch.ts'

/** How a client is put together. Every field has a default; `{}` is a graph in
 * this page with nobody else in it and nothing kept. */
export type ClientOpts = {
  /** the server's base URL — the origin `/apply`, `/query` and `/ws` sit
   * under. Omitted, the graph is local only and nothing is posted anywhere. */
  url?: string
  /** how a batch is sent (default: the global `fetch`) */
  fetch?: Fetch
  /** how the socket is opened (default: the global `WebSocket`) */
  connect?: Connect
  /** how a reconnect is scheduled (default: `setTimeout`) */
  timer?: Timer
  /** headers on every `POST /apply` — an authorization, say */
  headers?: Record<string, string>
  /** the first reconnect delay in ms, doubling to `most` (default: 250) */
  wait?: number
  /** the longest reconnect delay in ms (default: 30_000) */
  most?: number
  /** where a refusal or a transport failure is surfaced (default: a warning) */
  report?: Report
  /** where the local tier is kept: a {@link Vault}, or `false` for none.
   * Default: IndexedDB where the browser has it, nothing where it does not. */
  vault?: Vault | false
  /** the signal factory every watch's `value` is held in — pass `signal` from
   * `@preact/signals` and a render tracks it (default: a plain object) */
  signal?: Make
  /** what names an entity minted under an alias (default: a random uuid) */
  mint?: () => Eid
}

/** A client: the graph, the pieces around it, and the four calls a page makes
 * all day. */
export type Client = {
  /** the vocabulary it speaks */
  vocab: Vocab
  /** the graph itself — `apply`, `read`, `use`, all of it */
  graph: Graph
  /** the map underneath, for a caller that wants a synchronous read */
  store: Store
  /** the wire to the server, when there is one */
  wire?: Sync
  /** the watches on this graph */
  watches: Watches
  /** resolves when the local tier is back in the graph */
  ready: Promise<void>
  /** watch a query: its answer now, and every later one. With a `url`, this
   * also opens the server's subscription for that query and drops it on
   * {@link Watch.close}. */
  watch: (query: string, opts?: ClientWatchOpts) => Watch
  /** read a query once, synchronously */
  read: (query: Query, opts?: ReadOpts) => Bundle[]
  /** one entity, whole, by id — `undefined` if this client has never held it.
   * A dead one comes back wearing `tombstone`. */
  ent: (eid: Eid) => Bundle | undefined
  /** apply a batch: locally at once, then forwarded to the server */
  mutate: (change: Change) => Bundle[] | Promise<Bundle[]>
  /** close the socket and every watch */
  close: () => void
}

/** What a watch may say about itself, plus the client's own question. */
export type ClientWatchOpts = WatchOpts & {
  /** open the server's subscription for this query too (default: true when the
   * client has a `url`) */
  remote?: boolean
}

// The vault a browser gets for free, and nothing anywhere else. Building it is
// lazy — no database is opened until something is written — so this costs
// nothing in a page that keeps nothing.
let ordinary = (): Vault | null => globalThis.indexedDB ? idb() : null

/**
 * Assemble a client graph: a {@link https://jsr.io/@yaks/ram | @yaks/ram}
 * store under a {@link https://jsr.io/@yaks/graph | @yaks/graph}, your plugins
 * on it, {@link https://jsr.io/@yaks/sync | @yaks/sync} to a server if you name
 * one, IndexedDB for the local tier, and watches for the render.
 *
 * ```ts
 * import { client } from '@yaks/client'
 * import { loadVocab } from '@yaks/vocab'
 * import { syncKeywords } from '@yaks/sync'
 * import { signal } from '@preact/signals'
 *
 * let vocab = loadVocab(recipeBox, [syncKeywords])
 * let box = client(vocab, [], { url: 'https://recipes.example', signal })
 *
 * let dinners = box.watch('.course=dinner&.serves>4')
 * box.mutate([{ entity: { eid: crypto.randomUUID() }, doc: { title: 'Dal' } }])
 * ```
 *
 * The vocabulary must be the one your server speaks, loaded with
 * `syncKeywords` so each component's `persist` tier is readable.
 */
export let client = (
  vocab: Vocab,
  plugins: Plugin[] = [],
  opts: ClientOpts = {},
): Client => {
  // `adopt`: the numbers come from the server, not from this map.
  let store = ram(vocab, { adopt: true })
  let g = graph({ storage: store, vocab, plugins, mint: opts.mint })
  let seen = watches(g, { signal: opts.signal })

  let vault = opts.vault === undefined ? ordinary() : opts.vault || null
  let kept = vault ? keep(g, vault) : null

  let wire = opts.url
    ? sync(g, {
      url: opts.url,
      fetch: opts.fetch,
      connect: opts.connect,
      timer: opts.timer,
      headers: opts.headers,
      wait: opts.wait,
      most: opts.most,
      report: opts.report,
    })
    : undefined

  // A watch is also the ask: the page says what it wants to see, and that is
  // exactly the subscription the server should be holding for it.
  let watch = (query: string, o: ClientWatchOpts = {}): Watch => {
    let w = seen.watch(query, o)
    if (!wire || o.remote === false) return w
    let id = wire.subscribe(query)
    return {
      query: w.query,
      get value() {
        return w.value
      },
      subscribe: w.subscribe,
      close: () => {
        wire.unsubscribe(id)
        w.close()
      },
    }
  }

  return {
    vocab,
    graph: g,
    store,
    wire,
    watches: seen,
    ready: kept?.ready ?? Promise.resolve(),
    watch,
    read: (query, readOpts) => store.read(query, readOpts),
    ent: (eid) => store.tx((tx) => tx.get([eid]))[0],
    mutate: (change) => g.apply(change),
    close: () => {
      wire?.close()
      seen.close()
    },
  }
}

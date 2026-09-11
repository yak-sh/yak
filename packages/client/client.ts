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

import type {
  Bundle,
  Change,
  Eid,
  Graph,
  Plugin,
  ReadOpts,
  StampPolicy,
} from '@yaks/graph'
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
import { idb, wireIdb } from './idb.ts'
import { keep, type Vault } from './vault.ts'
import { type Retained, retention } from './retention.ts'
import type { WireVault } from './wire-vault.ts'
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
  /** Maximum inactive wire payloads (default: 20,000). */
  retention?: number
  /** Keep uncovered columns as a paint floor in the same RAM row. They do
   * not count as loaded; covered omissions, deaths and epoch changes still
   * reconcile them. Useful for one-shot field reads beside live projections. */
  retainUnownedColumns?: boolean
  /** Maximum encoded bytes of retained server membership/coverage metadata. */
  answerBytes?: number
  /** Server tier, separate from local drafts. Default: wireIdb in browsers.
   * No disk reads/writes occur until an authoritative epoch is supplied. */
  wireVault?: WireVault | false
  /** Authoritative boot epoch, never an unvalidated disk epoch. */
  epoch?: string
  /** the signal factory every watch's `value` is held in — pass `signal` from
   * `@preact/signals` and a render tracks it (default: a plain object) */
  signal?: Make
  /** what names an entity minted under an alias (default: a random uuid) */
  mint?: () => Eid
  /** Replica hosts may leave provenance exclusively to their authority. */
  provenance?: StampPolicy
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
  /** Working-set retention and persistence diagnostics. */
  cache: Retained
  /** Validate a boot epoch, invalidate server-only state on mismatch, and
   * request fresh subscription answers. Local drafts are never invalidated. */
  setEpoch: (epoch: string) => Promise<void>
  /** Resolves after local hydration and any explicitly supplied epoch restore. */
  ready: Promise<void>
  /** watch a query: its answer now, and every later one. Identical query lines
   * and options share one evaluation and server subscription. Each returned
   * handle closes independently; the last close drops the subscription. */
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
  /** Let the server alone evaluate membership/order, without parsing or
   * priming from incomplete local data. Requires a remote watch. Cached
   * payloads remain in RAM; a bounded same-epoch answer may prime an unready reopen. */
  evaluate?: 'local' | 'server'
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
  let g = graph({
    storage: store,
    vocab,
    plugins,
    mint: opts.mint,
    provenance: opts.provenance,
  })
  // Sync pins local commits before any rendering or asynchronous vault effect.
  let cache: Retained
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
      get replica() {
        return cache
      },
    })
    : undefined

  let seen = watches(g, { signal: opts.signal })

  let vault = opts.vault === undefined ? ordinary() : opts.vault || null
  let kept = vault ? keep(g, vault) : null

  cache = retention(g, store, seen, {
    retainUnownedColumns: opts.retainUnownedColumns,
    limit: opts.retention,
    answerBytes: opts.answerBytes,
    localOnly: !opts.url,
    vault: opts.wireVault === false
      ? undefined
      : opts.wireVault ?? (globalThis.indexedDB ? wireIdb() : undefined),
    report: opts.report
      ? (error) => opts.report!({ sent: [], error, reverted: false })
      : undefined,
  })
  let restored = opts.epoch ? cache.epoch(opts.epoch) : Promise.resolve()

  type Shared = {
    watch: Watch
    release: () => void
    holders: number
  }
  let shared = new Map<string, Shared>()
  let handles = new Set<() => void>()
  let closed = false

  // Exact query text is deliberate: no normalizing quoted text, projection
  // order or relative dates in a way that silently merges different asks.
  let watch = (query: string, o: ClientWatchOpts = {}): Watch => {
    if (closed) throw new Error('client is closed')
    let remote = !!wire && o.remote !== false
    let server = o.evaluate === 'server'
    if (server && !remote) {
      throw new Error('server evaluation requires a remote watch')
    }
    let key = JSON.stringify([query, o.now ?? null, remote, server])
    let entry = shared.get(key)
    if (!entry) {
      let local = server ? undefined : seen.watch(query, o)
      let w = local
      let release = () => local?.close()
      if (remote) {
        let id: string
        try {
          id = wire!.subscribe(query, undefined, {
            prime: !server,
            answerKey: server ? key : undefined,
          })
        } catch (error) {
          local?.close()
          throw error
        }
        let ready = (opts.signal ?? (<T>(value: T) => ({ value })))(
          wire!.ready(id),
        )
        let read = () =>
          server
            ? cache.answer(id)
            : local!.value.filter((b) => cache.includes(id, b.entity.eid))
        let value = (opts.signal ?? (<T>(value: T) => ({ value })))(read())
        let listeners = new Set<(bundles: Bundle[]) => void>()
        let publish = (force = false) => {
          let next = read()
          if (
            next.length !== value.value.length ||
            next.some((b, i) => {
              let was = value.value[i]
              // RAM get() assembles a bundle, but unchanged component/identity
              // references are stable. Do not wake on another answer's pins.
              return b !== was && (!server ||
                Object.keys(b).length !== Object.keys(was).length ||
                Object.keys(b).some((name) => b[name] !== was[name]))
            })
          ) {
            value.value = next
            force = true
          }
          if (force) { for (let fn of listeners) fn(value.value) }
        }
        let stopMembership = cache.onMembership((changed) => {
          if (changed === id) publish()
        })
        let stopLocal = local
          ? local.subscribe(() => publish())
          : cache.onRows((eids) => {
            let touched = new Set(eids)
            if (value.value.some((b) => touched.has(b.entity.eid))) publish()
          })
        let stopReady = wire!.onReady((changed, value) => {
          if (changed !== id) return
          ready.value = value
          publish(true)
        })
        release = () => {
          stopReady()
          stopMembership()
          stopLocal()
          listeners.clear()
          local?.close()
          wire!.unsubscribe(id)
        }
        w = {
          query,
          get value() {
            return value.value
          },
          get ready() {
            return ready.value && (local?.ready ?? true)
          },
          subscribe: (fn) => {
            listeners.add(fn)
            return () => listeners.delete(fn)
          },
          close: release,
        }
      }
      entry = { watch: w!, release, holders: 0 }
      shared.set(key, entry)
    }
    let own = entry
    own.holders++
    let active = true
    let stops = new Set<() => void>()
    let close = () => {
      if (!active) return
      active = false
      handles.delete(close)
      for (let stop of stops) stop()
      stops.clear()
      if (--own.holders === 0) {
        shared.delete(key)
        own.release()
      }
    }
    handles.add(close)
    return {
      query,
      get value() {
        return own.watch.value
      },
      get ready() {
        return own.watch.ready
      },
      subscribe: (fn) => {
        if (!active) return () => {}
        // Wrap even identical callbacks: another handle may own the same fn.
        let off = own.watch.subscribe((value) => fn(value))
        let stop = () => {
          off()
          stops.delete(stop)
        }
        stops.add(stop)
        return stop
      },
      close,
    }
  }

  return {
    vocab,
    graph: g,
    store,
    wire,
    watches: seen,
    cache,
    setEpoch: (epoch) => {
      let ready = cache.epoch(epoch)
      wire?.refresh()
      return ready
    },
    ready: Promise.all([kept?.ready, restored]).then(() => undefined),
    watch,
    read: (query, readOpts) => {
      let rows = store.read(query, readOpts)
      cache.touch(rows.map((b) => b.entity.eid))
      return rows
    },
    ent: (eid) => {
      cache.touch([eid])
      return store.tx((tx) => tx.get([eid]))[0]
    },
    mutate: (change) => g.apply(change),
    close: () => {
      closed = true
      for (let close of handles) close()
      wire?.close()
      cache.close()
      seen.close()
    },
  }
}

// The assembly: one call builds the whole client side.
//
// A graph in a page is four things that always go together — a map to hold the
// entities, a connection to a server, somewhere durable for what the server
// will never send back, and a way for a render to find out that a query's
// result changed. Connecting them is the same twenty lines in every
// application, so this function does it instead.
//
// Everything it builds stays reachable on the object it returns: the graph is
// the graph, and `apply()`, `read()`, plugins and hooks are all still there.
// This package adds no layer over them — `mutate` and `ent` below are two
// lines each, kept because a page calls them constantly and because the
// application this package was extracted from names them that way.

import type {
  Bundle,
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

/** How a client is put together. Every field has a default; `{}` is a graph
 * in this page alone, connected to no server and storing nothing. */
export type ClientOpts = {
  /** the server's base URL — the origin `/apply`, `/query` and `/ws` are
   * served under. Omit it and the graph is local only: nothing is posted
   * anywhere. */
  url?: string
  /** how changes are POSTed to `/apply` (default: the global `fetch`) */
  fetch?: Fetch
  /** how the WebSocket is opened (default: the global `WebSocket`) */
  connect?: Connect
  /** how a reconnect is scheduled (default: `setTimeout`) */
  timer?: Timer
  /** headers added to every `POST /apply` — an `authorization`, say */
  headers?: Record<string, string>
  /** the first reconnect delay in ms, doubling to `most` (default: 250) */
  wait?: number
  /** the longest reconnect delay in ms (default: 30_000) */
  most?: number
  /** where a refusal or a network failure is reported (default: a console
   * warning) */
  report?: Report
  /** where this browser's own components are stored: a {@link Vault}, or
   * `false` for none. Default: IndexedDB where the browser has it, nothing
   * where it does not. */
  vault?: Vault | false
  /** how many inactive server-synchronized entities to keep (default:
   * 20,000) */
  retention?: number
  /** Keep properties no subscription covers in the same in-memory row, so a
   * render still has something to show. They do not count as loaded; a
   * covering subscription omitting them, a delete, and an epoch change all
   * still reconcile them. Useful for one-off field reads made alongside live
   * queries. */
  retainUnownedProps?: boolean
  /** the byte budget for the retained server membership and coverage
   * metadata, once encoded */
  answerBytes?: number
  /** where server-synchronized rows are stored, separate from this browser's
   * own drafts. Default: {@link wireIdb} in a browser. Nothing is read from
   * or written to disk until the server's epoch has been supplied. */
  wireVault?: WireVault | false
  /** the server's epoch for this boot; never an epoch read back from disk
   * without validation */
  epoch?: string
  /** the signal factory every watch's `value` is held in — pass `signal`
   * from `@preact/signals` and a render tracks it (default: a plain
   * object) */
  signal?: Make
  /** how an eid is generated for an entity minted under an alias (default: a
   * random uuid) */
  mint?: () => Eid
  /** how `created` and `updated` are stamped. A client that mirrors another
   * graph can leave provenance entirely to that server. */
  provenance?: StampPolicy
}

/** A client: the graph, the pieces around it, and the four calls a page
 * makes all day. */
export type Client = {
  /** the vocabulary it uses */
  vocab: Vocab
  /** the graph itself — `apply`, `read`, `use`, all of it */
  graph: Graph
  /** the map underneath, for a caller that wants a synchronous read */
  store: Store
  /** the connection to the server, when there is one */
  wire?: Sync
  /** the watches on this graph */
  watches: Watches
  /** the working set: what is retained in memory and on disk, and what is
   * loaded */
  cache: Retained
  /** Check a boot epoch: on a mismatch, discard the server-synchronized state
   * and ask the server for fresh subscription results. This browser's own
   * drafts are never discarded. */
  setEpoch: (epoch: string) => Promise<void>
  /** resolves once this browser's stored components are back in the graph,
   * and once any epoch passed in `opts.epoch` has been restored */
  ready: Promise<void>
  /** watch a query: its result now, and every later one. Identical query
   * strings with identical options share one evaluation and one server
   * subscription. Each handle returned closes independently; the last close
   * drops the subscription. */
  watch: (query: string, opts?: ClientWatchOpts) => Watch
  /** read a query once, synchronously */
  read: (query: Query, opts?: ReadOpts) => Bundle[]
  /** one entity, whole, by id — `undefined` if this client has never held
   * it. A deleted entity comes back with a `tombstone` component. */
  ent: (eid: Eid) => Bundle | undefined
  /** apply bundles: to the local graph at once, then POSTed to the server */
  mutate: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
  /** close the WebSocket and every watch */
  close: () => void
}

/** The options one watch takes, plus the two this package adds. */
export type ClientWatchOpts = WatchOpts & {
  /** open the server's subscription for this query too (default: true when
   * the client has a `url`) */
  remote?: boolean
  /** `'server'` lets the server alone decide membership and order: the query
   * is not parsed or evaluated locally against data that may be incomplete.
   * It requires a remote watch. Entity data stays in memory either way, and a
   * bounded result saved under the same epoch can fill a reopened watch in
   * before it is ready. */
  evaluate?: 'local' | 'server'
}

// The vault a browser gets for free, and nothing on any other runtime.
// Building it is lazy — no database is opened until something is written — so
// this costs nothing in a page that stores nothing.
let ordinary = (): Vault | null => globalThis.indexedDB ? idb() : null

/**
 * Assemble a client graph: a {@link https://jsr.io/@yaks/ram | @yaks/ram}
 * store under a {@link https://jsr.io/@yaks/graph | @yaks/graph}, your plugins
 * on it, {@link https://jsr.io/@yaks/sync | @yaks/sync} to a server if you
 * give it a URL, IndexedDB for this browser's own components, and watches for
 * the render.
 *
 * ```ts ignore
 * import { client } from '@yaks/client'
 * import { mint } from '@yaks/graph'
 * import { loadVocab } from '@yaks/vocab'
 * import { signal } from '@preact/signals'
 *
 * let vocab = loadVocab(recipeBox)
 * let box = client(vocab, [], { url: 'https://recipes.example', signal })
 *
 * let dinners = box.watch('.course=dinner&.serves>4')
 * box.mutate([{ entity: { eid: mint() }, doc: { title: 'Dal' } }])
 * ```
 *
 * The vocabulary must be the one your server uses, loaded with nothing
 * extra: `sync` and `durable` are core keywords.
 */
export let client = (
  vocab: Vocab,
  plugins: Plugin[] = [],
  opts: ClientOpts = {},
): Client => {
  // `adopt`: entity numbers come from the server, not from this map.
  let store = ram(vocab, { adopt: true, number: true })
  let g = graph({
    storage: store,
    vocab,
    plugins,
    mint: opts.mint,
    provenance: opts.provenance,
  })
  // @yaks/sync pins locally committed rows before anything renders or the
  // vault's asynchronous write runs.
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
    retainUnownedProps: opts.retainUnownedProps,
    limit: opts.retention,
    answerBytes: opts.answerBytes,
    localOnly: !opts.url,
    timer: opts.timer,
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

  // Watches are shared by exact query text, deliberately: normalizing quoted
  // text, projection order or relative dates would silently merge two
  // different queries into one.
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
              // @yaks/ram's get() assembles a new bundle object, but the
              // component and identity objects inside it keep their
              // references when they have not changed. So compare those, and
              // do not notify listeners because another query pinned a row.
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
        // Wrap even identical callbacks: another handle may have registered
        // the same function.
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
    mutate: (bundles) => g.apply(bundles),
    close: () => {
      closed = true
      for (let close of handles) close()
      wire?.close()
      cache.close()
      seen.close()
    },
  }
}

/**
 * @yaks/client — the frontend tier for a client
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}: one call assembles it, a
 * query is a value that changes, and what belongs to this browser is kept in
 * IndexedDB.
 *
 * The pieces already exist — a map to hold entities
 * ({@link https://jsr.io/@yaks/memory | @yaks/memory}), a wire to a server
 * ({@link https://jsr.io/@yaks/sync | @yaks/sync}), a query evaluator with no
 * database under it ({@link https://jsr.io/@yaks/match | @yaks/match}). This
 * package is the three things a page still has to add: the assembly, the
 * reactivity, and somewhere durable to put the state the server will never send
 * back.
 *
 * ## One call
 * ```ts
 * import { client } from '@yaks/client'
 * import { loadVocab } from '@yaks/vocab'
 * import { syncKeywords } from '@yaks/sync'
 *
 * let vocab = loadVocab(recipeBox, [syncKeywords])
 * let box = client(vocab, [], { url: 'https://recipes.example' })
 *
 * box.mutate([{
 *   entity: { eid: crypto.randomUUID() },
 *   doc: { title: 'Dal' },
 *   recipe: { serves: 4, course: 'dinner' },
 * }])
 * ```
 *
 * ## A query is a value
 * {@link Watch} is the reading half: `value` is the answer now, `subscribe`
 * hears the next one, `close` stops. It is framework-free — and it is a signal
 * when you hand {@link ClientOpts.signal} a signal factory, and React's
 * `useSyncExternalStore` when you hand it `subscribe` and `() => value`.
 *
 * ```ts
 * let dinners = box.watch('.course=dinner&.serves>4')
 * dinners.value // the bundles
 * let stop = dinners.subscribe((bundles) => render(bundles))
 * ```
 *
 * With a `url`, opening a watch also opens the server's subscription for that
 * query, and closing it drops it — so what the page is looking at is what the
 * server is sending.
 *
 * ## Three tiers, one apply()
 * A component's `persist` keyword (@yaks/sync's) says where its state lives:
 * `wire` is the server's and syncs, `local` is this browser's and is kept in
 * IndexedDB ({@link idb}), `none` dies with the tab. All three ride the same
 * `apply()`, and the local tier is back in the graph by the time
 * {@link Client.ready} resolves.
 *
 * ## Nothing is imported from a platform
 * `fetch`, `WebSocket` and `indexedDB` are all looked up through options with
 * the global as the default, so the whole package runs — and is tested — in one
 * process with no browser at all.
 *
 * @module
 */

export {
  type Client,
  client,
  type ClientOpts,
  type ClientWatchOpts,
} from './client.ts'
export {
  type Hold,
  type Make,
  type Watch,
  type Watches,
  watches,
  type WatchesOpts,
  type WatchOpts,
} from './watch.ts'
export {
  keep,
  type Kept,
  localComps,
  type Saved,
  stash,
  type Vault,
} from './vault.ts'
export { idb, type IdbOpts } from './idb.ts'

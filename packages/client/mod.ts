/**
 * @yaks/client — everything a browser page needs around a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} graph: one call assembles
 * it, a query is a value that changes, and what belongs to this browser is
 * stored in IndexedDB.
 *
 * The pieces already exist — a map to hold entities
 * ({@link https://jsr.io/@yaks/ram | @yaks/ram}), an HTTP and WebSocket
 * connection to a server ({@link https://jsr.io/@yaks/sync | @yaks/sync}), a
 * query evaluator with no database under it
 * ({@link https://jsr.io/@yaks/match | @yaks/match}). This package adds the
 * three things a page still needs: the assembly, the reactivity, and somewhere
 * durable to put the state the server will never send back.
 *
 * ## One call
 * ```ts ignore
 * import { client } from '@yaks/client'
 * import { mint } from '@yaks/graph'
 * import { loadVocab } from '@yaks/vocab'
 *
 * let vocab = loadVocab(recipeBox)
 * let box = client(vocab, [], { url: 'https://recipes.example' })
 *
 * box.mutate([{
 *   entity: { eid: mint() },
 *   doc: { title: 'Dal' },
 *   recipe: { serves: 4, course: 'dinner' },
 * }])
 * ```
 *
 * ## A query is a value
 * {@link Watch} is the reading half: `value` is the result now, `subscribe`
 * is called with the next one, `close` stops it. It depends on no framework —
 * it becomes a signal when you pass {@link ClientOpts.signal} a signal
 * factory, and it drives React's `useSyncExternalStore` when you pass that
 * hook `subscribe` and `() => value`.
 *
 * ```ts ignore
 * let dinners = box.watch('.course=dinner&.serves>4')
 * dinners.value // the bundles
 * let stop = dinners.subscribe((bundles) => render(bundles))
 * ```
 *
 * With a `url`, identical watches share one server subscription until the last
 * handle closes. `ready` is false until the first result from the server
 * arrives, even when cached rows are already on screen, and false again on
 * disconnect. Both `value` and `ready` are reactive; listeners are called when
 * readiness changes, even if the result is empty.
 *
 * ## Where state lives, one apply()
 * A component's `sync` and `durable` keywords in the vocabulary decide where
 * its state is kept: `sync: server` is the server's and is synchronized with
 * it; `sync: none` with `durable: forever` belongs to this browser and is
 * stored in IndexedDB ({@link idb}); `sync: none` with `durable: tab` belongs
 * to this tab and is kept in its `sessionStorage` ({@link webStorage}), across
 * a reload and gone with the tab; any other `sync: none` component is held in
 * memory and disappears with the page. All are written through the same
 * `apply()`. What the tab kept is back in the graph when {@link client}
 * returns, and what IndexedDB held by the time {@link Client.ready}
 * resolves.
 *
 * ## Nothing is imported from a runtime
 * `fetch`, `WebSocket`, `indexedDB` and `sessionStorage` are all read from
 * options that default to the global, so the whole package runs — and is
 * tested — in one process with no browser at all.
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
  keeps,
  type Kept,
  localComps,
  type Saved,
  stash,
  type Tier,
  type Vault,
} from './vault.ts'
export { idb, type IdbOpts, wireIdb } from './idb.ts'
export { type Area, webStorage } from './web-storage.ts'

export { type Retained, retention, RETENTION_ROWS } from './retention.ts'
export { wireStash, type WireVault } from './wire-vault.ts'

export { ANSWER_BYTES, type SavedAnswer } from './answers.ts'

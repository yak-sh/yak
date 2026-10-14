// The words the runtime fails a Durable Object's work with when it resets the
// object, and which of them are ours to fix.
//
// The runtime moves an object to a new instance whenever it likes: a runtime
// update, another machine, a deploy. The instance that was moved fails what it
// had in flight, and whoever owns that work runs it again: a caller fetches
// again on a fresh stub, the runtime retries an alarm that failed. Cloudflare
// documents the move as part of an object's life, so what the moved instance
// meets is no defect. A live object that meets the words from an object it
// called has run out of retries, and that is a failure; so is a reset our own
// code caused: a storage operation over its timeout, or a kill for the CPU or
// memory limit.

let MOVED = [
  'Durable Object instance is no longer active',
  'Durable Object reset because',
]
let RESETS = [
  ...MOVED,
  'Durable Object storage operation exceeded timeout which caused object to be reset',
]
let LIMITS = /exceeded its (CPU time|memory) limit/
let OPAQUE = /^internal error; reference = [a-z0-9]+$/i

let says = (e: unknown, words: string[]) =>
  e instanceof Error && words.some((said) => e.message.includes(said))

/**
 * The runtime moved this object to a new instance, and the work is run again
 * by whoever owns it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let gone = new Error('Connection closed: this Durable Object instance is ' +
 *   'no longer active. Reconnect or retry the request.')
 * assertEquals(moved(gone), true)
 * assertEquals(moved(new Error('Durable Object reset because its code was updated.')), true)
 * assertEquals(moved(new Error('Durable Object storage operation exceeded ' +
 *   'timeout which caused object to be reset.')), false)
 * assertEquals(moved(null), false)
 * ```
 */
export let moved = (e: unknown): boolean => says(e, MOVED)

/** The slice of an object's storage that `replaced` asks. */
export type Own = {
  sql: { exec(query: string): unknown }
  transactionSync<T>(body: () => T): T
}

/**
 * Whether the runtime has moved the object off the instance this storage
 * belongs to. A moved instance refuses its own storage in the words `moved`
 * knows, but not all of it: one reset for a deploy still answers a read and
 * refuses every write (workerd's `ActorSqlite::requireNotBroken`). A
 * transaction counts as a write even when its body only reads, so it asks
 * both; the live instance answers.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let reset = () => {
 *   throw new Error('Durable Object reset because its code was updated.')
 * }
 * let sql = { exec: () => [] }
 * let live = { sql, transactionSync: <T>(body: () => T) => body() }
 * assertEquals(replaced(live), false)
 * assertEquals(replaced({ sql, transactionSync: reset }), true)
 * assertEquals(replaced({ ...live, sql: { exec: reset } }), true)
 * ```
 */
export let replaced = (storage: Own): boolean => {
  try {
    storage.transactionSync(() => storage.sql.exec('SELECT 1'))
    return false
  } catch (e) {
    return moved(e)
  }
}

/**
 * The object was reset under a request, and the runtime's guidance is to fetch
 * again: its own `retryable` flag on the error, or, on an older runtime, its
 * words.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(evicted(Object.assign(new Error('reset'), { retryable: true })), true)
 * assertEquals(evicted(new Error('Durable Object storage operation exceeded ' +
 *   'timeout which caused object to be reset.')), true)
 * assertEquals(evicted(new Error('boot failed')), false)
 * assertEquals(evicted(null), false)
 * ```
 */
export let evicted = (e: unknown): boolean =>
  e instanceof Error &&
  (('retryable' in e && e.retryable === true) || says(e, RESETS))

/**
 * The runtime killed the object for its limits. Its own code never sees the
 * kill, and the retry may well answer, so whoever sees these words reports
 * them before anything retries, or nothing ever would (M-37965).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(killed(new Error('Durable Object exceeded its CPU time limit and was reset.')), true)
 * assertEquals(killed(new Error('boot failed')), false)
 * ```
 */
export let killed = (e: unknown): boolean =>
  e instanceof Error && LIMITS.test(e.message)

/**
 * The runtime failed inside itself and names no cause, only a reference for
 * Cloudflare to look up. The work is tried again; a failure that persists
 * through the retries is reported.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(opaque(new Error('internal error; reference = h1h5n5h0ltksfc1hb4h8qkit')), true)
 * assertEquals(opaque(new Error('get: internal error; reference = abc')), false)
 * assertEquals(opaque('internal error; reference = abc'), false)
 * ```
 */
export let opaque = (e: unknown): e is Error =>
  e instanceof Error && OPAQUE.test(e.message)

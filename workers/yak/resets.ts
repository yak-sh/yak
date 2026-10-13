// The words the runtime fails a Durable Object's work with when it resets the
// object, and which of them are ours to fix.
//
// The runtime moves an object to a new instance whenever it likes: a runtime
// update, another machine, a deploy, or a newer deploy reaching it (running.ts
// `behind`). The instance that was moved fails what it had in flight, and
// whoever owns that work runs it again: a caller's door fetches again on a
// fresh stub (door.ts `retried`), the runtime retries an alarm that failed,
// the effect pool runs an effect again, and the platform job it died in fires
// again at the next incarnation's alarm (wake.ts `resumed`). Cloudflare
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

/** The slice of a Durable Object's state that reaches its own storage. */
export type Own = { storage: { sql: { exec(query: string): unknown } } }

/**
 * Whether the runtime has moved the object off the instance this state
 * belongs to. A moved instance can no longer reach its own storage, which
 * refuses it in the words `moved` knows; the live one answers.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let gone = new Error('Connection closed: this Durable Object instance is ' +
 *   'no longer active. Reconnect or retry the request.')
 * let answering = { storage: { sql: { exec: () => [] } } }
 * let refusing = { storage: { sql: { exec: () => { throw gone } } } }
 * assertEquals(replaced(answering), false)
 * assertEquals(replaced(refusing), true)
 * ```
 */
export let replaced = (state: Own): boolean => {
  try {
    state.storage.sql.exec('SELECT 1')
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

// The words the runtime fails a Durable Object's work with when it resets the
// object, and which of them are ours to fix.
//
// The runtime moves an object to a new instance whenever it likes: a runtime
// update, another machine, a deploy, a failure inside its own storage or in
// starting that storage up. The instance that was moved fails what it had in
// flight, and whoever owns that work runs it again: a caller fetches again on
// a fresh stub, the runtime retries an alarm that failed. Cloudflare documents
// the move as part of an object's life, so what the moved instance meets is no
// defect. A live object that meets the words from an object it called has run
// out of retries, and that is a failure; so is a reset our own code caused: a
// storage operation over its timeout, or a kill for the CPU or memory limit.

import { sleep } from '@yaks/fp'

let MOVED = [
  'Durable Object instance is no longer active',
  'Durable Object reset because',
  'Internal error in Durable Object storage',
  'Internal error while starting up Durable Object storage',
]
let RESETS = [
  ...MOVED,
  'Durable Object storage operation exceeded timeout which caused object to be reset',
]
let LIMITS = /exceeded its (CPU time|memory) limit/
let LOST = /Network connection lost/
let STARVED = /\bSQLITE_NOMEM\b/
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
 * assertEquals(moved(new Error('Internal error in Durable Object storage ' +
 *   'caused object to be reset; reference = 48q6hau1fptrm6g69pk2lqqh')), true)
 * assertEquals(moved(new Error('Internal error while starting up Durable ' +
 *   'Object storage caused object to be reset; reference = k6485n9h')), true)
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
 * The object's SQLite refused a statement for memory. The engine also says
 * this when a statement's program passes its step limit, which no wait cures,
 * so it is reported and never sent again.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(starved(new Error('out of memory: SQLITE_NOMEM')), true)
 * assertEquals(starved(new Error('boot failed')), false)
 * ```
 */
export let starved = (e: unknown): boolean =>
  e instanceof Error && STARVED.test(e.message)

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

/**
 * The connection to the object dropped under a call. The runtime names it in
 * words alone, with no `retryable` flag to go by, and the call is sent again.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(lost(new Error('Network connection lost.')), true)
 * assertEquals(lost(new Error('boot failed')), false)
 * ```
 */
export let lost = (e: unknown): boolean =>
  e instanceof Error && LOST.test(e.message)

// The pauses before a replayable call is sent again, one per resend, backing
// off as Cloudflare's guidance for a Durable Object's retryable errors has
// it. An object restarts for each newer deploy that reaches it, and each
// restart fails what it had in flight: a call cut off by one deploy's restart
// can have its retry cut off by the next one's when two land seconds apart.
// While the runtime moves an object it can refuse calls into it with its own
// internal error for ten to twenty seconds, so the pauses together outlast
// that: a read waits for the object rather than failing a person's page or
// leaving a store out of an answer. Only a call that keeps failing spends
// them. `wait` spends a pause, half of it or more, so calls that failed
// together do not return together; a test replaces it.
export let backoff: { pauses: number[]; wait: (ms: number) => Promise<void> } =
  {
    pauses: [100, 500, 2000, 5000, 15000],
    wait: (ms) => sleep(ms / 2 + Math.random() * ms / 2),
  }

/**
 * Send one replayable call again while it fails in words `retry` knows,
 * pausing before each resend, once per `backoff` pause. The last failure
 * propagates unchanged.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * backoff.wait = () => Promise.resolve()
 * let sends = 0
 * let send = () => {
 *   if (++sends < 3) throw new Error('Network connection lost.')
 *   return 'answered'
 * }
 * assertEquals(await retried(send, true, lost), 'answered')
 * assertEquals(sends, 3)
 * ```
 */
export let retried = async <T>(
  send: () => T | Promise<T>,
  replayable = true,
  retry: (error: unknown) => boolean = evicted,
): Promise<T> => {
  for (let sent = 0;; sent++) {
    try {
      return await send()
    } catch (e) {
      let pause = backoff.pauses[sent]
      if (!retry(e) || !replayable || pause == null) throw e
      await backoff.wait(pause)
    }
  }
}

// Which deploy of this Worker an isolate runs, and whether a caller's is newer
// (T-123372, T-123489).
//
// Cloudflare leaves a busy Durable Object on the code it started with for up
// to five minutes after a deploy (wrangler.toml `code_update_strategy`) and
// moves an idle one within seconds. Every request to an object carries the
// version its caller runs (door.ts `doorOf` for a store, `fetchOf` for the
// Wire and the Builder), so an object knows when a newer caller reaches it.
// A store answers that caller on the code it has, which keeps every call of
// the deploy before working, and restarts itself only when that code refused
// the caller (`owed`), since what it refused may be a door or a word only the
// caller's deploy has; the caller's retry of the evicted request
// (@yaks/durable-object `evicted`) then meets the new code. A restart is not
// free: twice on 2026-11-07 the instance after one waited 21 and 32 s to run
// its first line, where Cloudflare's own moves started in under a second
// (T-150897). The Wire and the Builder restart before anything, when they are
// idle (@yaks/durable-object `Durable`'s `behind`, given `owed`). A store
// still behind its caller after its restart answers a refusal as a
// failure the caller sends again, and reports it (`skewed`, T-140262).
//
// The version is the runtime's own (`CF_VERSION_METADATA`): a fresh id and
// upload time on every deploy, the same for the Worker and every object it
// binds. An isolate runs one version for its whole life, so the first
// invocation's is everyone's (defects-runtime.ts `entry`). Under `wrangler
// dev` and the test kernels there is none, and nothing is stamped or compared.

/** A Worker version: the runtime's id for it and when it was uploaded. */
// The platform's release, as a person reads it: what a connector says it runs
// (`serverInfo.version`), what a feedback letter names, and the stand-in for
// Cloudflare's per-deploy id wherever the runtime gives none.
export let VERSION = '0.1.0'

export type Version = { id: string; at: string }

/** The binding's shape, as env.ts declares it. */
type Meta = { id?: string; timestamp?: string }

/** The headers a request to a store says its caller's version in. Not
 * `x-yak-version`, which is a page's own version (client.js, lenses.ts). */
export let WORKER_VERSION = 'x-yak-worker-version'
export let WORKER_VERSION_AT = 'x-yak-worker-version-at'

/**
 * The binding as a version, when it says enough to compare.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(versionOf({ id: 'b', timestamp: '2026-10-12T16:00:00Z' }), {
 *   id: 'b',
 *   at: '2026-10-12T16:00:00Z',
 * })
 * assertEquals(versionOf({ id: 'b' }), null)
 * assertEquals(versionOf(undefined), null)
 * ```
 */
export let versionOf = (meta?: Meta | null): Version | null =>
  meta?.id && meta.timestamp ? { id: meta.id, at: meta.timestamp } : null

let here: Version | null = null

/** Note the version this isolate runs, from the first invocation that says. */
export let learn = (meta?: Meta | null): void => {
  here ??= versionOf(meta)
}

/** The version this isolate runs, or null where the runtime names none. */
export let running = (): Version | null => here

/** Stamp a request to a store with the version its caller runs. A version a
 * request already carried is never kept: only the kernel says it. */
export let stamp = (headers: Headers, version = running()): void => {
  headers.delete(WORKER_VERSION)
  headers.delete(WORKER_VERSION_AT)
  if (!version) return
  headers.set(WORKER_VERSION, version.id)
  headers.set(WORKER_VERSION_AT, version.at)
}

/** The caller's version, as a request to a store says it. */
export let caller = (headers: Headers): Version | null =>
  versionOf({
    id: headers.get(WORKER_VERSION) ?? undefined,
    timestamp: headers.get(WORKER_VERSION_AT) ?? undefined,
  })

/**
 * Whether `theirs` is a later deploy than `mine`. A rollback deploys an older
 * version, which is never newer; neither is a version that cannot be read.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let a = { id: 'a', at: '2026-10-12T16:00:00Z' }
 * let b = { id: 'b', at: '2026-10-12T16:30:00Z' }
 * assertEquals(newer(b, a), true)
 * assertEquals(newer(a, b), false)
 * assertEquals(newer(a, a), false)
 * assertEquals(newer(b, null), false)
 * assertEquals(newer({ id: 'c', at: 'soon' }, a), false)
 * ```
 */
export let newer = (theirs: Version | null, mine: Version | null): boolean =>
  !!theirs && !!mine && theirs.id != mine.id &&
  Date.parse(theirs.at) > Date.parse(mine.at)

/** The slice of an object's state a restart needs. Each object declares its
 * own state; a stand-in that cannot restart leaves `abort` out. */
export type Restartable = {
  abort?(reason?: string): void
  storage: {
    get?<T>(key: string): Promise<T | undefined>
    put?(key: string, value: unknown): Promise<void>
    // Whatever was written, made durable before the restart drops it.
    sync?(): Promise<void>
  }
}

// The key an object that restarted for a newer deploy remembers it under.
let RESTARTED = 'restarted for'
let retiring = new WeakSet<object>()

/** An instance that requested its own restart, before storage reflects it. */
export let restarting = (state: object): boolean => retiring.has(state)

// The words the restart fails the request in flight with: the runtime's own,
// so every caller's retry already knows them (@yaks/durable-object `evicted`).
let BEHIND = 'Durable Object reset because a newer deploy reached it:'

/** The deploy this object last restarted for, as `owed` keeps it. A record
 * in any other shape says nothing. */
export let restartedFor = async (
  storage: Restartable['storage'],
): Promise<Version | null> => {
  let kept = await storage.get<Partial<Version>>?.(RESTARTED)
  return typeof kept?.id == 'string' && typeof kept.at == 'string'
    ? { id: kept.id, at: kept.at }
    : null
}

/** What an object says of its deploys: the version it runs and the one it last
 * restarted for. */
export let ran = async (
  meta: Meta | null | undefined,
  storage: Restartable['storage'],
): Promise<{ version: Version | null; restartedFor: Version | null }> => ({
  version: versionOf(meta),
  restartedFor: await restartedFor(storage),
})

/**
 * The restart this object owes its caller, when the caller runs a later deploy
 * than the one it runs; null when it owes none. Nothing is read or written
 * until the restart runs, so an object that never needs it pays nothing. The
 * restart keeps the deploy it restarts for first, so restarts only move
 * forward and callers on two new deploys never take turns restarting it: an
 * object the runtime starts again on older code is where the runtime means it
 * to be, and it serves every caller no newer than the deploy it last restarted
 * for, refusing a newer one nothing (`skewed`). Running the restart fails the
 * requests in flight in the runtime's own words.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let kept = new Map<string, unknown>(), restarts: string[] = []
 * let ctx = {
 *   abort: (why?: string) => void restarts.push(why ?? ''),
 *   storage: {
 *     get: <T>(k: string) => Promise.resolve(kept.get(k) as T | undefined),
 *     put: (k: string, v: unknown) => Promise.resolve(void kept.set(k, v)),
 *   },
 * }
 * let from = (id: string, at: string) =>
 *   new Headers({ [WORKER_VERSION]: id, [WORKER_VERSION_AT]: at })
 * let mine = { id: 'a', timestamp: '2026-10-12T16:00:00Z' }
 * let b = from('b', '2026-10-12T16:30:00Z')
 * let c = from('c', '2026-10-12T16:31:00Z')
 * for (let them of [b, b, c, b, c]) await owed(them, mine, ctx)?.()
 * assertEquals(owed(from('z', '2026-10-12T15:00:00Z'), mine, ctx), null)
 * assertEquals(restarts.length, 2)
 * assertEquals(await restartedFor(ctx.storage), {
 *   id: 'c',
 *   at: '2026-10-12T16:31:00Z',
 * })
 * ```
 */
export let owed = (
  headers: Headers,
  mine: Meta | null | undefined,
  ctx: Restartable,
): (() => Promise<void>) | null => {
  let theirs = caller(headers), s = ctx.storage, abort = ctx.abort
  if (
    !theirs || !newer(theirs, versionOf(mine)) || !abort || !s.get || !s.put
  ) return null
  return async () => {
    let last = await restartedFor(s)
    if (last && !newer(theirs, last)) return
    await s.put!(RESTARTED, theirs)
    await s.sync?.()
    retiring.add(ctx)
    abort.call(ctx, `${BEHIND} ${theirs.id}`)
  }
}

/** Whether an answer refuses its caller: what an object on an older deploy
 * may say only because its code does not know what the caller's does. A 429
 * asks for a wait (a pace, an object past its rows), which no deploy changes,
 * and a restart would forget the rows that stopped the object. */
export let refused = (answer: Response): boolean =>
  answer.status >= 400 && answer.status < 500 && answer.status != 429

/** How long an object's work behind an answer waits once its caller has read
 * the answer through (`onceRead`), so the runtime has sent it on: the runtime
 * sends an answer on in turns of its own event loop, and what runs meanwhile
 * holds it, or, for a restart, cuts it off (T-149700, T-150814). */
export let BEAT = 100

/**
 * `answer`, calling `gone` once its caller has read its body through, or let
 * it go: the moment the answer has left the object. Work an object starts on
 * a timer as its handler returns runs before the runtime has sent the answer
 * on, which then waits out that work's CPU and has its writes confirmed
 * first (T-149700). An answer with no body (a socket's 101) is gone as it
 * returns.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let gone = 0
 * let answer = onceRead(new Response('ok'), () => gone++)
 * await new Promise((r) => setTimeout(r, 0))
 * assertEquals(gone, 0)
 * assertEquals([await answer.text(), gone], ['ok', 1])
 * onceRead(new Response(null, { status: 204 }), () => gone++)
 * assertEquals(gone, 2)
 * ```
 */
export let onceRead = (answer: Response, gone: () => void): Response => {
  let body = answer.body
  if (!body) {
    gone()
    return answer
  }
  let went = false
  let go = () => {
    if (!went) gone()
    went = true
  }
  let reader = body.getReader()
  let read = new ReadableStream<Uint8Array>({
    async pull(into) {
      try {
        let next = await reader.read()
        if (!next.done) return into.enqueue(next.value)
        into.close()
        go()
      } catch (e) {
        into.error(e)
        go()
      }
    },
    cancel(why) {
      go()
      return reader.cancel(why)
    },
  }, { highWaterMark: 0 })
  return new Response(read, {
    status: answer.status,
    statusText: answer.statusText,
    headers: answer.headers,
  })
}

// The words a store that runs an older deploy than its caller answers a
// refusal in. The caller's door sends a `retryable` answer again (door.ts
// `thrown`), so its retries wait for the runtime to start the store on the
// caller's deploy.
let SKEWED =
  'Durable Object on an older deploy refused a caller on a newer one:'

/**
 * The failure a refusal is, when the object that answered it runs an older
 * deploy than its caller: the runtime started it again on that older code
 * after it restarted for the caller (`owed`), so what it refused may be
 * only what its code does not know yet, a row or a door the caller's deploy
 * added. That is no mistake of the caller's: it is a failure, retryable, and
 * the store reports it. Any other answer is null.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let mine = { id: 'a', timestamp: '2026-10-12T16:00:00Z' }
 * let newer = new Headers({ [WORKER_VERSION]: 'b', [WORKER_VERSION_AT]: '2026-10-12T16:30:00Z' })
 * let no = Response.json({ error: 'Refused', message: 'unknown component release_remake' }, { status: 400 })
 * let e = await skewed(newer, mine, no)
 * assertEquals(
 *   e?.message,
 *   'Durable Object on an older deploy refused a caller on a newer one: ' +
 *     'unknown component release_remake',
 * )
 * assertEquals(e?.retryable, true)
 * assertEquals(await skewed(new Headers(), mine, no), null)
 * assertEquals(await skewed(newer, mine, new Response('ok')), null)
 * ```
 */
export let skewed = async (
  headers: Headers,
  mine: Meta | null | undefined,
  answer: Response,
): Promise<
  (Error & { retryable: true; running: string; caller: string }) | null
> => {
  let theirs = caller(headers), here = versionOf(mine)
  if (!refused(answer)) return null
  if (!theirs || !here || !newer(theirs, here)) return null
  let said = await answer.clone().json().catch(() => null) as
    | { message?: unknown }
    | null
  let why = typeof said?.message == 'string' ? said.message : answer.status
  return Object.assign(new Error(`${SKEWED} ${why}`), {
    name: 'Skewed',
    retryable: true as const,
    running: here.id,
    caller: theirs.id,
  })
}

// Which deploy of this Worker an isolate runs, and whether a caller's is newer
// (T-123372, T-123489).
//
// Cloudflare leaves a Durable Object on the code it started with for minutes
// after a deploy, so a door the deploy added answers "no route" to the new
// code calling it until the runtime gets round to restarting the object. Every
// request to an object therefore carries the version its caller runs (door.ts
// `doorOf` for a store, `fetchOf` for the Wire and the Builder), and an object
// that a newer caller reaches restarts itself on the spot (`behind`); the
// caller's retry of an evicted request (resets.ts `evicted`) then meets the new
// code.
//
// The version is the runtime's own (`CF_VERSION_METADATA`): a fresh id and
// upload time on every deploy, the same for the Worker and every object it
// binds. An isolate runs one version for its whole life, so the first
// invocation's is everyone's (defects-runtime.ts `entry`). Under `wrangler
// dev` and the test kernels there is none, and nothing is stamped or compared.

/** A Worker version: the runtime's id for it and when it was uploaded. */
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

// The words the restart fails the request in flight with: the runtime's own,
// so every caller's retry already knows them (resets.ts `evicted`).
let BEHIND = 'Durable Object reset because a newer deploy reached it:'

/** The deploy this object last restarted for, as `behind` keeps it. A record
 * in any other shape says nothing. */
export let restartedFor = async (
  storage: Restartable['storage'],
): Promise<Version | null> => {
  let kept = await storage.get<Partial<Version>>?.(RESTARTED)
  return typeof kept?.id == 'string' && typeof kept.at == 'string'
    ? { id: kept.id, at: kept.at }
    : null
}

/**
 * Restart this object, before it does anything for the request, when its
 * caller runs a later deploy than both the one it runs and the one it last
 * restarted for. Restarts only move forward, so callers on two new deploys
 * never take turns restarting it: an object the runtime starts again on older
 * code is where the runtime means it to be, and it serves every caller no
 * newer than the deploy it last restarted for.
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
 * for (let them of [b, b, c, b, c]) await behind(them, mine, ctx)
 * await behind(from('z', '2026-10-12T15:00:00Z'), mine, ctx)
 * assertEquals(restarts.length, 2)
 * assertEquals(await restartedFor(ctx.storage), {
 *   id: 'c',
 *   at: '2026-10-12T16:31:00Z',
 * })
 * ```
 */
export let behind = async (
  headers: Headers,
  mine: Meta | null | undefined,
  ctx: Restartable,
): Promise<void> => {
  let theirs = caller(headers), s = ctx.storage
  if (
    !theirs || !newer(theirs, versionOf(mine)) || !ctx.abort || !s.get ||
    !s.put
  ) return
  let last = await restartedFor(s)
  if (last && !newer(theirs, last)) return
  await s.put(RESTARTED, theirs)
  await s.sync?.()
  ctx.abort(`${BEHIND} ${theirs.id}`)
}

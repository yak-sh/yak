// Which deploy of this Worker an isolate runs, and whether a caller's is newer
// (T-123372).
//
// Cloudflare leaves a Durable Object on the code it started with for minutes
// after a deploy, so a door the deploy added answers "no route" to the new
// code calling it until the runtime gets round to restarting the object. Every
// request to a store therefore carries the version its caller runs (door.ts
// `doorOf`), and a store that a newer caller reaches restarts itself on the
// spot (graph.ts `#behind`); the caller's retry of an evicted request
// (door.ts `evicted`) then meets the new code.
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

/** The headers a request to a store says its caller's version in. */
export let VERSION = 'x-yak-version'
export let VERSION_AT = 'x-yak-version-at'

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
  headers.delete(VERSION)
  headers.delete(VERSION_AT)
  if (!version) return
  headers.set(VERSION, version.id)
  headers.set(VERSION_AT, version.at)
}

/** The caller's version, as a request to a store says it. */
export let caller = (headers: Headers): Version | null =>
  versionOf({
    id: headers.get(VERSION) ?? undefined,
    timestamp: headers.get(VERSION_AT) ?? undefined,
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

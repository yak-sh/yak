/**
 * `@yaks/workerd/cache` — local response storage and entrypoints behind
 * Cloudflare's Workers Cache.
 *
 * `[cache]` in wrangler.toml puts a two-tier cache in front of a Worker
 * entrypoint, and on a hit the entrypoint never runs. The cache key is the
 * request's path, its query and the entrypoint, never its hostname, so the
 * entrypoint an eyeball reaches is no place for one when hostnames are
 * tenants. The gateway pattern puts the cache on an inner entrypoint instead,
 * which the gateway reaches through a service binding at an address that
 * names the tenant. What may be kept there, and under which address, is the
 * host's to say; this is the runtime's side of it:
 *
 * - {@link stored} reads and fills a local Cache API store, without tier
 *   routing or a cache-fill lock. A miss draws its own answer immediately.
 * - {@link through} asks the inner entrypoint through its binding, and where
 *   the runtime can't take that hop, or the cache fails, answers in-process.
 * - {@link hit} says whether an answer came from the cache.
 * - {@link purging} is the `purge(tags)` the inner entrypoint answers, the
 *   only place its own cache can be purged from (`@yaks/workerd/purge`).
 *
 * ```ts
 * import { hit, through } from '@yaks/workerd/cache'
 * import { assert } from '@std/assert'
 * let kept = { headers: { 'cf-cache-status': 'HIT' } }
 * let cache = { fetch: async () => new Response('kept', kept) }
 * let drawn = async () => new Response('drawn')
 * let asked = new Request('https://files.invalid/app/style.css')
 * assert(hit(await through(cache, asked, drawn)))
 * assert(!hit(await through(undefined, asked, drawn)))
 * ```
 *
 * @module
 */
import { evicted, jittered, retried } from '@yaks/durable-object/resets'
import { type Clock, within } from '@yaks/fp'
import type { Purged } from './purge.ts'

// What `cf-cache-status` says of an answer the cache gave: a fresh one, or a
// stale one it gives while it asks the entrypoint again behind it.
let HITS = ['HIT', 'UPDATING', 'STALE']

/** Whether Cloudflare's cache answered this, and not the entrypoint behind
 * it. */
export let hit = (res: Response): boolean =>
  HITS.includes(res.headers.get('cf-cache-status') ?? '')

/** A service binding to an entrypoint. */
export type Bound = { fetch(req: Request): Promise<Response> }

/** A local response cache. A miss never starts an origin request or waits
 * for another request's fill. Cloudflare's Cache API supplies this boundary. */
export type Stored = {
  match(req: Request): Promise<Response | undefined>
  put(req: Request, res: Response): Promise<unknown>
}

// How long a read waits on a local cache before it draws its own answer. A
// match answers in a few milliseconds, but Cloudflare's Cache API now and then
// holds one for seconds while the origin would have answered in a tenth of
// one (T-1112). Past this, the cache is slower than what it saves.
let GLANCE = 500

/** How {@link stored} waits on its cache, and hears of one that failed. */
export type Shelving = {
  /** keeps a fill going behind the answer (`ctx.waitUntil`) */
  hold: (work: Promise<void>) => void
  /** told of a cache that could not be opened, matched or filled */
  failed: (error: unknown) => void
  /** the clock `patience` is heard on */
  clock?: Clock
  /** how long opening and matching may take, in ms; 500 unless said */
  patience?: number
}

/** Read a local cache, drawing a miss immediately and retaining its fill
 * behind the answer. Only explicitly public, whole GET responses are stored;
 * HEAD and Range can read an existing entry without replacing it. A cache
 * that has not answered within `patience` is read around: the answer is
 * drawn, and nothing is filled into a cache that is not keeping up. That is
 * not a failure, since the read costs no more than a miss. */
export let stored = async (
  cache: Stored | (() => Promise<Stored>),
  req: Request,
  draw: (req: Request) => Promise<Response>,
  { hold, failed, clock, patience = GLANCE }: Shelving,
): Promise<Response> => {
  let read = ['GET', 'HEAD'].includes(req.method) &&
    !req.headers.has('authorization') && req.cache != 'no-store'
  if (!read) return draw(req)
  let key = new Request(req, { method: 'GET' })
  let shelf: Stored | undefined
  let lapsed = false
  try {
    let matching = (async () => {
      shelf = typeof cache == 'function' ? await cache() : cache
      return await shelf.match(key)
    })()
    let found = await within(matching, patience, clock)
    if (found === null) {
      lapsed = true
      matching.then((late) => late?.body?.cancel(), () => {})
    } else if (found) {
      let headers = new Headers(found.headers)
      headers.set('cf-cache-status', 'HIT')
      if (req.method == 'HEAD') await found.body?.cancel()
      return new Response(req.method == 'HEAD' ? null : found.body, {
        status: found.status,
        headers,
      })
    }
  } catch (error) {
    failed(error)
  }
  let answer = await draw(req)
  if (shelf && !lapsed && req.method == 'GET' && cacheable(answer)) {
    let copy = answer.clone()
    let opened = shelf
    hold(
      Promise.resolve().then(() => opened.put(key, copy)).then(
        () => {},
        failed,
      ),
    )
  }
  return answer
}

let cacheable = (res: Response) => {
  let control = res.headers.get('cache-control') ?? ''
  return [200, 301, 302, 307, 308, 404, 410].includes(res.status) &&
    /\bpublic\b/i.test(control) &&
    !/\b(private|no-store|no-cache)\b/i.test(control) &&
    !res.headers.has('set-cookie') && res.headers.get('vary') != '*'
}

/** A cacheable blob under an internal, immutable key. Missing bytes are
 * read again on the next request. */
export let immutableBytes = (bytes: Uint8Array<ArrayBuffer> | null): Response =>
  bytes
    ? new Response(bytes, {
      headers: { 'cache-control': 'public, max-age=86400' },
    })
    : new Response(null, {
      status: 404,
      headers: { 'cache-control': 'private, no-store' },
    })

/** Keep immutable bytes under an internal cache key. */
export let storedBytes = async (
  cache: Stored | (() => Promise<Stored>),
  key: string,
  read: () => Promise<Uint8Array<ArrayBuffer> | null>,
  options: Shelving,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  let response = await stored(
    cache,
    new Request(key),
    async () => immutableBytes(await read()),
    options,
  )
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null
}

/** Give a shared cache a short head start over an immutable origin read,
 * then take whichever answers first. A fill keeps running independently of
 * the response, bounded to two seconds. */
export let sharedBytes = async (
  cache: Bound,
  key: string,
  read: () => Promise<Uint8Array<ArrayBuffer> | null>,
  { hold, failed, clock, patience = 25 }: Shelving,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  let signal = AbortSignal.timeout(2_000)
  let cached = cache.fetch(new Request(key, { signal, redirect: 'manual' }))
    .then(async (response) => {
      if (response.status == 200) {
        return new Uint8Array(await response.arrayBuffer())
      }
      await response.body?.cancel()
      if (response.status != 404) {
        throw new Error(`shared cache returned ${response.status}`)
      }
      return null
    }).catch((error) => {
      if (!signal.aborted) failed(error)
      return null
    })
  let first = await within(cached, patience, clock)
  if (first) return first
  let origin = read()
  hold(within(cached, 2_000, clock).then(() => {}))
  return await Promise.race([origin, cached.then((bytes) => bytes ?? origin)])
}

// How long a read waits on the cache before it is answered in-process. A miss
// goes the long way round in most of a second; a cache that holds an answer
// back holds it for a minute or more (T-153286).
let PATIENCE = 5_000

/** How {@link through} waits between tries and on the cache, and hears of a
 * cache that failed it. */
export type Through = {
  /** the clock the backoff between tries, and the patience, wait on */
  clock?: Clock
  /** told of a status Cloudflare's cache answered for want of an answer */
  failed?: (res: Response, req: Request) => void
  /** how long a read waits on the cache, in ms; 5 s unless said. Infinity
   * waits the hop out, for a read only the entrypoint's origin can answer,
   * which answering in-process would ask a second time. */
  patience?: number
  /** told of a read the cache did not answer within `patience`, whose
   * in-process answer then came back whole */
  held?: (req: Request, ms: number) => void
}

/**
 * The entrypoint bound as `cache`'s answer to `req`, or `local`'s, made
 * in-process from the same request, where there is no binding or the
 * runtime refuses or fails the hop:
 *
 * - Inside an invocation that may not serialize a service stub (a dispatched
 *   Worker's call back into its platform), the runtime refuses the hop with
 *   `DataCloneError` (T-44804), and no header says beforehand that it will.
 * - A status from 520 to 530 is Cloudflare's cache saying it got no answer
 *   from the entrypoint behind it, which `failed` is told of.
 * - A reset or a dropped connection fails the hop retryably; a read carries
 *   no body, so each try sends a copy of it with a store call's backoff
 *   (`@yaks/durable-object/resets` `retried`). Anything with a body is its
 *   caller's to send again.
 * - A read the cache has not answered within `patience` is given up on and
 *   answered in-process: the cache can hold a burst of misses back for a
 *   minute while the entrypoint behind it has long answered. `held` is told
 *   only when that answer comes back whole, which says the cache held back
 *   what could be given. One that fails too, or is a server error, says the
 *   origin was slow, not the cache (a bucket retrying through a blip), and
 *   that failure is what reports it, once, where it happened.
 */
export let through = async (
  cache: Bound | undefined,
  req: Request,
  local: (req: Request) => Promise<Response>,
  { clock, failed, patience = PATIENCE, held }: Through = {},
): Promise<Response> => {
  if (!cache) return await local(req)
  try {
    let read = req.method == 'GET' || req.method == 'HEAD'
    let stop = new AbortController()
    let signal = AbortSignal.any([req.signal, stop.signal])
    let asking = retried(
      () => cache.fetch(read ? new Request(req, { signal }) : req),
      read,
      evicted,
      jittered(clock),
    )
    let answer = read && patience < Infinity
      ? await within(asking, patience, clock)
      : await asking
    if (!answer) {
      stop.abort()
      asking.then((late) => late.body?.cancel(), () => {})
      let drawn = await local(req)
      if (drawn.status < 500) held?.(req, patience)
      return drawn
    }
    if (answer.status < 520 || answer.status > 530) return answer
    await answer.body?.cancel()
    failed?.(answer, req)
  } catch (e) {
    if ((e as Error | null)?.name != 'DataCloneError') throw e
  }
  return await local(req)
}

/** What the runtime lends an entrypoint whose cache is on: `ctx.cache`. */
export type EntryCache = { purge(o: { tags: string[] }): Promise<Purged> }

/** The `purge(tags)` an entrypoint behind the cache answers, through the
 * cache the runtime lent it. An entrypoint asked to purge with no cache in
 * front is bound where it shouldn't be, so that is a refusal, not a no-op. */
export let purging =
  (cache?: EntryCache) => async (tags: string[]): Promise<Purged> => {
    if (!cache) {
      return {
        success: false,
        errors: [{ code: 0, message: 'no cache to purge' }],
      }
    }
    let { success, errors } = await cache.purge({ tags })
    return {
      success,
      errors: errors.map(({ code, message }) => ({ code, message })),
    }
  }

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
import { type Clock, heard } from '@yaks/fp'
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

/** Read a local cache, drawing a miss immediately and retaining its fill
 * behind the answer. Only explicitly public, whole GET responses are stored;
 * HEAD and Range can read an existing entry without replacing it. */
export let stored = async (
  cache: Stored | (() => Promise<Stored>),
  req: Request,
  draw: (req: Request) => Promise<Response>,
  { hold, failed }: {
    hold: (work: Promise<void>) => void
    failed: (error: unknown) => void
  },
): Promise<Response> => {
  let read = ['GET', 'HEAD'].includes(req.method) &&
    !req.headers.has('authorization') && req.cache != 'no-store'
  if (!read) return draw(req)
  let key = new Request(req, { method: 'GET' })
  let shelf: Stored | undefined
  try {
    shelf = typeof cache == 'function' ? await cache() : cache
    let found = await shelf.match(key)
    if (found) {
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
  if (shelf && req.method == 'GET' && cacheable(answer)) {
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
  /** how long a read waits on the cache, in ms; 5 s unless said */
  patience?: number
  /** told of a read the cache did not answer within `patience` */
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
 *   answered in-process, which `held` is told of: the cache can hold a burst
 *   of misses back for a minute while the entrypoint behind it has long
 *   answered.
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
    let answer = read ? await within(asking, patience, clock) : await asking
    if (!answer) {
      stop.abort()
      asking.then((late) => late.body?.cancel(), () => {})
      held?.(req, patience)
      return await local(req)
    }
    if (answer.status < 520 || answer.status > 530) return answer
    await answer.body?.cancel()
    failed?.(answer, req)
  } catch (e) {
    if ((e as Error | null)?.name != 'DataCloneError') throw e
  }
  return await local(req)
}

// What `asking` answers within `ms` heard on `clock` (@yaks/fp `heard`), or
// null once they lapse.
let within = <T>(asking: Promise<T>, ms: number, clock?: Clock) =>
  new Promise<T | null>((resolve, reject) => {
    let cancel = heard(ms, () => resolve(null), clock)
    asking.then(resolve, reject).finally(cancel)
  })

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

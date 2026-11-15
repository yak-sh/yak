/**
 * `@yaks/workerd/cache` — an entrypoint behind Cloudflare's cache, as the
 * runtime offers one.
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
import type { Clock } from '@yaks/fp'
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

/** How {@link through} waits between tries, and hears of a cache that failed
 * it. */
export type Through = {
  /** the clock the backoff between tries waits on */
  clock?: Clock
  /** told of a status Cloudflare's cache answered for want of an answer */
  failed?: (res: Response, req: Request) => void
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
 */
export let through = async (
  cache: Bound | undefined,
  req: Request,
  local: (req: Request) => Promise<Response>,
  { clock, failed }: Through = {},
): Promise<Response> => {
  if (!cache) return await local(req)
  try {
    let read = req.method == 'GET' || req.method == 'HEAD'
    let answer = await retried(
      () => cache.fetch(read ? new Request(req) : req),
      read,
      evicted,
      jittered(clock),
    )
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

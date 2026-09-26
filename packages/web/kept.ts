// A body the page loads, made on its first request (or as the host starts) and
// kept for the life of the process. Making it is bounded: one that has not
// settled within the limit is aborted, which kills whatever it spawned, and
// counts as a failure. A failure is never kept: it is reported once, where it
// happened, and the next request makes the body again. So a build that hangs
// heals on its own, without anybody restarting the host. A make still going
// when its host closes is aborted too, so nothing it spawned outlives the host.

import { fault } from '@yaks/api'

export type Body = string | Uint8Array<ArrayBuffer>

/** How long a body may take to make before it is given up on. The app bundle
 * takes about a second; a hung one never finishes (T-38240). */
export let LIMIT = 60_000

let sha = async (body: Body) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof body == 'string' ? new TextEncoder().encode(body) : body,
      ),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)

// A body the browser may keep, revalidated on each load by its hash.
let tagged = async (request: Request, body: Body, type: string) => {
  let tag = `"${await sha(body)}"`
  let headers = { 'content-type': type, 'cache-control': 'no-cache', etag: tag }
  return request.headers.get('if-none-match') == tag
    ? new Response(null, { status: 304, headers })
    : new Response(body, { headers })
}

/** `make(signal)`, given up on (and `signal` aborted) after `limit` ms, or
 * once `closing` aborts. */
export let within = <T>(
  limit: number,
  make: (signal: AbortSignal) => Promise<T>,
  closing?: AbortSignal,
): Promise<T> =>
  new Promise((resolve, reject) => {
    let stop = new AbortController()
    let quit = (why: string) => {
      stop.abort()
      reject(new Error(why))
    }
    if (closing?.aborted) return quit('the host is closing')
    let timer = setTimeout(
      () => quit(`not made within ${limit / 1000}s`),
      limit,
    )
    let close = () => quit('the host is closing')
    closing?.addEventListener('abort', close, { once: true })
    make(stop.signal).then(resolve, reject).finally(() => {
      clearTimeout(timer)
      closing?.removeEventListener('abort', close)
    })
  })

/** The handler that answers `where` with the body `make` makes. `early` starts
 * making it now, so the first request finds it made; `closing` is the host's
 * own signal, which ends a make still going. */
export let kept = (
  where: string,
  type: string,
  make: (signal: AbortSignal) => Promise<Body>,
  { early = false, limit = LIMIT, closing }: {
    early?: boolean
    limit?: number
    closing?: AbortSignal
  } = {},
) => {
  let made: Promise<Body> | undefined
  let attempt = () => {
    let now = within(limit, make, closing)
    made = now
    now.catch((e) => {
      if (made == now) made = undefined
      if (!closing?.aborted) fault(e, `GET ${where}`)
    })
    return now
  }
  if (early) attempt()
  return async (request: Request) => {
    try {
      return await tagged(request, await (made ?? attempt()), type)
    } catch (e) {
      return new Response(String((e as Error).message ?? e), { status: 500 })
    }
  }
}

// How a refusal reaches the caller. Every endpoint in this package answers a
// thrown error the same way: the error's own name, its message, and whatever
// fields it carries, as JSON — so a client reads the same shape `apply()`
// threw, not a prose translation of it. A stale precondition still reports
// which property moved and what the graph holds now; a refused property still
// names itself.
//
// The HTTP status is derived from the error's `name` alone, by @yaks/graph's
// `status`: the one table every door reads to tell a caller's refusal from a
// defect, which any package's error joins by setting its own `name`.

import { status } from '@yaks/graph'

/** A refusal, as a client reads it: the error's name, its message, and any
 * fields the error carried (a {@link https://jsr.io/@yaks/graph | Stale}
 * precondition's `eid`, `comp`, `prop` and `current`, say). */
export type Refusal = {
  /** the error's name — `Refused`, `Stale`, `Unsupported`, `Unknown`,
   * `Ambiguous`, `Unauthorized`, `Denied` */
  error: string
  /** what was wrong, in the error's own words */
  message: string
  /** whatever else the error carried */
  [detail: string]: unknown
}

/** The request could not be authenticated. Throw this from an
 * {@link https://jsr.io/@yaks/api/doc/~/Authenticate | Authenticate} to answer
 * a request with a 401. */
export class Unauthorized extends Error {
  /** @param message what the caller is missing (default: `not authenticated`) */
  constructor(message = 'not authenticated') {
    super(message)
    this.name = 'Unauthorized'
  }
}

/** An error as the body a client reads: its name as `error`, its message, and
 * every other field it carries. */
export let refusal = (err: unknown): Refusal => {
  let e = err instanceof Error ? err : new Error(String(err))
  let out: Refusal = { error: e.name, message: e.message }
  for (let [k, v] of Object.entries(e)) {
    if (k != 'name' && k != 'message' && k != 'stack') out[k] = v
  }
  return out
}

/** A server failure, said on the console with where it happened, so a
 * calling program's log watcher sees it; a refusal (below 500) is the
 * caller's and says nothing. */
export let fault = (err: unknown, where: string): void => {
  if (status(err) >= 500) console.error(`${where} failed —`, err)
}

/** A JSON response. */
export let json = (body: unknown, code = 200): Response =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })

/** A thrown error as its response: the refusal body, at its HTTP status. When
 * a request is supplied, server failures are logged with the method and path,
 * never the query string, headers or body. Expected client refusals are not
 * logged at all. */
export let refuse = (err: unknown, request?: Request): Response => {
  if (request) fault(err, `${request.method} ${new URL(request.url).pathname}`)
  return json(refusal(err), status(err))
}

// How a refusal reaches the caller. Every door in this package answers a
// thrown error the same way: the error's own name, its message, and whatever
// fields it carries, as JSON — so a client reads the SAME shape `apply()`
// threw, not a prose translation of it. A stale precondition still says which
// column moved and what the graph holds now; a refused column still names
// itself.
//
// The status is derived from the error's `name` alone. That keeps this table
// the one place statuses are decided, and lets any package's error join it by
// naming itself.

/** A refusal, as a client reads it: the error's name, its message, and any
 * fields the error carried (a {@link https://jsr.io/@yaks/graph | Stale}
 * precondition's `eid`, `comp`, `column` and `current`, say). */
export type Refusal = {
  /** the error's name — `Refused`, `Stale`, `Unsupported`, `Unauthorized`,
   * `Denied` */
  error: string
  /** what was wrong, in the error's own words */
  message: string
  /** whatever else the error carried */
  [detail: string]: unknown
}

/** The door refused to say who is writing. Throw this from an
 * {@link https://jsr.io/@yaks/api/doc/~/Authenticate | Authenticate} to answer
 * a request with a 401. */
export class Unauthorized extends Error {
  /** @param message what the caller is missing (default: `not authenticated`) */
  constructor(message = 'not authenticated') {
    super(message)
    this.name = 'Unauthorized'
  }
}

/** The status each error name answers with. Anything unlisted is a 500: an
 * error nobody named is a bug in the server, not a fault of the request. */
export let STATUS: Record<string, number> = {
  Refused: 400,
  Unsupported: 400,
  SyntaxError: 400,
  Unauthorized: 401,
  // The door knows who is asking; the answer is still no. @yaks/member's
  // `Denied` is this, and so is any other policy refusal that names itself so.
  Denied: 403,
  NotFound: 404,
  Stale: 409,
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

/** The HTTP status an error answers with (default 500). */
export let status = (err: unknown): number =>
  (err instanceof Error ? STATUS[err.name] : undefined) ?? 500

/** A JSON response. */
export let json = (body: unknown, code = 200): Response =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })

/** A thrown error as its response: the refusal body, at its status. */
export let refuse = (err: unknown): Response => json(refusal(err), status(err))

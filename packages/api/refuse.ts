// How a refusal reaches the caller. Every endpoint in this package answers a
// thrown error the same way: the error's own name, its message, and whatever
// fields it carries, as JSON — so a client reads the same shape `apply()`
// threw, not a prose translation of it. A stale precondition still reports
// which property moved and what the graph holds now; a refused property still
// names itself, and a write that did not fit the vocabulary says
// `misfit: true` (@yaks/graph `Misfit`).
//
// The HTTP status is derived from the error's `name` alone, by @yaks/graph's
// `status`: the one table every door reads to tell a caller's refusal from a
// defect, which any package's error joins by setting its own `name`.

import { stringify } from '@yaks/vocab/wire'
import { status } from '@yaks/graph/errors'

/** A refusal, as a client reads it: the error's name, its message, and any
 * fields the error carried (a {@link https://jsr.io/@yaks/graph | Stale}
 * precondition's `eid`, `comp`, `prop` and `current`, say). */
export type Refusal = {
  /** the error's name — `Refused`, `Stale`, `Unsupported`, `Unknown`,
   * `Unauthorized`, `Denied` */
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

// Where a server failure goes: the reporter its host installed last, else the
// console, so a failure met before any host installs one is still said.
let reporters: ((err: unknown, where: string) => void)[] = []
let said = (err: unknown, where: string) =>
  console.error(`${where} failed —`, err)

/** Report every server failure this package catches to `report`, with where
 * it was caught: the host's own reporter, which tells its tracker. A failure
 * answered to its caller and one with no caller at all (a socket's message, a
 * subscription's refresh, a page body that did not build) go the same way.
 * The newest installed is the one told; the function returned removes it. */
export let faults = (
  report: (err: unknown, where: string) => void,
): () => void => {
  reporters.push(report)
  return () => {
    let at = reporters.lastIndexOf(report)
    if (at >= 0) reporters.splice(at, 1)
  }
}

/** A server failure, reported with where it happened to the host's reporter
 * ({@link faults}), or said on the console while none is installed; a refusal
 * (below 500) is the caller's and says nothing. */
export let fault = (err: unknown, where: string): void => {
  if (status(err) < 500) return
  let report = reporters.at(-1) ?? said
  try {
    report(err, where)
  } catch (why) {
    said(err, where)
    said(why, `reporting ${where}`)
  }
}

// The requests a watch is answering (./request.ts `served`), each with the
// failure `refuse` answered it with: the watch reports that failure once, with
// its request. A failure answered where nothing watches is reported here.
let watched = new WeakMap<Request, unknown>()
export let watch = (request: Request): void =>
  void watched.set(request, undefined)
export let cause = (request: Request): unknown => watched.get(request)

/** A JSON response. */
export let json = (body: unknown, code = 200): Response =>
  new Response(stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })

/** A thrown error as its response: the refusal body, at its HTTP status. A
 * server failure is reported once: by the watch the request is answered under
 * (`served`), with its request, or else here ({@link fault}), with the method
 * and path when a request is supplied, never the query string, headers or
 * body. An expected client refusal is not reported at all. */
export let refuse = (err: unknown, request?: Request): Response => {
  let code = status(err)
  if (request && watched.has(request)) {
    if (code >= 500) watched.set(request, err)
  } else {
    fault(
      err,
      request
        ? `${request.method} ${new URL(request.url).pathname}`
        : 'request',
    )
  }
  return json(refusal(err), code)
}

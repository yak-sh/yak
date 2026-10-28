// The box shares one signed tracker transport for reads, intake and bug marks.
// Credentials are read at use time and never reach redirects or error text.
//
// The path to the Worker can go bad for one connection while a new one is
// fine: each connection from the box lands in one of several Cloudflare
// colos, and the path to some of them loses packets for minutes at a time (a
// TLS handshake of ten seconds, an answer that never comes). The tracker's
// Durable Object can also stop answering for half a minute while the runtime
// stalls or moves it. So a request is short attempts for up to a minute, each
// on a connection of its own, with a ticket a minute from expiry, and taking
// its whole answer, never one long wait on a connection gone bad.
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { sign } from './ticket.ts'

export type Remote = { url?: string; secret?: string }

/** A sink whose delivery is always a promise, so a caller can wait for it and
 * read why it failed. */
export type Delivery = (rows: Bundle[]) => Promise<void>

/** How long one attempt may take to its whole answer, and how many attempts a
 * request makes: a minute in all. */
let WAIT = 5_000, TRIES = 12

/** A failure a timeout caused. It is named as one; any other failure names no
 * cause, since a cause can carry the address or the upstream's body. */
export let late = (error: unknown) =>
  error instanceof DOMException && error.name == 'TimeoutError'

/// unavailable(503) -> true
/// unavailable(429) -> true
/// unavailable(403) -> false
/** Whether an answer's status says the tracker cannot answer for now (it timed
 * out, is busy, or failed on its side), which a later try can recover from;
 * any other refusal is its answer to what was asked. */
export let unavailable = (status: number) =>
  status == 408 || status == 429 || status >= 500

/** A request the tracker could not answer for now, which a later try can
 * recover from: no attempt was answered, or it answered a status `unavailable`
 * names. Anything else that fails is a refusal of what was asked, or a failure
 * on this side. */
export class Unavailable extends Error {}

/// unanswered(new DOMException('', 'TimeoutError')) instanceof Unavailable -> true
/// unanswered(new DOMException('', 'AbortError')) instanceof Unavailable -> false
/** `error`, or the `Unavailable` it is when a timeout caused it. */
export let unanswered = (error: unknown): unknown =>
  late(error) ? new Unavailable('Remote tracker did not answer in time') : error

// One attempt on a connection of its own, closed once the whole answer is in
// hand. Outside Deno the runtime owns the connections.
let attempt = async (go: typeof fetch, url: URL, init: RequestInit) => {
  let client = globalThis.Deno?.createHttpClient({})
  let own: RequestInit & { client?: Deno.HttpClient } = { ...init, client }
  try {
    let response = await go(url, client ? own : init)
    return new Response(response.body && await response.arrayBuffer(), response)
  } finally {
    client?.close()
  }
}

// The Worker's door for each mark, by the mark's name; a reopening takes a
// resolution back.
let doors = {
  resolved: 'resolve',
  archived: 'archive',
  taken: 'take',
  reopened: 'reopen',
}
let marks: string[] = Object.values(doors)

export let request = async (
  remote: Remote,
  path: string,
  params: URLSearchParams,
  init: RequestInit = {},
  go: typeof fetch = fetch,
): Promise<Response> => {
  if (!remote.url || !remote.secret) {
    throw Error('Remote tracker is unavailable')
  }
  let url: URL
  try {
    url = new URL(remote.url)
  } catch {
    throw Error('Remote tracker address is invalid')
  }
  if (
    url.username || url.password ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.protocol == 'http:' &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  ) throw Error('Remote tracker address is invalid')
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
  url.search = params.toString()
  url.hash = ''
  let scope = params.get('scope') ?? 'platform'
  let claims = {
    scope: scope == 'platform' ? derivedEid('tracker|platform') : scope,
    person: 'box-tracker',
    admin: true,
    ...path == 'errors' ? { ingest: true } : {},
    ...marks.includes(path) ? { mark: true } : {},
  }
  let last: unknown
  // Signing is deterministic: attempts within one second carry the same
  // ticket, so it is signed and set once a second, not once an attempt.
  let exp = 0, headers = new Headers()
  for (let i = 0; i < TRIES; i++) {
    let wait = AbortSignal.timeout(WAIT)
    let now = Math.floor(Date.now() / 1000) + 60
    if (now != exp) {
      exp = now
      headers = new Headers(init.headers)
      headers.set(
        'authorization',
        `Bearer ${await sign({ ...claims, exp }, remote.secret)}`,
      )
    }
    try {
      return await attempt(go, url, {
        ...init,
        headers,
        redirect: 'error',
        signal: init.signal ? AbortSignal.any([init.signal, wait]) : wait,
      })
    } catch (error) {
      last = error
      // The caller's own deadline or stop ends the request; an attempt's own
      // deadline means another try, on a new connection.
      if (init.signal?.aborted) {
        if (!late(init.signal.reason)) init.signal.throwIfAborted()
        break
      }
    }
  }
  throw late(last)
    ? new DOMException('Remote tracker did not answer in time', 'TimeoutError')
    : new Unavailable('Remote tracker is unavailable')
}
export let delivery =
  (remote: Remote, go: typeof fetch = fetch): Delivery => async (rows) => {
    let response = await request(
      remote,
      'errors',
      new URLSearchParams({ scope: 'platform' }),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rows),
      },
      go,
    ).catch((error) => {
      throw unanswered(error)
    })
    await response.body?.cancel()
    if (!response.ok) {
      let refusal = `Remote tracker refused intake (${response.status})`
      throw unavailable(response.status)
        ? new Unavailable(refusal)
        : Error(refusal)
    }
  }

/// marking('a', 'resolved', { cause: 'a race', recur: 'no' }) -> { door: 'resolve', body: '{"bug":"a","cause":"a race","recur":"no"}' }
/// marking('b', 'archived') -> { door: 'archive', body: '{"bug":"b"}' }
/// marking('c', 'reopened') -> { door: 'reopen', body: '{"bug":"c"}' }
/// marking('d', 'taken', { task: 'T-7' }) -> { door: 'take', body: '{"bug":"d","task":"T-7"}' }
/** The Worker's door a mark goes to, and what it says there: the bug, and
 * what the mark says (a resolution's explanation, a fixer's `task`). */
export let marking = (
  bug: string,
  name: keyof typeof doors,
  said: Record<string, string> = {},
): { door: string; body: string } => ({
  door: doors[name],
  body: JSON.stringify({ bug, ...said }),
})

/** Mark a Worker copy, returning false when the Worker does not hold it. A
 * resolution carries its explanation and `taken` the fixer's `task`. */
export let mark = async (
  remote: Remote,
  bug: string,
  name: keyof typeof doors,
  go: typeof fetch = fetch,
  said: Record<string, string> = {},
): Promise<boolean> => {
  let { door, body } = marking(bug, name, said)
  let response = await request(
    remote,
    door,
    new URLSearchParams({ scope: 'platform' }),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    },
    go,
  )
  if (response.status == 404) {
    let answer = await response.json().catch(() => null)
    if (answer?.error == 'bug not found') return false
    // A Worker whose deploy has not reached its object yet answers a new door
    // as no route, while the box already sends it.
    if (answer?.error == 'tracker route not found') {
      throw Error(`Remote tracker has no ${door} door (404)`)
    }
  } else if (response.ok) {
    await response.body?.cancel()
  }
  if (!response.ok) {
    // A refusal says why (an unexplained resolution); a failure only fails.
    let why = response.status == 400
      ? (await response.json().catch(() => null))?.error
      : undefined
    throw Error(
      `Remote tracker refused the mark (${response.status})${
        why ? `: ${why}` : ''
      }`,
    )
  }
  return true
}

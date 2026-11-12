// The box shares one signed tracker transport for reads, intake and bug marks.
// Credentials are read at use time and never reach redirects or error text:
// a redirect is answered as the refusal it is, never followed. `manual` says
// so on every host; workerd refuses `redirect: 'error'` as it builds the
// request, which made every Operator read on yaks.app an outage.
//
// The path to the Worker can go bad for one connection while a new one is
// fine: each connection from the box lands in one of several Cloudflare
// colos, and the path to some of them loses packets for minutes at a time (a
// TLS handshake of ten seconds, an answer that never comes). The tracker's
// Durable Object can also stop answering for half a minute while the runtime
// stalls or moves it. A request starts with a short attempt, then gives later
// attempts longer within one minute: even unchanged reads can take over five
// seconds in the runtime. Each attempt has its own connection and takes the
// whole answer, with a ticket a minute from expiry.
import { type Clock, system } from '@yaks/fp'
import type { Bundle } from '@yaks/graph'
import { platform } from './reading.ts'
import { sign } from './ticket.ts'

export { platform }

export type Remote = { url?: string; secret?: string }

/** A sink whose delivery is always a promise, so a caller can wait for it and
 * read why it failed. */
export type Delivery = (rows: Bundle[]) => Promise<void>

/** The first attempt's wait, the whole request's budget, and the most tries
 * even when connections fail immediately. */
let WAIT = 5_000, BUDGET = 60_000, TRIES = 12

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

/** A request this side cannot set up: no address, no secret, or an address it
 * does not send to. It is a failure to fix now, never the tracker being down;
 * the remote is read at each use, so the request after a fix goes out. */
export class Misconfigured extends Error {}

/// unanswered(new DOMException('', 'TimeoutError')) instanceof Unavailable -> true
/// unanswered(new DOMException('', 'AbortError')) instanceof Unavailable -> false
/** `error`, or the `Unavailable` it is when a timeout caused it. */
export let unanswered = (error: unknown): unknown =>
  late(error) ? new Unavailable('Remote tracker did not answer in time') : error

// Each host supplies its transport; the portable default is standard fetch.
let attempt = async (go: typeof fetch, url: URL, init: RequestInit) => {
  let response = await go(url, init)
  return new Response(response.body && await response.arrayBuffer(), response)
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

// What a door answered, when it answered JSON.
let answered = (response: Response) =>
  response.json().catch(() => null) as Promise<
    { error?: string; retried?: number } | null
  >

export let request = async (
  remote: Remote,
  path: string,
  params: URLSearchParams,
  init: RequestInit = {},
  go: typeof fetch = fetch,
  clock: Clock = system,
): Promise<Response> => {
  if (!remote.url) throw new Misconfigured('Remote tracker is not configured')
  if (!remote.secret) {
    throw new Misconfigured('Remote tracker secret is unavailable')
  }
  let url: URL
  try {
    url = new URL(remote.url)
  } catch {
    throw new Misconfigured('Remote tracker address is invalid')
  }
  if (
    url.username || url.password ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.protocol == 'http:' &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  ) throw new Misconfigured('Remote tracker address is invalid')
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
  url.search = params.toString()
  url.hash = ''
  let scope = params.get('scope') ?? 'platform'
  let claims = {
    scope: scope == 'platform' ? platform : scope,
    person: 'box-tracker',
    admin: true,
    ...path == 'errors' ? { ingest: true } : {},
    ...[...marks, 'retry', 'settle', 'resume'].includes(path)
      ? { mark: true }
      : {},
  }
  let last: unknown, until = clock.now() + BUDGET
  // Signing is deterministic: attempts within one second carry the same
  // ticket, so it is signed and set once a second, not once an attempt.
  let exp = 0, headers = new Headers()
  for (let i = 0; i < TRIES && clock.now() < until; i++) {
    let now = Math.floor(clock.now() / 1000) + 60
    if (now != exp) {
      exp = now
      headers = new Headers(init.headers)
      headers.set(
        'authorization',
        `Bearer ${await sign({ ...claims, exp }, remote.secret)}`,
      )
    }
    let left = until - clock.now()
    if (left <= 0) {
      last = new DOMException('Signal timed out.', 'TimeoutError')
      break
    }
    let wait = new AbortController()
    let cancel = clock.after(
      Math.min(WAIT * 2 ** i, left),
      () => wait.abort(new DOMException('Signal timed out.', 'TimeoutError')),
    )
    try {
      return await attempt(go, url, {
        ...init,
        headers,
        redirect: 'manual',
        signal: init.signal
          ? AbortSignal.any([init.signal, wait.signal])
          : wait.signal,
      })
    } catch (error) {
      last = error
      // The caller's own deadline or stop ends the request; an attempt's own
      // deadline means another try, on a new connection.
      if (init.signal?.aborted) {
        if (!late(init.signal.reason)) init.signal.throwIfAborted()
        break
      }
    } finally {
      cancel()
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
 * resolution carries its explanation and `taken` the fixer's `task`. The
 * copy is the platform tracker's, or the tracker of the space `scope` names. */
export let mark = async (
  remote: Remote,
  bug: string,
  name: keyof typeof doors,
  go: typeof fetch = fetch,
  said: Record<string, string> = {},
  scope = 'platform',
): Promise<boolean> => {
  let { door, body } = marking(bug, name, said)
  let response = await request(
    remote,
    door,
    new URLSearchParams({ scope }),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    },
    go,
  )
  if (response.status == 404) {
    let answer = await answered(response)
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
      ? (await answered(response))?.error
      : undefined
    throw Error(
      `Remote tracker refused the mark (${response.status})${
        why ? `: ${why}` : ''
      }`,
    )
  }
  return true
}

/** The global eids of the spaces whose trackers the Worker has routed to,
 * as the platform tracker lists them. A Worker whose deploy has not reached
 * its object yet answers the list's door as no route: it lists none yet. */
export let spaces = async (
  remote: Remote,
  go: typeof fetch = fetch,
): Promise<string[]> => {
  let response = await request(
    remote,
    'scopes',
    new URLSearchParams({ scope: 'platform' }),
    {},
    go,
  ).catch((error) => {
    throw unanswered(error)
  })
  let answer = await response.json().catch(() => null) as
    | { scopes?: unknown; error?: string }
    | null
  if (response.status == 404 && answer?.error == 'tracker route not found') {
    return []
  }
  if (!response.ok) {
    let refusal =
      `Remote tracker refused its list of spaces (${response.status})`
    throw unavailable(response.status)
      ? new Unavailable(refusal)
      : Error(refusal)
  }
  let scopes = answer?.scopes
  if (!Array.isArray(scopes) || scopes.some((s) => typeof s != 'string')) {
    throw Error('Remote tracker answered no list of spaces')
  }
  return scopes
}

/** Put the Worker's failed effect runs `of` names (a handler, or one run's id)
 * back to pending once their cause is fixed, returning how many it did. */
export let retry = async (
  remote: Remote,
  of: string,
  go: typeof fetch = fetch,
): Promise<number> => {
  let response = await request(
    remote,
    'retry',
    new URLSearchParams({ scope: 'platform' }),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ of }),
    },
    go,
  )
  let answer = await answered(response)
  if (response.status == 404 && answer?.error == 'tracker route not found') {
    throw Error('Remote tracker has no retry door (404)')
  }
  if (!response.ok) {
    let why = response.status == 400 ? answer?.error : undefined
    throw Error(
      `Remote tracker refused the retry (${response.status})${
        why ? `: ${why}` : ''
      }`,
    )
  }
  return Number(answer?.retried)
}

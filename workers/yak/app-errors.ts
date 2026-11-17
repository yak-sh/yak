// The published app_errors tool reads and marks tracker occurrences under the
// space authority already checked by yak. Bug mail marks remain separate.
import { type Built, line, sub } from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import { sign } from '@yaks/tracker/ticket'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import { elapsed, recall, writing } from './lib/hops.ts'

/** One decoded tracker request. The transport owns credentials, HTTP and its deadline. */
export type Send = (path: string, init: RequestInit) => Promise<unknown>

// The space's tracker is a store like any other to the request's tally
// (hops.ts): a read asked twice is asked once, until this request writes
// there, so a read begun early (unseen.ts `foresee`) answers a later one.
let request = (
  env: Env,
  space: Space,
  who: Who,
  path: string,
  init: RequestInit = {},
  send: Send = (path, init) => sent(env, space, who, path, init),
) => {
  let store = `tracker ${space.eid}`
  let run = () => send(path, init)
  return init.method == 'POST' ? writing(store, run) : recall(store, path, run)
}

// A ticket to a space's tracker lives a minute. One is signed for each caller
// and kind of ask and carried for its first half: a burst of requests in a
// space signs once, not once a second, and every ticket sent has at least
// half a minute left. The ticket is kept, never the promise of it, so no
// request waits on work another request started.
let held = new Map<string, { secret: string; exp: number; token: string }>()

/** The ticket a read (or, with `ingest`, a mark) of a space's tracker
 * carries. */
export let ticket = async (
  env: Env,
  space: Space,
  who: Who,
  ingest = false,
) => {
  let secret = env.TRACKER_SECRET
  if (!secret) throw Error('tracker is unavailable')
  let access = {
    scope: space.eid,
    person: who.person || 'kernel',
    admin: true,
    ...ingest ? { ingest: true } : {},
  }
  let key = JSON.stringify(access)
  let now = Math.floor(Date.now() / 1000)
  let had = held.get(key)
  if (had?.secret == secret && had.exp - now > 30) return had.token
  let exp = now + 60
  let token = await sign({ ...access, exp }, secret)
  if (held.size > 1000) held.clear()
  held.set(key, { secret, exp, token })
  return token
}

// A space's tracker is a Durable Object behind the tracker Worker, which sends
// a call again while the runtime moves the object (@yaks/durable-object
// `retried`, whose pauses add up to 22.6 seconds), as each deploy does: a move
// holds or refuses calls for ten to twenty seconds. The deadline outlasts that
// and cuts off only a tracker that stopped answering, well inside the minute
// after which a request that has not answered is a defect (defects.ts
// `watched`).
let DEADLINE = 30_000

let sent = async (
  env: Env,
  space: Space,
  who: Who,
  path: string,
  init: RequestInit,
): Promise<unknown> => {
  if (!env.TRACKER) throw Error('tracker is unavailable')
  let token = await ticket(env, space, who, init.method == 'POST')
  let url = new URL(`https://tracker.internal${path}`)
  url.searchParams.set('scope', space.eid)
  let tracker = env.TRACKER
  // Named on the request's Server-Timing as `tracker_wait` (timing.ts).
  let response = await elapsed('tracker_wait', () =>
    tracker.fetch(
      new Request(url, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(DEADLINE),
      }),
    ))
  if (!response.ok) {
    throw Error(`tracker refused app errors (${response.status})`)
  }
  return response.json()
}

// The open occurrences a filter names, a page of 100 at a time.
let opened = async (
  env: Env,
  space: Space,
  who: Who,
  filter: Built,
  all: boolean,
  send?: Send,
): Promise<Bundle[]> => {
  let rows: Bundle[] = [], after = ''
  let seen = all ? line`` : line`!notified`
  for (;;) {
    let past = after ? line` .after=${after}` : line``
    let query = line`.error ${sub(filter)} !archived ${
      sub(seen)
    } * .order=entity.eid .limit=100${sub(past)}`
    let page = await request(
      env,
      space,
      who,
      `/query?q=${encodeURIComponent(query)}`,
      undefined,
      send,
    ) as Bundle[]
    rows.push(...page)
    if (page.length < 100) return rows
    let next = page.at(-1)!.entity.eid
    if (next == after) throw Error('tracker repeated an app error page')
    after = next
  }
}

/** Every app's open occurrences in a space, in one read of the space's
 * tracker: what a listing or a reply needs without waking any app's store. */
export let errorsIn = (env: Env, space: Space, who: Who, send?: Send) => ({
  read: (all: boolean) => opened(env, space, who, line`.during.app`, all, send),
})

export let errorsAt = (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  send?: Send,
) => ({
  read: (all: boolean) =>
    opened(env, space, who, line`.during.app=${app.eid}`, all, send),
  // How many occurrences the tracker says it marked, which is all a caller
  // may report: never the count it asked for.
  mark: async (rows: Bundle[], mark: 'notified' | 'archived') => {
    let marked = 0
    for (let at = 0; at < rows.length; at += 100) {
      let said = await request(env, space, who, '/app-errors', {
        method: 'POST',
        body: JSON.stringify({
          app: app.eid,
          eids: rows.slice(at, at + 100).map((row) => row.entity.eid),
          mark,
        }),
      }, send) as { marked?: unknown }
      if (typeof said?.marked != 'number') {
        throw Error('tracker did not say what it marked')
      }
      marked += said.marked
    }
    return marked
  },
})

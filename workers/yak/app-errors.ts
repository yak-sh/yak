// The published app_errors tool reads and marks tracker occurrences under the
// space authority already checked by yak. Bug mail marks remain separate.
import type { Bundle } from '@yaks/graph'
import { sign } from '@yaks/tracker/ticket'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import { recall, writing } from './lib/hops.ts'

// The space's tracker is a store like any other to the request's tally
// (hops.ts): a read asked twice is asked once, until this request writes
// there, so a read begun early (unseen.ts `foresee`) answers a later one.
let request = (
  env: Env,
  space: Space,
  who: Who,
  path: string,
  init: RequestInit = {},
) => {
  let store = `tracker ${space.eid}`
  let send = () => sent(env, space, who, path, init)
  return init.method == 'POST'
    ? writing(store, send)
    : recall(store, path, send)
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
  let response = await env.TRACKER.fetch(
    new Request(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    }),
  )
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
  filter: string,
  all: boolean,
): Promise<Bundle[]> => {
  let rows: Bundle[] = [], after = ''
  for (;;) {
    let query =
      `.error ${filter} !archived ${
        all ? '' : '!notified'
      } * .order=entity.eid .limit=100` + (after ? ` .after=${after}` : '')
    let page = await request(
      env,
      space,
      who,
      `/query?q=${encodeURIComponent(query)}`,
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
export let errorsIn = (env: Env, space: Space, who: Who) => ({
  read: (all: boolean) => opened(env, space, who, '.during.app', all),
})

export let errorsAt = (env: Env, space: Space, app: App, who: Who) => ({
  read: (all: boolean) =>
    opened(env, space, who, `.during.app=${app.eid}`, all),
  mark: async (rows: Bundle[], mark: 'notified' | 'archived') => {
    for (let at = 0; at < rows.length; at += 100) {
      await request(env, space, who, '/app-errors', {
        method: 'POST',
        body: JSON.stringify({
          app: app.eid,
          eids: rows.slice(at, at + 100).map((row) => row.entity.eid),
          mark,
        }),
      })
    }
  },
})

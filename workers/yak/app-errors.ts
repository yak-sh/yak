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

let sent = async (
  env: Env,
  space: Space,
  who: Who,
  path: string,
  init: RequestInit,
): Promise<unknown> => {
  if (!env.TRACKER || !env.TRACKER_SECRET) throw Error('tracker is unavailable')
  let token = await sign({
    scope: space.eid,
    person: who.person || 'kernel',
    admin: true,
    ...init.method == 'POST' ? { ingest: true } : {},
    exp: Math.floor(Date.now() / 1000) + 60,
  }, env.TRACKER_SECRET)
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

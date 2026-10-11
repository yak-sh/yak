// The published app_errors tool reads and marks tracker occurrences under the
// space authority already checked by yak. Bug mail marks remain separate.
import type { Bundle } from '@yaks/graph'
import { sign } from '@yaks/tracker/ticket'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'

let request = async (
  env: Env,
  space: Space,
  who: Who,
  path: string,
  init: RequestInit = {},
) => {
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

export let errorsAt = (env: Env, space: Space, app: App, who: Who) => ({
  read: async (all: boolean): Promise<Bundle[]> => {
    let rows: Bundle[] = [], after = ''
    for (;;) {
      let query =
        `.error .during.app=${app.eid} !archived ${
          all ? '' : '!notified'
        } * .order=entity.eid .limit=100` +
        (after ? ` .after=${after}` : '')
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
  },
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

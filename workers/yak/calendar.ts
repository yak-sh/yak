// Public calendars follow anonymous read policy. A private token selects only
// one person's accepted registrations inside its app's store.
import { calendar, type Entry } from '@yaks/events'
import { type Bundle, type Comp, derivedEid, signed } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { mode, reads } from '@yaks/member'
import { type App, appStore, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import type { Stored } from './graph.ts'
import { recognized } from './recognized.ts'

let quoted = (value: string) => JSON.stringify(value)
let fields = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}

type Feed = { entity: { eid: string }; feed: { person: string; token: string } }

/** Stable per-person link, replaced only when its person asks. */
export let personalFeed = async (
  at: Stored,
  person: string,
  replace = false,
): Promise<Feed> => {
  let eid = derivedEid(JSON.stringify(['calendar-feed', at.app, person]))
  let [held] = await at.graph.get([eid], ['feed'])
  let token = fields(held, 'feed').token
  if (typeof token == 'string' && !replace) {
    return { entity: { eid }, feed: { person, token } }
  }
  let row = { entity: { eid }, feed: { person, token: crypto.randomUUID() } }
  try {
    await at.graph.apply(signed([{
      ...row,
      ...replace ? {} : { $was: { feed: { token: null } } },
    }], { by: at.app! }))
  } catch (error) {
    if (!(error instanceof Stale) || replace) throw error
    return personalFeed(at, person)
  }
  return row
}

let response = (req: Request, rows: Entry[], privateFeed = false) =>
  new Response(req.method == 'HEAD' ? null : calendar(rows), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': privateFeed ? 'private, no-store' : 'no-cache',
      'referrer-policy': 'no-referrer',
    },
  })

/** Website sign-ups have directory people; texts have platform submitters.
 * Only what the platform proved of the person joins them (recognized.ts),
 * never a supplied answer. */
export let calendarScope = async (
  at: Stored,
  person: string,
): Promise<string> => {
  let me = await recognized(at, person)
  let ids = [...new Set([person, ...me ? [me.entity.eid] : []])]
  return `(.registration.submitter=${quoted(person)}|${
    ids.map((id) => `.registration.person=${quoted(id)}`).join('|')
  })`
}

/** Kernel-only token lookup; neither the token nor its person becomes a grant. */
export let calendarIn = async (req: Request, at: Stored): Promise<Response> => {
  let token = new URL(req.url).searchParams.get('token') ?? ''
  let [feed] = token
    ? await at.graph.read(`.feed.token=${quoted(token)}&.limit=1`)
    : []
  let person = fields(feed, 'feed').person
  if (typeof person != 'string') {
    return new Response('No such calendar.', {
      status: 404,
      headers: { 'cache-control': 'private, no-store' },
    })
  }
  let registrations = await at.graph.read(
    `${await calendarScope(at, person)}&.completed&!cancelled&!waitlisted`,
  )
  let ids = [
    ...new Set(
      registrations.map((row) => fields(row, 'registration').form).filter((
        id,
      ): id is string => typeof id == 'string'),
    ),
  ]
  let rows = ids.length
    ? await at.graph.get(ids, [
      'event',
      'doc',
      'created',
      'updated',
      'cancelled',
    ])
    : []
  return response(req, rows.filter((row) => !row.cancelled).filter(entry), true)
}

// An app can retain its own older event vocabulary. Only rows with the
// calendar aspect's starts property describe entries in this feed.
let entry = (row: Bundle): row is Bundle & Entry =>
  row.event != null && typeof row.event == 'object' &&
  'starts' in row.event && typeof row.event.starts == 'string'

export let calendarOut = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  token?: string,
): Promise<Response> => {
  if (!token && !reads(mode(app.access), null)) {
    return new Response('No public calendar here.', { status: 404 })
  }
  if (req.method != 'GET' && req.method != 'HEAD') {
    return new Response('Use GET to read the calendar.', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    })
  }
  if (token) {
    return appStore(env.STORE, space, app, env).consume(
      `/calendar?${new URLSearchParams({ token })}`,
      async (r) =>
        new Response(req.method == 'HEAD' ? null : await r.text(), r),
      { method: req.method },
      KERNEL,
    )
  }
  let rows = await metaOf(appStore(env.STORE, space, app, env)).query(
    '.event ?doc ?created ?updated !cancelled',
  )
  return response(req, rows.filter(entry))
}

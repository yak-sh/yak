// The public calendar reads as an anonymous visitor, through the ordinary
// store door, so app access and person-owned rows keep their read policy.
import { calendar, type Entry } from '@yaks/events'
import type { Bundle } from '@yaks/graph'
import { mode, reads } from '@yaks/member'
import { type App, appStore, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { metaOf } from './meta.ts'

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
): Promise<Response> => {
  if (!reads(mode(app.access), null)) {
    return new Response('No public calendar here.', { status: 404 })
  }
  if (req.method != 'GET' && req.method != 'HEAD') {
    return new Response('Use GET to read the calendar.', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    })
  }
  let rows = await metaOf(appStore(env.STORE, space, app, env)).query(
    '.event ?doc ?created ?updated !cancelled',
  )
  return new Response(
    req.method == 'HEAD' ? null : calendar(rows.filter(entry)),
    {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'cache-control': 'no-cache',
      },
    },
  )
}

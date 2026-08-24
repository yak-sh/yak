// A page, as WITNESSED — the browser extension's write door. The tab
// carries three things no other client has: the address someone is
// actually standing at, the DOM after login and JavaScript (a server
// refetch of a paywalled page archives the paywall), and the moment.
// So one door takes all three at once and lands them in ONE batch: the
// web entity for the page (found, never duplicated — url.ts normalize
// runs through the `url` PropType, so a query for the same page reaches
// the same row), whatever the `:` line asks for, and an `about` edge
// from every task that line just filed to the page it was filed from.
//
// The line is the SAME vocabulary as the board's quick-add and the web
// bar: a bare line is `:new`, and anything opening with ':' is the verb
// it names (obey.ts order() runs it, spawn and all). Nothing about
// filing from a browser earns its own grammar.
//
// Capture is optional on purpose (owner, C-7055 — "sometimes i just want
// the URL"), and it rides the existing archive path: freeze.ts store()
// with scrub on, because these bytes come off the open web and must
// render from themselves alone. Server-only.
import { apply, db, human, locate, webAt } from './db.ts'
import { dbReader } from './graph_query.ts'
import { dispatch, trace } from './effects.ts'
import { filing } from './commands.ts'
import { order } from './obey.ts'
import { store } from './freeze.ts'
import { type Change } from './types.ts'
import { normalize } from './url.ts'

type Cast = (changes: Change[]) => void

export type Filing = {
  url?: string
  title?: string
  html?: string
  line?: string
  session?: string
}

export let filed = async (body: Filing, cast: Cast) => {
  let url = normalize(String(body.url ?? ''))
  if (!/^https?:\/\/./.test(url)) {
    return new Response('a http(s) url is required', { status: 400 })
  }
  // Find-or-mint the page by its normalized URL — a keyed read, never a
  // whole-graph snapshot (M-21143).
  let pageEid = webAt(db, url)
  let page = pageEid ? dbReader(db).find(pageEid) : undefined
  let eid = pageEid ?? crypto.randomUUID()
  let changes: Change[] = []
  if (!page) changes.push({ eid, name: 'web', comp: { eid, url } })
  // The tab's title names the page until an archive does (freeze.ts land()
  // adopts one the same way) — and only while the page has no doc of its
  // own, so a title someone wrote by hand is never overwritten by a visit.
  let title = String(body.title ?? '').trim()
  if (title && !page?.comps.doc) {
    changes.push({ eid, name: 'doc', comp: { eid, title, body: '' } })
  }

  let said = ''
  let filed: string[] = []
  let line = String(body.line ?? '').trim()
  if (line) {
    // The page is the focus the line runs against, so it must be in the
    // graph the verbs read — when just minted it isn't applied yet, so it
    // rides as an overlay on the reader.
    let g = dbReader(
      db,
      page ? [] : [{
        eid,
        num: 0,
        kind: 'web',
        comps: { web: { eid, url } },
      }],
    )
    let out = order(g, filing(line), eid, body.session)
    said = out.said
    // Everything the line BROUGHT INTO BEING that is a task is about this
    // page. Standing somewhere is why you filed it — the same reason a
    // board's quick-add adopts the board's query. A task change on an eid the
    // graph already holds is an update, not a new filing.
    filed = [
      ...new Set(
        out.changes
          .filter((c) => c.name == 'task' && c.comp && !locate(db, c.eid))
          .map((c) => c.eid),
      ),
    ]
    changes.push(
      ...out.changes,
      ...filed.map((from) => ({
        eid: from,
        name: 'dependency',
        comp: { type: 'about', child: eid },
      })),
    )
  }

  try {
    let t = trace()
    let out = apply(db, changes, t, body.session)
    cast(out)
    dispatch(out, t, (c, e) => console.warn(`page effect ${c} —`, e))
  } catch (e) {
    return new Response((e as Error).message, { status: 400 })
  }
  // After the batch, never inside it: store() needs the web row on disk's
  // behalf, and an archive is a file plus a server-stamped frozen_at.
  if (body.html) await store(eid, body.html, cast, true)
  return Response.json({
    page: human(db, eid),
    url,
    filed: filed.map((f) => human(db, f)),
    msg: said,
  })
}

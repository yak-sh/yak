// What breaks in the platform's own pages: the reporter (public/report.js),
// named first in every page's head (sheets.ts `links`), posts here, at the
// apex's `/api/report`, and each break enters the tracker as a platform
// defect tagged with the page it happened on and the browser that sent it
// (`agent`, its user agent, as the box's door tags it). An app's page runs the
// same reporter and @yaks/tracker/report reads both, but reports to its own door (apps.ts),
// where the break is the app's and its owner's to fix.
//
// Every defect notifies, so only what our own scripts threw is filed. Each
// script a platform page runs is served from the apex, its inline ones in the
// page itself, so a break is ours when its stack has a frame there and a page
// there sent it. An extension's frames are on its own scheme, a
// muted "Script error." is a script from another origin by the browser's own
// rule, and a post no page of ours made is a stranger's: each is answered as
// if filed and dropped. The iOS shell (native/report.ts) is ours whole and
// reports here from no page: its report names it (`type` shell, `tags` its
// variant), is tagged as it says, and names the commit it was published from. A repeat of a break is one more occurrence of its bug
// in the tracker, which groups it (@yaks/tracker `faultKey`) and notifies once.
import { type Break, received } from '@yaks/tracker/report'
import { defect } from './defects.ts'
import { apex, type Host } from './host.ts'
import { isVerifiedBot } from '@yaks/platform/bots'
import { flood } from './lib/flood.ts'
import { refusal } from './unseen.ts'

export let PATH = '/api/report'

// Breaks a minute, all platform pages together (lib/flood.ts).
let over = flood(60)

let ADDRESS = /\bhttps?:\/\/[^\s()<>"']+/g

let onApex = (at: string, env: Host) => {
  try {
    return new URL(at).hostname == apex(env)
  } catch {
    return false
  }
}

/** Whether our own scripts threw what a page reports: a frame of its stack on
 * the apex. */
export let ours = (
  { message, stack }: { message: string; stack: string },
  env: Host = {},
): boolean =>
  message != 'Script error.' &&
  (stack.match(ADDRESS) ?? []).some((at) => onApex(at, env))

/** Whether a page of ours sent it: the browser says the post is the apex's
 * own, or names the apex as its origin. A page served with `no-referrer` (the
 * sign-in handoff) sends `Origin: null`, but its fetch is still same-origin. */
export let fromOurs = (req: Request, env: Host) => {
  let origin = req.headers.get('origin')
  return req.headers.get('sec-fetch-site') == 'same-origin' ||
    !!origin && onApex(origin, env)
}

/** The iOS shell's report (native/report.ts): what it says of itself. */
let shell = ({ request, tags }: Break) =>
  request.startsWith('shell ') && tags?.variant ? tags : null

/** File what a platform page, or the iOS shell, says broke. A no one of our
 * doors meant is no break (unseen.ts `refusal`), a page a verified bot renders
 * has nobody looking at it, and what no page of ours sent, or our scripts did
 * not throw, is not ours (`ours`). */
export let answer = async (req: Request, env: Host): Promise<Response> => {
  if (req.method != 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }
  if (isVerifiedBot(req)) {
    await req.body?.cancel()
    return new Response(null, { status: 204 })
  }
  let page = fromOurs(req, env)
  for (let broke of await received(req, refusal)) {
    let said = shell(broke)
    if (!(said || page && ours(broke, env)) || over('platform')) continue
    let { request, message, stack, cause, mechanism, breadcrumbs, agent } =
      broke
    let { commit, ...tags } = said ?? {}
    defect(Object.assign(Error(message), { stack, cause }), {
      ...tags,
      request,
      page: request.slice(request.indexOf(' ') + 1),
      agent,
    }, { commit, page: { mechanism, breadcrumbs } })
  }
  return new Response(null, { status: 204 })
}

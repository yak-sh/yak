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
import { type Break, door, flood } from '@yaks/tracker/report'
import { caught, defect } from './defects.ts'
import { apex, type Host } from '@yaks/platform/host'
import { refusal } from './unseen.ts'
import { reportInteractions } from '@yaks/platform/interaction-report'
import { INTERACTION_PATH } from '@yaks/timing/interaction'
import { CHECK } from '@yaks/platform/bots'
import { isPerson } from '@yaks/platform/visitor'
import { arrival } from './arrival.ts'
import { sessionPerson } from './session.ts'
import { bound, type Env } from './env.ts'
import { directory, fetch as directoryFetch } from './directory.ts'
import { pageKind } from '@yaks/platform/interaction'

export let PATH = '/api/report'

// Breaks a minute, all platform pages together.
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

/** File what a platform page, or the iOS shell, says broke, by the rules
 * every page's report door keeps (@yaks/tracker/report `door`), a no one of
 * our doors meant being no break (unseen.ts `refusal`). What no page of ours
 * sent, or our scripts did not throw, is not ours (`ours`). */
export let answer = (req: Request, env: Host): Promise<Response> => {
  let page = fromOurs(req, env)
  return door({
    refusal,
    file: (broke) => {
      let said = shell(broke)
      if (!(said || page && ours(broke, env)) || over('platform')) return
      let { request, message, stack, cause, mechanism, breadcrumbs, agent } =
        broke
      let { commit, ...tags } = said ?? {}
      defect(Object.assign(Error(message), { stack, cause }), {
        ...tags,
        request,
        page: request.slice(request.indexOf(' ') + 1),
        agent,
      }, { commit, page: { mechanism, breadcrumbs } })
    },
  })(req)
}

/** The platform's own interaction batches, from its browser pages. */
export let interactions = async (
  req: Request,
  env: Env,
  app = false,
): Promise<Response> => {
  let { ERRORS } = env
  if (
    req.method != 'POST' || !ERRORS || env.ENVIRONMENT == 'staging' ||
    !fromOurs(req, env) || !isPerson(req) ||
    arrival(req)?.said.utm_source == CHECK
  ) return new Response(null, { status: 204 })
  let person = await sessionPerson(req, env)
  if (
    person &&
    await directory(bound(env.DIRECTORY, directoryFetch, env)).tested(person)
  ) return new Response(null, { status: 204 })
  let opened = new URL(req.url).searchParams.has('open')
  let referer = URL.parse(req.headers.get('referer') ?? '')
  let page = referer
    ? pageKind(referer.pathname, referer.searchParams.has('app'))
    : 'other'
  return reportInteractions(req, {
    sink: (rows) => ERRORS.send(rows),
    environment: 'production',
    commit: env.CF_VERSION_METADATA?.id,
    ...opened
      ? {
        opened: {
          person,
          page: app && page != 'app-data' && page != 'app-inspect'
            ? 'app'
            : page,
        },
      }
      : {},
    failed: (error) => caught(error, { request: INTERACTION_PATH }),
  })
}

// An app's public pages, kept in Cloudflare's cache at the Site entrypoint
// (T-124419): the gateway's side. Every page view used to read the directory
// twice before a byte was sent; a kept page is answered with none of that.
// What Site may keep, under which key and for how long is
// @yaks/platform/kept's; this binds it to the directory and the Worker.
//
// yak-front (front/) asks Site first for a page any visitor could be sent,
// so a kept page waits on no kernel to start (kept-page.ts holds that path).
// It asks a customer's own domain by its hostname, and Site reads whose it is
// on a miss (site.ts `atDomain`). The gateway (apps.ts `served`) asks too, at
// the address it carried a domain to, and a page Site passed a moment ago
// costs it one cached answer. On a miss Site serves the address as an
// anonymous visitor would be served it (apps.ts `edged`), and keeps it only
// where @yaks/platform/kept `keepable` and `keep` say it is the same answer
// for everyone.
//
// The gateway remembers, as briefly, every address Site passed and every app
// it served itself of which nothing is ever kept (`unkept`: an unpublished
// private app's, a worker's), and does not ask about them again: such a page
// pays the hop to Site once in a while, not on every view, and a stranger
// walking an app's addresses one by one pays it once. A published private
// app's pages are remembered one address at a time, since its release files
// are still Site's to answer.
//
// A kept page is the page as sent: woven, its base, its home-screen tags, its
// release's addresses, the reporter and the free plan's badge. It is purged
// when a directory write changes what it shows (facets/pages-graph.ts),
// before that write answers, and a failing Site leaves the last good page
// serving.
//
// The visitor's own answer is the gateway's: it counts the view and the use
// from what the kept page says it was, gives the browser the app's own cache
// rule, and answers a revalidation with a 304.
import type { Env } from './env.ts'
import {
  type Alone,
  keep as keeping,
  opens,
  scope,
  type Seen,
  UNKEPT_AT,
} from '@yaks/platform/kept'
import { asked as askedOf, remember } from './kept-page.ts'
import { hostOf, MOUNT } from '@yaks/platform/routes'
import type { Clock } from './timing.ts'
import { scheduleUse, wake } from './used.ts'
import { seen, viewed } from './views.ts'

/** What a page of an app owes as the gateway answers it: its count
 * (views.ts), and its store booted where a browser goes on to run it, since
 * the page's scripts ask the store next (used.ts `wake`). yak-front does the
 * same for a page it answers from the edge (front.ts `kept`). */
export let shown = (env: Env, req: Request, page: Response, at: Seen) => {
  viewed(env, req, page, at)
  if (at.store && opens(page)) wake(env, at.store)
}

/** An answer Site may keep (@yaks/platform/kept `keep`), saying which app it
 * was a page of (none, for a space's own 404 or index) for the gateway's
 * count, and tagged for its purge. */
export let keep = (
  page: Response,
  space: { eid: string; slug: string; store: string } | null,
  app:
    | {
      eid: string
      slug: string
      store?: string | null
      fence?: string | null
    }
    | null,
  statuses?: number[],
  alone?: Alone,
) =>
  keeping(
    page,
    {
      space,
      app,
      seen: space ? app ? seen(space, app) : { space: space.slug } : {},
    },
    statuses,
    alone,
  )

// The mounts this request's answer owes yak-front word of (`told`), by the
// request's clock, which is the one thing every rung of it holds.
let owed = new WeakMap<object, string>()

/** That the gateway served an app nothing of which is ever kept, mounted at
 * `at`: it asks Site about none of the app's addresses for a while, and tells
 * yak-front to do the same. */
export let unkept = (req: Request, env: Env, at: string, c: Clock) => {
  if (env.SITE) {
    remember(env.SITE, scope(hostOf(req, env), req.headers.get(MOUNT), at))
  }
  owed.set(c, at)
}

/** This answer, saying what `unkept` found. A socket's answer carries nothing
 * more: nothing here can copy the runtime's own socket. */
export let told = (res: Response, c: Clock) => {
  let at = owed.get(c)
  if (!at || res.status == 101) return res
  let headers = new Headers(res.headers)
  headers.set(UNKEPT_AT, at)
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/** The gateway's half: the kept page for this request, counted, or null
 * when Site passed and the gateway serves it itself, as it does a stranger's
 * page when the `session` of a person it verified asks, unless Site keeps
 * their own. */
export let asked = (
  req: Request,
  env: Env,
  c: Clock,
  session: string | null = null,
) =>
  env.SITE
    ? askedOf(
      req,
      env.SITE,
      hostOf(req, env),
      req.headers.get(MOUNT),
      c,
      (answer, at) => {
        shown(env, req, answer, at)
        if (answer.status < 400) scheduleUse(env, at.app)
      },
      session,
    )
    : Promise.resolve(null)

// yak-front takes yaks.app's routes and answers what Site's cache holds, so a
// request answered from the edge never waits for the kernel to start (T-133886,
// D-133933). A Worker's isolate pays for everything uploaded with it, used or
// not, and a hit through a service binding runs no code of the Worker behind it,
// so the gateway's first question lives here, in an upload of its own.
//
// Everything else goes on to the kernel unchanged, and that includes every
// failure of this Worker: a visitor never gets an error from it. It holds no
// secret and opens no store. What it can't decide from the request alone (a
// signature, who someone is, whether a custom domain is anybody's) is the
// kernel's, so a person's cookie it may rely on is read only to route: a forged
// one earns the slow path, and the kernel verifies whatever comes to it.
import { caught, origin, queue, type Sink } from '@yaks/tracker/report'
import type { Fetcher } from '../env.ts'
import { sealed } from '../cache.ts'
import { apex, type Host } from '../host.ts'
import {
  asked,
  isListing,
  listed,
  listing,
  remember,
  scope,
  type Timer,
  UNKEPT_AT,
} from '../kept-page.ts'
import { cookieValue } from '../lib/cookie.ts'
import {
  isHome,
  isPage,
  isView,
  pointOf,
  stepOf,
  type Visited,
} from '../view-point.ts'
import { type Conversion, conversionOf, keep } from '../arrival.ts'
import { foreign, platform, spaceDoor } from '../route.ts'
import * as variant from '../variant.ts'

export type Lent = { waitUntil: (work: Promise<unknown>) => void }

export type FrontEnv = Host & {
  // The kernel's uncached gateway, its cached Site, its use receipts, and the
  // ad networks it tells (index.ts `Ads`).
  KERNEL: Pick<Fetcher, 'fetch'>
  SITE: Pick<Fetcher, 'fetch'>
  USES: { used(eid: string): Promise<void> | void }
  ADS?: { told(c: Conversion): Promise<void> }
  VIEWS?: { writeDataPoint(point: unknown): void }
  ERRORS?: { send: (body: never) => Promise<void> }
  WORKER_NAME?: string
  CF_VERSION_METADATA?: { id: string }
}

// A session lives ninety days and slides at half of that (session.ts `slid`).
let HALF_LIFE = 45 * 24 * 60 * 60

// The cookie's readable half, for routing only. A browser seal is `{via, exp}`,
// a session `{person, space, via, exp}`.
let claimed = (token: string) => {
  try {
    let body = token.split('.')[0].replaceAll('-', '+').replaceAll('_', '/')
    return JSON.parse(atob(body)) as {
      person?: string
      via?: string
      exp?: number
    }
  } catch {
    return null
  }
}

/** Whether this request's cookie owes it nothing from the kernel on the way
 * out: past half its life it is re-minted (session.ts `browsing`, `slid`), and
 * a session with no browser in it gains one. No cookie owes nothing here: a
 * visitor gets their instrument at the first door that uses one. */
export let settled = (req: Request, now = Date.now()) => {
  let token = cookieValue(req.headers.get('cookie'))
  if (!token) return true
  let claims = claimed(token)
  return !!claims?.via && typeof claims.exp == 'number' &&
    claims.exp - now / 1000 > HALF_LIFE
}

// What an answer from here says about the time it took, under the same names
// the gateway uses for its own.
let served = 0
let finished = (
  res: Response,
  env: Host,
  at: number,
  cold: boolean,
  said: string[],
) => {
  let out = sealed(res, env)
  out.headers.set(
    'strict-transport-security',
    'max-age=31536000; includeSubDomains',
  )
  out.headers.set(
    'server-timing',
    [
      out.headers.get('server-timing'),
      ...said,
      `front;dur=${Date.now() - at}`,
      cold ? 'cold;dur=1' : null,
    ].filter(Boolean).join(', '),
  )
  return out
}

// The front Worker keeps no per-request clock of its own: what it says of a
// page is what Site said of rendering it.
let timer = (said: string[]): Timer => ({
  time: (_name, work) => work(),
  include: (timing) => {
    if (timing) said.push(timing)
  },
})

// A use is a receipt the platform store keeps an hour (used.ts): one a key per
// hour from this isolate, whatever the traffic.
let HOUR = 60 * 60 * 1000
let receipts = new Map<string, number>()
let remembered = (eid: string, now = Date.now()) => {
  if ((receipts.get(eid) ?? 0) > now) return true
  if (receipts.size >= 1000) receipts.clear()
  receipts.set(eid, now + HOUR)
  return false
}

/** What the edge holds for this request, or null when it is the kernel's. */
export let kept = (
  req: Request,
  env: FrontEnv,
  ctx: Lent,
  said: string[] = [],
): Promise<Response | null> | null => {
  let url = new URL(req.url)
  let host = url.hostname.toLowerCase(), path = url.pathname
  if (
    (req.method != 'GET' && req.method != 'HEAD') || foreign(host, env) ||
    platform(host, path, env) || !settled(req)
  ) return null
  if (host == apex(env)) {
    if (!isListing(path)) return null
    return listing(req, env.SITE, apex(env), listed(req, path)).then((page) => {
      if (page.status >= 500) return null
      // A visit to the home page is the funnel's first step (funnel.ts).
      if (env.VIEWS && isHome(req, path, page)) {
        env.VIEWS.writeDataPoint(stepOf('home', req as Visited))
      }
      // The ad network whose click brought this visit is the kernel's to tell
      // (ads.ts), behind this answer; the arrival is kept here (arrival.ts).
      let c = env.ADS && isPage(req, page) && conversionOf('view', req)
      if (c) {
        ctx.waitUntil(
          env.ADS!.told(c).catch((e) => report(e, env, ctx, 'front ads', req)),
        )
      }
      return variant.keep(req, keep(req, page))
    })
  }
  // `x.y.yaks.app` is the kernel's to say what it is (route.ts `route`).
  if (host.slice(0, -apex(env).length - 1).includes('.')) return null
  if (spaceDoor(path)) return null
  return asked(req, env.SITE, host, null, timer(said), (answer, at) => {
    if (env.VIEWS && isView(answer)) {
      env.VIEWS.writeDataPoint(pointOf(req as Visited, answer, at))
    }
    if (answer.status < 400 && !remembered(at.app)) {
      ctx.waitUntil(
        Promise.resolve(env.USES.used(at.app)).catch((e) =>
          report(e, env, ctx, 'front used', req)
        ),
      )
    }
  })
}

let report = (
  error: unknown,
  env: FrontEnv,
  ctx: Lent,
  where: string,
  req: Request,
) => {
  ctx.waitUntil(
    caught(error, {
      sink: env.ERRORS ? queue(env.ERRORS as never) : (() => {}) as Sink,
      ...origin(
        env.WORKER_NAME ?? 'yak-front',
        env.CF_VERSION_METADATA?.id,
        where,
        req,
      ),
    }),
  )
}

export let serve = async (req: Request, env: FrontEnv, ctx: Lent) => {
  let at = Date.now(), cold = served++ == 0, said: string[] = []
  try {
    let page = await kept(req, env, ctx, said)
    if (page) return finished(page, env, at, cold, said)
  } catch (error) {
    report(error, env, ctx, 'front fetch', req)
  }
  let res = await env.KERNEL.fetch(req)
  let mount = res.headers.get(UNKEPT_AT)
  if (!mount) return res
  // An app whose pages are never kept pays the hop to Site once in a while,
  // not on every view.
  remember(
    env.SITE,
    scope(new URL(req.url).hostname.toLowerCase(), null, mount),
  )
  let out = new Response(res.body, res)
  out.headers.delete(UNKEPT_AT)
  return out
}

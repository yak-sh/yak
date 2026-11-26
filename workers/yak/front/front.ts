// yak-front takes yaks.app's routes and answers what Site's cache holds, so a
// request answered from the edge never waits for the kernel to start (T-133886,
// D-133933). A Worker's isolate pays for everything uploaded with it, used or
// not, and a hit through a service binding runs no code of the Worker behind it,
// so the gateway's first question lives here, in an upload of its own.
//
// Everything else goes on to the kernel unchanged. The front answers if the
// request reaches its deadline. It holds no secret and opens no store.
// What it can't decide from the request alone (a
// signature, who someone is, whether a custom domain is anybody's) is the
// kernel's, so a person's cookie it may rely on is read only to route: a forged
// one earns the slow path, and the kernel verifies whatever comes to it. A
// custom domain is asked of Site by its own hostname, and Site reads the
// directory for it on a miss.
import { caught, origin, queue, type Sink } from '@yaks/tracker/report'
import type { Fetcher } from '../env.ts'
import { apex, type Host } from '@yaks/platform/host'
import {
  asked,
  homed,
  isListing,
  listing,
  LOGIN,
  remember,
  SITE_CHECKED,
  type Timer,
} from '../kept-page.ts'
import { page as documentPath } from '@yaks/platform/files'
import {
  opens,
  packageAt,
  packagePath,
  recordsUse,
  scope,
  sealed,
  shareable,
  stranger,
  UNKEPT_AT,
} from '@yaks/platform/kept'
import { cookieValue, HOST_COOKIE } from '@yaks/platform/cookie'
import {
  badgeFollowed,
  isHome,
  isPage,
  isView,
  pointOf,
  stepOf,
  type Visited,
} from '../view-point.ts'
import { type Conversion, conversionOf, keep } from '../arrival.ts'
import {
  collapsed,
  foreign,
  guarded,
  handedOff,
  hostOf,
  loopback,
  managed,
  platform,
  QUERY_PASS,
  queryRequest,
  sameOrigin,
  signInReturn,
  spaceDoor,
  timedOut,
} from '@yaks/platform/routes'
import { type Clock, within } from '@yaks/fp'
import { VERSION } from '@yaks/workerd/worker'
import { answerBy, resending } from '@yaks/workerd/fetch'
import { workerWaits } from '@yaks/platform/app-worker'

/** The header the front's own deploy is said in, beside the kernel's. */
export let FRONT_VERSION = 'x-yak-front-version'

export type Lent = { waitUntil: (work: Promise<unknown>) => void }

export type FrontEnv = Host & {
  // The kernel's uncached gateway, its cached Site, its use receipts, and the
  // ad networks it tells (index.ts `Ads`).
  KERNEL: Pick<Fetcher, 'fetch'>
  QUERY?: Pick<Fetcher, 'fetch'>
  SITE: Pick<Fetcher, 'fetch'>
  USES: {
    used(eid: string): Promise<void> | void
    wake(store: string): Promise<void> | void
  }
  ADS?: { told(c: Conversion): Promise<void> }
  // The sandbox CLI this Worker's assets carry (wrangler.toml `[assets]`).
  CLI: Pick<Fetcher, 'fetch'>
  VIEWS?: { writeDataPoint(point: unknown): void }
  ERRORS?: { send: (body: never) => Promise<void> }
  WORKER_NAME?: string
  CF_VERSION_METADATA?: { id: string }
  CLOCK?: Clock
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
let routedCookie = (req: Request, env: Host) => {
  let header = req.headers.get('cookie')
  let own = hostOf(req, env) == apex(env)
  return (own ? cookieValue(header, HOST_COOKIE) : null) ?? cookieValue(header)
}

export let settled = (req: Request, now = Date.now(), env: Host = {}) => {
  let token = routedCookie(req, env)
  if (!token) return true
  let claims = claimed(token)
  return !!claims?.via && typeof claims.exp == 'number' &&
    claims.exp - now / 1000 > HALF_LIFE
}

/** The session this request's cookie holds where it names a person, read only
 * to route: a page kept for strangers is not theirs, and Site answers the
 * session its own copy only once the kernel verified it (kept-page.ts
 * `asked`). */
let session = (req: Request, env: Host) => {
  let token = routedCookie(req, env)
  return token && claimed(token)?.person ? token : null
}

// What an answer from here says about the time it took, under the same names
// the gateway uses for its own.
let served = 0
let SITE_WAIT = 60
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

/** What the edge holds for this request; null when it is the kernel's, or the
 * status Site refused an apex page with (a 4xx), which the kernel answers. */
export let kept = (
  req: Request,
  env: FrontEnv,
  ctx: Lent,
  said: string[] = [],
  signal?: AbortSignal,
): Promise<Response | number | null> | null => {
  let host = hostOf(req, env), path = new URL(req.url).pathname
  if (
    (req.method != 'GET' && req.method != 'HEAD') ||
    platform(host, path, env) || handedOff(host, path, env) ||
    guarded(req) &&
      !sameOrigin(
        host,
        req.headers.get('origin'),
        env,
        req.headers.get('sec-fetch-site'),
      ) ||
    !settled(req, Date.now(), env)
  ) return null
  if (host == apex(env)) {
    if (
      !isListing(path) || (path == LOGIN && !stranger(req)) ||
      (homed(path) && session(req, env))
    ) return null
    return listing(req, env.SITE, apex(env), path).then(
      async (page) => {
        if (page.status >= 500) return null
        // Site keeps no page that isn't found (site.ts `rendered`), so a 4xx
        // is a page the kernel answers too: a missing one, or one this Worker
        // lists before Site's deploy does (wrangler.ts `SIBLINGS`).
        if (page.status >= 400) {
          await page.body?.cancel()
          return page.status
        }
        // A visit to the home page is the funnel's first step (funnel.ts).
        if (env.VIEWS && isHome(req, path, page)) {
          env.VIEWS.writeDataPoint(stepOf('home', req as Visited))
        }
        // And so is a page an app's badge or line led to (funnel.ts `badge`).
        let app = env.VIEWS && badgeFollowed(req, page)
        if (app) {
          env.VIEWS!.writeDataPoint(
            stepOf('badge', req as Visited, { button: app }),
          )
        }
        // The ad network whose click brought this visit is the kernel's to tell
        // (ads.ts), behind this answer; the arrival is kept here (arrival.ts).
        let c = env.ADS && isPage(req, page) && conversionOf('view', req)
        if (c) {
          ctx.waitUntil(
            env.ADS!.told(c).catch((e) =>
              report(e, env, ctx, 'front ads', req)
            ),
          )
        }
        return keep(req, page)
      },
    )
  }
  // `x.y.yaks.app` is the kernel's to say what it is (@yaks/platform/routes `route`). A
  // custom domain is asked of Site by its own hostname, as a space's is, and
  // Site reads whose it is (site.ts `atDomain`).
  if (
    !foreign(host, env) && host.slice(0, -apex(env).length - 1).includes('.')
  ) return null
  if (spaceDoor(path)) return null
  return asked(
    req,
    env.SITE,
    host,
    null,
    timer(said),
    (answer, at) => {
      if (env.VIEWS && isView(answer)) {
        env.VIEWS.writeDataPoint(pointOf(req as Visited, answer, at))
      }
      if (answer.status < 400 && recordsUse(req) && !remembered(at.app)) {
        ctx.waitUntil(
          Promise.resolve(env.USES.used(at.app)).catch((e) =>
            report(e, env, ctx, 'front used', req)
          ),
        )
      }
      // The page's scripts ask its store next, and a store asleep takes longer
      // to start and boot than they take to load (page-cache.ts `shown`).
      if (at.store && opens(answer)) {
        ctx.waitUntil(
          Promise.resolve(env.USES.wake(at.store)).catch((e) =>
            report(e, env, ctx, 'front wake', req)
          ),
        )
      }
    },
    session(req, env),
    signal,
  )
}

// A shared-page hit is usually local. A miss can cross regions and start a
// Worker before it knows whether it can serve the page. Give the gateway
// its turn while an outstanding cache fill finishes.
let glance = async (
  req: Request,
  env: FrontEnv,
  ctx: Lent,
  said: string[],
) => {
  let stop = new AbortController()
  let at = (env.CLOCK?.now ?? Date.now)()
  let work = Promise.resolve(kept(req, env, ctx, said, stop.signal))
    .then((answer) => ({ answer }))
  try {
    let ready = await within(work, SITE_WAIT, env.CLOCK)
    if (ready) return ready.answer
    stop.abort()
    ctx.waitUntil(work.catch((error) => {
      report(error, env, ctx, 'front Site fill', req)
    }))
    return null
  } finally {
    said.push(`site;dur=${(env.CLOCK?.now ?? Date.now)() - at}`)
  }
}

let report = (
  error: unknown,
  env: FrontEnv,
  ctx: Lent,
  where: string,
  req: Request,
  tags?: Record<string, string>,
) => {
  let source = origin(
    env.WORKER_NAME ?? 'yak-front',
    env.CF_VERSION_METADATA?.id,
    where,
    req,
  )
  ctx.waitUntil(
    caught(error, {
      sink: env.ERRORS ? queue(env.ERRORS as never) : (() => {}) as Sink,
      ...source,
      ...tags && {
        tags: { ...source.tags, ...tags },
        fault: 'request timeout',
      },
    }),
  )
}

/** Whether this is the apex's sandbox CLI (../sandbox/launch.ts fetches it),
 * which this Worker's assets hold and the kernel's don't. A local dev run's
 * bare loopback host is its apex, as it is the kernel's. */
let cli = (req: Request, env: FrontEnv) => {
  let host = hostOf(req, env)
  return (host == apex(env) || loopback(host)) &&
    new URL(req.url).pathname.startsWith('/_cli/')
}

// Shared modules have the same bytes for every app and browser. On a hit,
// Site's cache answers before the kernel or the Files handler starts.
let shared = async (req: Request, site: FrontEnv['SITE'], path: string) => {
  if (
    req.method != 'GET' || req.cache == 'no-store' ||
    [...req.headers.keys()].some((h) => h == 'range' || h.startsWith('if-'))
  ) return null
  let answer = await site.fetch(
    new Request(packageAt(path), {
      signal: req.signal,
    }),
  )
  if (answer.ok && answer.status == 200) return answer
  await answer.body?.cancel()
  if (answer.status >= 500) {
    throw new Error(`Site package cache answered ${answer.status}`)
  }
  return null
}

let serving = async (
  req: Request,
  env: FrontEnv,
  ctx: Lent,
  waiting: (name: string) => void,
) => {
  let at = Date.now(), cold = served++ == 0, said: string[] = []
  let host = hostOf(req, env)
  let path = new URL(req.url).pathname
  let appPage = host != apex(env) && documentPath(path) &&
    shareable(req, path) && !spaceDoor(path)
  let refused: number | null = null
  try {
    if (cli(req, env)) {
      waiting('cli_wait')
      return await env.CLI.fetch(req)
    }
    if (host == apex(env) && packagePath(path)) {
      waiting('site_package_wait')
      let asset = await shared(req, env.SITE, path)
      if (asset) return finished(asset, env, at, cold, said)
    }
    if (
      hostOf(req, env) == apex(env) && shareable(req) && !routedCookie(req, env)
    ) {
      let page = collapsed(req)
      let manage = managed(new URL(page.url).pathname)
      if (manage && !('moved' in manage) && !('door' in manage)) {
        return finished(signInReturn(page, env), env, at, cold, said)
      }
    }
    waiting('site_wait')
    let page = appPage
      ? await glance(req, env, ctx, said)
      : await kept(req, env, ctx, said)
    if (page instanceof Response) return finished(page, env, at, cold, said)
    refused = page
  } catch (error) {
    report(error, env, ctx, 'front fetch', req)
  }
  // Give app pages time to finish or reach their deadline before resending a
  // lost kernel hop. Platform doors keep the shorter retry interval.
  let app = hostOf(req, env) != apex(env) || homed(path) ||
    path.startsWith('/home/')
  let retry = app ? workerWaits.page + 5_000 : undefined
  let forwarded = req
  if (appPage || req.headers.has(SITE_CHECKED)) {
    let headers = new Headers(req.headers)
    headers.delete(SITE_CHECKED)
    if (appPage) headers.set(SITE_CHECKED, '1')
    forwarded = new Request(req, { headers })
  }
  let query: Response | undefined
  if (env.QUERY && queryRequest(forwarded, env)) {
    waiting('query_wait')
    try {
      let answer = await resending(env.QUERY, forwarded, env.CLOCK, retry)
      if (answer.status != 204 || answer.headers.get(QUERY_PASS) != '1') {
        query = answer
      }
    } catch (error) {
      if (req.signal.aborted) throw error
      report(error, env, ctx, 'front query', req)
    }
  }
  if (!query) waiting('kernel_wait')
  let res = query ?? await resending(env.KERNEL, forwarded, env.CLOCK, retry)
  if (path == VERSION) {
    let out = new Response(res.body, res)
    out.headers.set(FRONT_VERSION, env.CF_VERSION_METADATA?.id ?? '')
    out.headers.set('cache-control', 'no-store')
    return out
  }
  // A page the kernel serves that Site refused is one Worker deployed ahead of
  // the other: the visitor has the page all the same, and the skew is a bug.
  if (refused && res.status < 400) {
    report(
      new Error(`Site answered ${refused} for an apex page the kernel serves`),
      env,
      ctx,
      'front listing',
      req,
    )
  }
  let mount = res.headers.get(UNKEPT_AT)
  if (res.status == 101 || !mount && !appPage) return res
  // An app whose pages are never kept pays the hop to Site once in a while,
  // not on every view.
  if (mount) remember(env.SITE, scope(host, null, mount))
  let out = new Response(res.body, res)
  out.headers.delete(UNKEPT_AT)
  if (appPage) {
    let timing = [
      out.headers.get('server-timing'),
      ...said,
      `front;dur=${Date.now() - at}`,
    ]
    out.headers.set('server-timing', timing.filter(Boolean).join(', '))
  }
  return out
}

export let serve = (
  req: Request,
  env: FrontEnv,
  ctx: Lent,
): Promise<Response> => {
  let waiting = 'front fetch'
  return answerBy(
    () => serving(req, env, ctx, (name) => waiting = name),
    55_000,
    (ms) => {
      report(
        Error('The request reached its response deadline'),
        env,
        ctx,
        'front fetch',
        req,
        {
          waiting,
          elapsed_ms: String(ms),
        },
      )
      return timedOut(req)
    },
    env.CLOCK,
  )
}

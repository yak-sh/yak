// An HTTP request as an entity, `request{method, url, route, status, ms,
// agent}` (./vocab.json), and the one place an answer is watched for breaking.
//
// The server that answered is the only one that knows how it answered, so it
// is the writer, and it writes only a request that broke (D-45640): an answer
// at 500 or over, whether a handler threw it or returned it. The entity's eid
// is a fresh uuid, and the caller is answered with the same id in
// `x-request-id`, so the person holding a failed answer and the record of it
// name one thing.
//
// Where the bundle goes is not this package's word. {@link served} hands it to
// the `report` its host supplies, with the error when one was thrown; a host
// that supplies none has it said on the console, as a failure was before.

import { type Bundle, status } from '@yaks/graph'
import { link, parent, peek, unlink } from '@yaks/trace'
import { fault, json, refusal } from './refuse.ts'
import type { Handler } from './route.ts'

/** Where a request that broke goes: its `request` bundle, and the error when
 * one was thrown. Whatever it does, it must not throw; one that does is said
 * on the console, and the caller is answered all the same. */
export type Report = (request: Bundle, err?: unknown) => void

/** How the server answered, as the `request` component records it. */
export type Answered = {
  /** the HTTP status */
  status: number
  /** milliseconds from arrival until the answer's head was ready */
  ms: number
  /** the route that matched, in the server's own words (`/blob/*`) */
  route?: string
}

// The browsers first, since each also says `Safari` and `Mozilla`; Edge and
// Opera before Chrome, whose token they carry too.
let BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/Version\/(\d+).*Safari\//, 'Safari'],
]

// iOS and Android before the desktops whose names their agents also carry.
let SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

/**
 * A `User-Agent` reduced to what a person reading a failure wants: the
 * browser, its major version and the operating system. Anything else is its
 * first product token.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { agent } from '@yaks/api'
 *
 * assertEquals(
 *   agent(
 *     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
 *       '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
 *   ),
 *   'Chrome 141 on macOS',
 * )
 * assertEquals(
 *   agent(
 *     'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) ' +
 *       'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 ' +
 *       'Mobile/15E148 Safari/604.1',
 *   ),
 *   'Safari 18 on iOS',
 * )
 * assertEquals(agent('curl/8.5.0'), 'curl 8.5.0')
 * ```
 */
export let agent = (ua: string): string => {
  let os = SYSTEMS.find(([re]) => re.test(ua))?.[1]
  for (let [re, name] of BROWSERS) {
    let m = ua.match(re)
    if (m) return os ? `${name} ${m[1]} on ${os}` : `${name} ${m[1]}`
  }
  let m = ua.match(/^([^\s/]+)\/(\S+)/)
  return m ? `${m[1]} ${m[2]}` : ua.slice(0, 64)
}

/**
 * The `request` bundle for one answered request, under the id its caller was
 * answered with. The address keeps no query string.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { requested } from '@yaks/api'
 *
 * let r = new Request('https://shop.test/blob/ab?token=x', { method: 'PUT' })
 * assertEquals(requested('1f0c', r, { status: 503, ms: 12, route: '/blob/*' }), {
 *   entity: { eid: '1f0c' },
 *   request: {
 *     method: 'PUT',
 *     url: 'https://shop.test/blob/ab',
 *     route: '/blob/*',
 *     status: 503,
 *     ms: 12,
 *   },
 * })
 * ```
 */
export let requested = (
  id: string,
  request: Request,
  a: Answered,
): Bundle => {
  let url = new URL(request.url)
  let ua = request.headers.get('user-agent')
  return {
    entity: { eid: id },
    request: {
      method: request.method,
      url: url.origin + url.pathname,
      ...a.route ? { route: a.route } : {},
      status: a.status,
      ms: a.ms,
      ...ua ? { agent: agent(ua) } : {},
    },
  }
}

// The report a host that supplied none gets: the console line a failure was
// always said with, now naming the id its caller holds.
let said: Report = (b, err) => {
  let r = b.request as { method: string; url: string; status: number }
  let where = `${r.method} ${new URL(r.url).pathname} (request ${b.entity.eid})`
  if (err === undefined) console.error(`${where} answered ${r.status}`)
  else fault(err, where)
}

/** What {@link served} is told by the host it serves: where a request that
 * broke goes, and how to name the route that answered one. */
export type Watch = {
  /** Exact graph identity, even when the handler reads through an overlay. */
  graph?: object
  report?: Report
  route?: (request: Request) => string | undefined
}

/**
 * `handle`, watched. Each answer is timed; one at 500 or over, thrown or
 * returned, is answered with an `x-request-id` and reported as a `request`
 * bundle under that id. A thrown error is answered as its refusal body. An
 * answer that already carries an `x-request-id` was reported by whoever
 * answered it, so a watched handler inside another is reported once.
 */
export let served =
  (handle: Handler, o: Watch = {}): Handler => async (request) => {
    let c = o.graph && peek(o.graph)
    // Nested served handlers share this request's locally trusted parent.
    let span = c && !parent(o.graph!, request)
      ? c.begin({
        kind: 'request',
        name: o.route?.(request) ?? 'http',
        package: '@yaks/api',
      })
      : undefined
    if (span) link(o.graph!, request, span.id)
    let began = Date.now()
    let err: unknown
    let answer: Response
    try {
      answer = await handle(request)
    } catch (e) {
      err = e
      answer = json(refusal(e), status(e))
    }
    if (span) {
      if (peek(o.graph!)) {
        span.end({
          outcome: answer.status >= 500
            ? 'error'
            : answer.status >= 400
            ? 'refused'
            : 'ok',
          counts: { status: answer.status },
        })
      }
      unlink(o.graph!, request)
    }
    if (answer.status < 500 || answer.headers.has('x-request-id')) return answer
    let id = crypto.randomUUID()
    let b = requested(id, request, {
      status: answer.status,
      ms: Date.now() - began,
      route: o.route?.(request),
    })
    try {
      ;(o.report ?? said)(b, err)
    } catch (why) {
      fault(why, `report ${id}`)
    }
    let out = new Response(answer.body, answer)
    out.headers.set('x-request-id', id)
    return out
  }

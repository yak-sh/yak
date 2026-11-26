import { CallError, refused as toolRefusal } from '@yaks/tools/errors'
import { FILED } from '@yaks/api/refuse'
import { AppWorkerTimeout } from '@yaks/platform/app-worker'
import { apex } from '@yaks/platform/host'
import { sealed } from '@yaks/platform/kept'
import {
  admitted,
  collapsed,
  cors,
  hostOf,
  jsonDoor,
  type Route,
  route,
  unmounted,
} from '@yaks/platform/routes'
import { origin } from '@yaks/tracker/report'
import { waited } from './apps.ts'
import { protectedCookie } from './browser-cookie.ts'
import { defect, filing, within } from './defects.ts'
import type { Env } from './env.ts'
import { oops } from './pages.ts'
import { slid } from './session.ts'
import { refusal } from './unseen.ts'

type Next = (req: Request) => Promise<Response>

/** A hostname can answer on its own or carry an admitted request to its app. */
export type HostRoute = (
  req: Request,
  env: Env,
  host: string,
  route: Route,
  next: Next,
) => Promise<Response | ((req: Request) => Request) | null>

let hosting = async (
  req: Request,
  env: Env,
  next: Next,
  resolve?: HostRoute,
): Promise<Response> => {
  req = collapsed(req)
  let host = hostOf(req, env)
  let r = route(host, new URL(req.url).pathname, env)
  try {
    req = unmounted(req)
    let onHost = await resolve?.(req, env, host, r, next)
    if (onHost instanceof Response) return onHost
    // Space isolation (@yaks/platform/routes `admitted`), before `aim`
    // moves the address, since what must match is what the browser
    // addressed.
    let given = admitted(req, host, env)
    if ('answer' in given) return sealed(given.answer, env)
    req = given.req
    if (onHost) {
      req = onHost(req)
      r = route(hostOf(req, env), new URL(req.url).pathname, env)
    }
    let answer = await next(req)
    return sealed(given.anyone ? cors(answer) : answer, env)
  } catch (e) {
    if (req.signal.aborted && e === req.signal.reason) {
      return new Response(null, { status: 499 })
    }
    if (e instanceof AppWorkerTimeout) {
      return sealed(e.response(jsonDoor(new URL(req.url).pathname)), env)
    }
    // A refusal is not a break (unseen.ts `refusal`, T-32655). A part that
    // relays a door's deliberate no by throwing what it was answered is
    // carrying an answer out, not a failure: it files nothing. Log one
    // line for the tail, and preserve its body and 4xx at JSON doors.
    // Typed tool refusals use the tools package's JSON and HTTP status.
    // A shaped refusal without a status is a bad request (400). Pages
    // keep a page, with the refusal's status.
    let said = e instanceof Error ? e.message : String(e)
    let carried = e as { status?: number; body?: string } | null
    let tool = e instanceof CallError ? toolRefusal(e) : null
    let body = tool
      ? await tool.text()
      : typeof carried?.body == 'string'
      ? carried.body
      : said
    let status = tool?.status ?? carried?.status
    if (refusal(body, status)) {
      status ??= 400
      let path = new URL(req.url).pathname
      console.log(
        `yak: ${req.method} ${hostOf(req, env)}${path} refused ${status}: ${
          JSON.stringify(body)
        }`,
      )
      if (jsonDoor(path)) {
        let answer: unknown
        try {
          answer = JSON.parse(body)
        } catch {
          answer = { error: { code: 'refused', message: said } }
        }
        return sealed(
          Response.json(answer, { status, headers: waited(e) }),
          env,
        )
      }
      let page = oops(env)
      return sealed(
        new Response(page.body, {
          status,
          headers: page.headers,
        }),
        env,
      )
    }
    // Failures here belong to the platform. The app's worker has its own
    // reporting boundary in dispatch.ts.
    // The host the router routed by, not the one the socket arrived on: it
    // is what names the space and the app this was on its way to, and after
    // `aimed` it is the address the platform derived rather than the
    // customer's own domain.
    let where = `${hostOf(req, env)}${new URL(req.url).pathname}`
    let requestId = crypto.randomUUID()
    console.log(
      `yak: ${req.method} ${where} failed ${requestId}: ${
        JSON.stringify(said)
      }`,
    )
    let told = filing(e)
    defect(e, {
      request: `${req.method} ${where}`,
      space: r.space,
      app: r.app,
      request_id: requestId,
    })
    // A JSON door's caller is code (an app's worker calling `./api/service`,
    // an MCP client): it gets the failure as JSON it can read, not a page.
    if (jsonDoor(new URL(req.url).pathname)) {
      return sealed(
        Response.json({
          error: {
            code: 'failed',
            message:
              `Something went wrong. Try again shortly. Request ID: ${requestId}.`,
            request_id: requestId,
          },
        }, {
          status: 500,
          headers: {
            'x-request-id': requestId,
            ...told ? { [FILED]: '1' } : {},
          },
        }),
        env,
      )
    }
    return oops(env, requestId, told)
  }
}

// The session slides at half its life. Use the original request even when
// hosting carried it to a different address. On our zone, the answer says
// how long this gateway took and whether its isolate just started.
let served = 0
export let gateway = (
  req: Request,
  env: Env,
  next: Next,
  resolve?: HostRoute,
): Promise<Response> =>
  within(
    env,
    {},
    async () => {
      let started = Date.now(), cold = served++ == 0
      let res = await protectedCookie(
        req,
        env,
        await slid(req, env, await hosting(req, env, next, resolve)),
      )
      let host = hostOf(req, env)
      if (host != apex(env) && !host.endsWith(`.${apex(env)}`)) return res
      // Every answer on our zone, including refusals and failures, carries
      // the transport policy. A customer's domain keeps its own policy.
      // Rebuilding handles immutable asset headers; an upgrade keeps the
      // runtime's socket, just as dispatch.ts does.
      let headers = new Headers(res.headers)
      headers.set(
        'strict-transport-security',
        'max-age=31536000; includeSubDomains',
      )
      headers.set(
        'server-timing',
        [
          headers.get('server-timing'),
          `gateway;dur=${Date.now() - started}`,
          cold ? 'cold;dur=1' : null,
        ].filter(Boolean).join(', '),
      )
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
        webSocket: (res as { webSocket?: unknown }).webSocket,
      } as ResponseInit)
    },
    undefined,
    {
      origin: origin(
        env.WORKER_NAME ?? 'yak',
        env.CF_VERSION_METADATA?.id,
        'gateway fetch',
        req,
      ),
    },
  )

// Calls an app makes to outside services, which leave through yaks.app so a
// connection's key is put in them on the way out (@yaks/egress) and never
// held by the app. Two ways in, one way out.
//
// The namespace's outbound Worker (T-33447): every fetch an app's own worker
// makes arrives here instead of leaving. This is the same Worker as the rest
// of the kernel (wrangler.toml `outbound.service`); what makes a request one
// of these is `env.CALLER`, which only an outbound call carries — dispatch.ts
// sets it per request from the directory's row and the kernel's own vouch, and
// no request anybody sends can. A fetch to the platform's own zone goes out
// and comes back in like anybody's (wrangler.toml
// `global_fetch_strictly_public`).
//
// The fetch door (T-33450): a page's own fetch never passes through us, so an
// app with no worker asks `./api/env` for its sentinels and sends the call to
// `./api/fetch?url=…` instead. It is not a proxy for anything else: a call
// carrying no sentinel is refused, since the page can make that one itself.
//
// Either way, a call carrying a sentinel goes out with the key in its place
// when the app uses that connection, the caller may call out through it, and
// the host is one its integration names; anything else carrying one is
// refused with a 403 the app reads like any other answer. Three ways it can
// end, kept apart: the egress's refusal is an answer; the outside service not
// answering is the app's fetch failing, as it would have without us; and
// anything else is ours, and Sentry hears it.
import { used, USES } from '@yaks/connections'
import { type Caller, forward, Refused } from '@yaks/egress'
import type { Comp } from '@yaks/graph'
import { callsOut } from '@yaks/member'
import { sentinels } from '@yaks/secrets'
import { ctxOf } from './connections.ts'
import type { Env } from './env.ts'
import type { Answer, Plugin } from './plugin.ts'
import { caught } from './sentry.ts'

// The outside service's own failure, carried past the catch below unchanged.
class Wire extends Error {
  was: unknown
  constructor(was: unknown) {
    super('the outside service did not answer')
    this.was = was
  }
}

// One call out, for a caller, with every ending but the service's own made an
// answer.
let sent = async (env: Env, caller: Caller, req: Request) => {
  let c = {
    ...ctxOf(env),
    fetch: (r: RequestInfo | URL, init?: RequestInit) =>
      fetch(r, init).catch((e) => {
        throw new Wire(e)
      }),
  }
  try {
    return await forward(c, caller, req)
  } catch (e) {
    if (e instanceof Refused) {
      return new Response(`yaks.app refused this call: ${e.message}`, {
        status: 403,
      })
    }
    if (e instanceof Wire) throw e.was
    caught(e, { request: `outbound ${new URL(req.url).host}`, app: caller.app })
    return new Response('yaks.app could not send this call', { status: 502 })
  }
}

/** An app's worker calling out: the request as its code made it. */
export let outbound = (req: Request, env: Env): Promise<Response> =>
  sent(env, env.CALLER!, req)

// What a page's request says about the page and the platform, none of which
// the outside service is owed.
let OURS =
  /^(cookie|host|origin|referer|content-length|connection|x-real-ip|true-client-ip|(x-yak|cf|x-forwarded|sec)-)/i

// `./api/env`: the sentinel for each connected connection the app uses, by the
// name its code reads it by, where this visitor may call out through it: a
// shared one as its link allows, and their own where the app asks each person.
// A direct link's key is for a worker's code and never a page's.
let envDoor: Answer = async ({ env, path, app, who }) => {
  if (path != '/env') return null
  let out: Record<string, string> = {}
  for (let r of await used(ctxOf(env), app.eid, who.person)) {
    let u = (r.link[USES] ?? {}) as Comp
    if (u.direct || typeof u.binding != 'string') continue
    if (u.each || callsOut(u.anyone == true, who.role)) {
      out[u.binding] = r.sentinel
    }
  }
  return Response.json(out)
}

// `./api/fetch?url=…`: the page's call, sent on to that address as it was
// made, minus what it says about us.
let fetchDoor: Answer = async ({ env, req, path, app, who, json }) => {
  if (path != '/fetch') return null
  let to = new URL(req.url).searchParams.get('url') ?? ''
  if (!URL.canParse(to)) {
    return json(400, 'bad_url', 'url= is the whole address to call')
  }
  let headers = [...req.headers].filter(([k]) => !OURS.test(k))
  let body = ['GET', 'HEAD'].includes(req.method)
    ? null
    : new Uint8Array(await req.arrayBuffer())
  let text = [to, ...headers.map(([, v]) => v)].join('\n') +
    (body ? new TextDecoder().decode(body) : '')
  if (!sentinels(text).length) {
    return json(
      400,
      'no_connection',
      "./api/fetch sends a call carrying a connection's sentinel (./api/env); " +
        'the page makes any other call itself',
    )
  }
  let res = await sent(
    env,
    { app: app.eid, level: who.role, person: who.person },
    new Request(to, { method: req.method, headers, body }),
  ).catch(() => json(502, 'unanswered', `${new URL(to).host} did not answer`))
  // A cookie from somebody else's service would be set on this app's origin.
  let back = new Headers(res.headers)
  back.delete('set-cookie')
  return new Response(res.body, { status: res.status, headers: back })
}

/** The two doors a page calls out through (plugin.ts `answers`). */
export let outboundPlugin: Plugin = {
  name: 'outbound',
  answers: [envDoor, fetchDoor],
}

// Calls an app makes to outside services, which leave through yaks.app so a
// connection's key is put in them on the way out (@yaks/egress) and never
// held by the app. Two ways in, one way out.
//
// The namespace's outbound Worker (T-33447): every fetch an app's own worker
// makes arrives here instead of leaving, by way of yak-out (outbound/), which
// hands it to the kernel's `Outbound` entrypoint with the caller dispatch.ts
// said for that request — from the directory's row and the kernel's own vouch.
// Nothing else reaches that entrypoint. Calls to the platform run through its
// router here, with the app's eid as their source. App code cannot choose it.
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
// anything else is ours, and the tracker hears it.
//
// Each call that goes out is counted on its `uses` link once it is answered,
// a write to the directory nobody waits on (@yaks/egress `defer`), and a link
// at its monthly cap is refused, saying whose limit it is and where the person
// calling connects a key of their own.
import { namesOf, USES } from '@yaks/connections'
import {
  type Caller,
  Capped,
  forward,
  type Host,
  Refused,
  sentinelsIn,
  usable,
} from '@yaks/egress'
import type { Comp } from '@yaks/graph'
import { mode, reads } from '@yaks/member'
import { ctxOf } from './connections.ts'
import { storesOf } from './attached.ts'
import { bound, type Env } from './env.ts'
import type { Answer, Asked } from './apps.ts'
import { background, caught, defect } from './defects.ts'
import { directory, directoryOf } from './directory.ts'
import * as dirPart from './directory.ts'
import { manageAt } from '@yaks/platform/routes'
import { apex } from '@yaks/platform/host'

// The outside service's own failure, carried past the catch below unchanged.
class Wire extends Error {
  was: unknown
  constructor(was: unknown) {
    super('the outside service did not answer')
    this.was = was
  }
}

/** The egress's host for an app's calls: the directory and the vault, as the
 * kernel, with each call's count written after its answer, kept alive past it,
 * and reported wherever it fails. A count that does not land is our failure,
 * never the caller's, so it is reported even when the directory refused it. */
export let egressOf = (
  env: Partial<Env> & Pick<Env, 'STORE'>,
  app: string,
): Host => ({
  ...ctxOf(env),
  defer: (work) =>
    background(
      work().then(
        () => {},
        (e) => defect(e, { request: 'outbound count', app }),
      ),
    ),
})

// Whose limit a capped call met and, where it is somebody else's, where the
// person calling connects a key of their own instead: the connections page of
// the space the app is in. A connection a person keeps for themselves names
// no space.
let whose = async (
  env: Partial<Env> & Pick<Env, 'STORE'>,
  e: Capped,
  app: string,
) => {
  let dir = directoryOf(env.STORE)
  let [owner, at] = await Promise.all([dir.at(e.owner), dir.appAt(app)])
  if (owner && owner.eid == at?.space.eid) {
    return 'The limit is this space’s own.'
  }
  let limit = owner
    ? `The limit is set by ${
      owner.title || owner.slug
    }, whose connection it is.`
    : 'The limit is set by whoever keeps that connection.'
  return at
    ? `${limit} Connect your own ${e.title} key at ${
      manageAt(at.space.slug, 'connections', env)
    } to call it without their limit.`
    : limit
}

// One call out, for a caller, with every ending but the service's own made an
// answer.
let sent = async (
  env: Partial<Env> & Pick<Env, 'STORE'>,
  caller: Caller,
  req: Request,
) => {
  let c = {
    ...egressOf(env, caller.app),
    fetch: (r: RequestInfo | URL, init?: RequestInit) =>
      fetch(r, init).catch((e) => {
        throw new Wire(e)
      }),
  }
  try {
    return await forward(c, caller, req)
  } catch (e) {
    if (e instanceof Capped) {
      let said = await whose(env, e, caller.app).catch((err) => {
        caught(err, { request: 'outbound cap', app: caller.app })
        return ''
      })
      return new Response(
        `yaks.app refused this call: ${e.message}. ${said}`.trim(),
        { status: 403 },
      )
    }
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

/** An app's worker calling out: the request as its code made it, for the
 * caller dispatch.ts said. */
export let outbound = (
  req: Request,
  env: Partial<Env> & Pick<Env, 'STORE'>,
  caller: Caller,
): Promise<Response> => sent(env, caller, req)

/** The dispatch namespace's trusted caller: platform requests enter the
 * same router as a public request, keyed by the app that made them. */
export let fromApp = async (
  req: Request,
  env: Env,
  caller: Caller,
  serve: (req: Request) => Promise<Response>,
): Promise<Response> => {
  let host = new URL(req.url).hostname
  let ours = host == apex(env) || host.endsWith(`.${apex(env)}`) ||
    await directory(bound(env.DIRECTORY, dirPart.fetch, env)).serves(host)
  if (!ours) return sent(env, caller, req)
  let headers = new Headers(req.headers)
  headers.set('cf-connecting-ip', caller.app)
  // The runtime's caller, rather than anything the app put in its request,
  // names the source at every platform door, including custom domains.
  return serve(new Request(req, { headers }))
}

// What a page's request says about the page and the platform, none of which
// the outside service is owed.
let OURS =
  /^(cookie|host|origin|referer|content-length|connection|x-real-ip|true-client-ip|(x-yak|cf|x-forwarded|sec)-)/i

let callerOf = ({ app, who }: Asked): Caller => ({
  app: app.eid,
  level: who.role,
  person: who.person,
})

// `./api/env`: the sentinel for each connected connection the app uses, by the
// name its code reads it by (one for each field of several, `S3_REGION`),
// where this visitor may call out through it: a shared one as its link
// allows, and their own where the app asks each person. Beside them, the
// address of each store the app is attached to (attached.ts).
// A direct link's key is for a worker's code and never a page's. Both doors
// are the app's to those who may read it, as its store doors are: a private
// app's link opened to anyone is open to anyone it lets in.
export let envDoor: Answer = async (asked) => {
  let { env, path, space, app, who, refuse } = asked
  if (path != '/env') return null
  if (!reads(mode(app.access), who.role)) return refuse('not_a_reader')
  let out: Record<string, string> = await storesOf(env, space, app)
  for (let r of await usable(ctxOf(env), callerOf(asked))) {
    let u = (r.link[USES] ?? {}) as Comp
    if (u.direct || typeof u.binding != 'string') continue
    let names = namesOf(u.binding, Object.keys(r.sentinels))
    for (let [f, name] of Object.entries(names)) out[name] = r.sentinels[f]
  }
  return Response.json(out)
}

// `./api/fetch?url=…`: the page's call, sent on to that address as it was
// made, minus what it says about us.
export let fetchDoor: Answer = async (asked) => {
  let { env, req, path, app, who, json, refuse } = asked
  if (path != '/fetch') return null
  if (!reads(mode(app.access), who.role)) return refuse('not_a_reader')
  let to = new URL(req.url).searchParams.get('url') ?? ''
  if (!URL.canParse(to)) {
    return json(400, 'bad_url', 'url= is the whole address to call')
  }
  let headers = [...req.headers].filter(([k]) => !OURS.test(k))
  let body = ['GET', 'HEAD'].includes(req.method)
    ? null
    : new Uint8Array(await req.arrayBuffer())
  if (
    !sentinelsIn(to, headers, body ? new TextDecoder().decode(body) : '').length
  ) {
    return json(
      400,
      'no_connection',
      "./api/fetch sends a call carrying a connection's sentinel (./api/env); " +
        'the page makes any other call itself',
    )
  }
  let res = await sent(
    env,
    callerOf(asked),
    new Request(to, { method: req.method, headers, body }),
  ).catch(() => json(502, 'unanswered', `${new URL(to).host} did not answer`))
  // A cookie from somebody else's service would be set on this app's origin.
  let back = new Headers(res.headers)
  back.delete('set-cookie')
  return new Response(res.body, { status: res.status, headers: back })
}

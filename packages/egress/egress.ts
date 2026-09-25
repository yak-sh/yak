// The egress: a call going out with a credential. An app never holds one. It
// holds sentinels (@yaks/secrets), and puts one wherever the service wants its
// key or token: a header, the query, the body. The egress finds each, checks
// who is calling and where the request goes, and sends it on with the
// credential in the sentinel's place, verbatim. A service that refuses an
// access token is asked once more, after the token is refreshed.
//
// A sentinel is a pointer, not a credential. It resolves only among the
// connections the calling app uses (@yaks/connections `used`), so one app
// cannot spend another's, and only for a caller the host vouches for: one
// holding a level on the app, or anyone at all where the app's `uses` link
// opened that connection to `anyone`, as a public widget's is (@yaks/member
// `callsOut`). So a sentinel that leaks into a page stays useless to a
// stranger. Where the app asks each person to connect their own, a person's
// connection is among them only for that person, whatever anybody else holds
// on the app, so one person's sentinel is useless to everyone else. The credential goes only to a host its integration names, over
// https, and a redirect the service answers comes back to the caller, whose
// next request is checked again.
//
// A request carrying no sentinel goes out as it came.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { callsOut, type Level } from '@yaks/member'
import { sentinels, swap } from '@yaks/secrets'
import {
  CONNECTION,
  credential,
  type Ctx,
  keyed,
  known,
  refresh,
  used,
  USES,
} from '@yaks/connections'

/** Who is calling out: the app, what the host vouches the caller holds on it
 * (@yaks/member) or `null` for nothing, and the person the host vouches they
 * are, or `null` for nobody signed in. */
export type Caller = { app: Eid; level: Level | null; person: Eid | null }

/** A call the egress will not send. */
export class Refused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Refused'
  }
}

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

// A body as one character per byte, and back: a sentinel is ASCII, so it is
// found in any body, text or not, and every other byte passes as it was.
let latin = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) {
    s += String.fromCharCode(...b.subarray(i, i + 8192))
  }
  return s
}
let bytes = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0))
let utf8 = (s: string) => latin(new TextEncoder().encode(s))

// The body goes whole, so its length is the runtime's to say.
let SIZED = ['content-length', 'transfer-encoding']

// One connection a request's sentinel stands for, checked, with the value that
// goes in its place.
type Hit = { eid: Eid; sentinel: string; value: string; oauth: boolean }

// The connections a request's sentinels stand for, once the caller may call
// out through each and the request goes where each may be sent.
let check = async (
  c: Ctx,
  caller: Caller,
  url: URL,
  found: string[],
): Promise<Hit[]> => {
  let mine = await used(c, caller.app, caller.person)
  return Promise.all(found.map(async (sentinel) => {
    let r = mine.find((r) => r.sentinel == sentinel)
    if (!r) {
      throw new Refused(
        `a sentinel stands for no connected connection ${caller.app} uses`,
      )
    }
    let eid = r.connection.entity.eid
    let name = String(comp(r.connection, CONNECTION).integration)
    // A person's own connection is theirs to spend (`used` found it for them
    // alone); a shared one asks what the caller holds on the app.
    let l = comp(r.link, USES)
    if (!l.each && !callsOut(l.anyone == true, caller.level)) {
      throw new Refused(`the caller may not call out through ${name}`)
    }
    let i = await known(c.graph.read, name)
    let hosts = i?.hosts ?? []
    if (!i || url.protocol != 'https:' || !hosts.includes(url.host)) {
      throw new Refused(
        `${name} is sent only to ${hosts.join(', ') || 'no host'}, over https`,
      )
    }
    let value = await credential(c, eid)
    if (!value) throw new Refused(`${name} holds no credential`)
    return { eid, sentinel, value, oauth: !keyed(i) }
  }))
}

/** Send a request for a caller, with the credential each of its sentinels
 * stands for in its place. A service that refuses an access token (401) is
 * asked once more with a refreshed one. */
export let forward = async (
  c: Ctx,
  caller: Caller,
  req: Request,
): Promise<Response> => {
  let send = c.fetch ?? fetch
  let url = new URL(req.url)
  let tail = req.url.slice(url.origin.length)
  let headers = [...req.headers].filter(([k]) => !SIZED.includes(k))
  let body = req.body ? latin(new Uint8Array(await req.arrayBuffer())) : null
  let found = [
    ...new Set([tail, ...headers.map(([, v]) => v), body ?? ''].flatMap(
      sentinels,
    )),
  ]
  let hits = found.length ? await check(c, caller, url, found) : []
  let sent = (by: Hit[]) => {
    let values = new Map(by.map((h) => [h.sentinel, h.value]))
    let raw = new Map(by.map((h) => [h.sentinel, utf8(h.value)]))
    return send(
      new Request(url.origin + swap(tail, values), {
        method: req.method,
        headers: headers.map((
          [k, v],
        ): [string, string] => [k, swap(v, values)]),
        body: body == null ? null : bytes(swap(body, raw)),
        redirect: by.length ? 'manual' : req.redirect,
        signal: req.signal,
      }),
    )
  }
  let res = await sent(hits)
  if (res.status != 401 || !hits.some((h) => h.oauth)) return res
  let again = await Promise.all(
    hits.map(async (h) =>
      h.oauth ? { ...h, value: await refresh(c, h.eid, h.value) ?? h.value } : h
    ),
  )
  if (again.every((h, n) => h.value == hits[n].value)) return res
  await res.body?.cancel()
  return sent(again)
}

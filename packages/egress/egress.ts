// The egress: a call going out with a credential. An app never holds one. It
// holds sentinels (@yaks/secrets), and puts one wherever the service wants its
// key or token: a header, a Basic credential, the query, the body. The egress
// finds each, checks
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
// Every call that goes out with a credential is counted on its link, by the
// month, once it is answered (./calls.ts), and a link with a `cap` refuses
// calls past it until the month turns. The count is written after the answer,
// when the host's `defer` runs it, so no caller waits on it.
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
import { calling, capOf, monthOf, spent } from './calls.ts'

/** Who is calling out: the app, what the host vouches the caller holds on it
 * (@yaks/member) or `null` for nothing, and the person the host vouches they
 * are, or `null` for nobody signed in. */
export type Caller = { app: Eid; level: Level | null; person: Eid | null }

/** A host-authorized credential, lent for one outbound call. Keep it only
 * while sending; persisted requests carry its sentinel, never its value. */
export type Grant = {
  sentinel: string
  value: string
  hosts: readonly string[]
}

/** What calling out needs of its host: @yaks/connections' context, and how
 * work the answer must not wait on is put off: counting the call on its link.
 * The host runs `work` once the call is answered (a Worker hands it to
 * `waitUntil`) and reports its failure; the caller has its answer by then. */
export type Host = Ctx & { defer: (work: () => Promise<unknown>) => void }

/** A call the egress will not send. */
export class Refused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Refused'
  }
}

/** A call refused because its link already made the calls its cap allows
 * this month. It names the connection's owner and its integration, so a host
 * can say whose limit it is and where to connect one's own. */
export class Capped extends Refused {
  /** the space or person the connection belongs to */
  owner: Eid
  /** the integration it goes through, by name */
  integration: string
  /** what a person calls that integration */
  title: string
  /** the calls a month the link may make */
  cap: number
  constructor(owner: Eid, integration: string, title: string, cap: number) {
    super(
      `${title} calls through this connection are capped at ${cap} a month ` +
        `for this app, and this month's are used up`,
    )
    this.name = 'Capped'
    this.owner = owner
    this.integration = integration
    this.title = title
    this.cap = cap
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

// A Basic credential is its `user:password` in base64, which is how curl's
// `-u` and a URL's userinfo (git's `https://x:<token>@host/`) send one. A
// sentinel in either half is found, and swapped, in the pair it encodes.
let BASIC = /^(basic\s+)([A-Za-z0-9+/]+=*)$/i
let basic = (v: string) => {
  let said = BASIC.exec(v)
  if (!said) return null
  try {
    return { scheme: said[1], pair: atob(said[2]) }
  } catch {
    return null
  }
}

// One connection a request's sentinel stands for, checked, with the value that
// goes in its place and the link the app uses it through.
type Hit = Grant & { eid: Eid; oauth: boolean; link: Eid }

let destination = (hosts: readonly string[], url: URL, name: string) => {
  if (url.protocol != 'https:' || !hosts.includes(url.host)) {
    throw new Refused(
      `${name} is sent only to ${hosts.join(', ') || 'no host'}, over https`,
    )
  }
}

// The connections the caller may use. A request checks its destination before
// reading credentials; a host grant lends its allowed destinations with them.
let check = async (
  c: Ctx,
  caller: Caller,
  found: readonly string[],
  month: string,
  url?: URL,
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
    if (url) destination(hosts, url, name)
    let cap = capOf(r.link)
    if (cap != null && spent(r.link, month) >= cap) {
      let owner = String(comp(r.connection, CONNECTION).owner)
      throw new Capped(owner, name, i?.title || name, cap)
    }
    let value = await credential(c, eid)
    if (!value) throw new Refused(`${name} holds no credential`)
    let link = r.link.entity.eid
    return { eid, sentinel, value, hosts, oauth: !keyed(i!), link }
  }))
}

// The month a call goes out in, by the host's clock.
let now = (c: Ctx) => monthOf(c.now?.() ?? Date.now())

// Each call counted on the link it went out through, after the answer. A
// write that throws at once is a failure like one that rejects.
let count = (c: Host, hits: readonly Hit[], month: string) => {
  if (!hits.length) return
  c.defer(async () =>
    await c.graph.apply(calling(hits.map((h) => h.link), month))
  )
}

/** Authorize only the requested sentinels for a vouched caller. Credentials
 * are refreshed when needed and lent only until the next outbound call. A
 * grant is lent for one call, so each is counted on its link as it is lent,
 * and a link past its cap lends none. */
export let grants = async (
  c: Host,
  caller: Caller,
  found: readonly string[],
): Promise<Grant[]> => {
  let month = now(c)
  let hits = await check(c, caller, found, month)
  count(c, hits, month)
  return hits.map(({ sentinel, value, hosts }) => ({ sentinel, value, hosts }))
}

// Prepare once so an OAuth retry sends the same body. Both host boundaries
// use this byte-preserving swap and prevent redirects carrying credentials.
let prepare = async (
  req: Request,
  send: typeof fetch,
) => {
  let url = new URL(req.url)
  let tail = req.url.slice(url.origin.length)
  let headers = [...req.headers].filter(([k]) => !SIZED.includes(k))
  let body = req.body ? latin(new Uint8Array(await req.arrayBuffer())) : null
  let found = [
    ...new Set(
      [
        tail,
        ...headers.flatMap(([, v]) => [v, basic(v)?.pair ?? '']),
        body ?? '',
      ].flatMap(sentinels),
    ),
  ]
  let sent = (by: readonly Grant[]) => {
    let values = new Map(by.map((h) => [h.sentinel, h.value]))
    let raw = new Map(by.map((h) => [h.sentinel, utf8(h.value)]))
    let header = (v: string) => {
      let b = basic(v)
      return b && sentinels(b.pair).length
        ? b.scheme + btoa(swap(b.pair, raw))
        : swap(v, values)
    }
    return send(
      new Request(url.origin + swap(tail, values), {
        method: req.method,
        headers: headers.map(([k, v]): [string, string] => [k, header(v)]),
        body: body == null ? null : bytes(swap(body, raw)),
        redirect: by.length ? 'manual' : req.redirect,
        signal: req.signal,
      }),
    )
  }
  return { url, found, sent }
}

/** Send using grants a trusted host has authorized for this call. Every
 * sentinel must have a grant for the destination; credentials follow no
 * redirects. The executor obtains grants at I/O, outside durable steps. */
export let granted = async (
  grants: readonly Grant[],
  req: Request,
  send: typeof fetch = fetch,
): Promise<Response> => {
  let { url, found, sent } = await prepare(req, send)
  let hits = found.map((sentinel) => {
    let grant = grants.find((g) => g.sentinel == sentinel)
    if (!grant) throw new Refused('a sentinel has no grant for this call')
    destination(grant.hosts, url, 'the granted credential')
    return grant
  })
  return sent(hits)
}

/** Send a request for a caller, with the credential each of its sentinels
 * stands for in its place. A service that refuses an access token (401) is
 * asked once more with a refreshed one. Once answered, the call is counted
 * on each link it went out through, once, however many times it was asked. */
export let forward = async (
  c: Host,
  caller: Caller,
  req: Request,
): Promise<Response> => {
  let { url, found, sent } = await prepare(req, c.fetch ?? fetch)
  let month = now(c)
  let hits = found.length ? await check(c, caller, found, month, url) : []
  let res = await sent(hits)
  count(c, hits, month)
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

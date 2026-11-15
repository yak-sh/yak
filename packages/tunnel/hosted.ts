// The hosting half, exported as `@yaks/tunnel/hosted`: what a platform that
// hosts spaces answers about the tunnels they have to machines, and how it
// passes a request through one. ./routes.ts is the machine's end; this is the
// other.
//
// The platform's door (`door`, at ./effects.ts `TELL`) answers a space's
// tunnel to its owner and to the platform's own owner, and changes it:
//
//   GET  ?space=ada                    the tunnel, or null
//   POST space=ada do=connect port=N   a new tunnel, service and gateway; the
//                                      token once
//   POST space=ada do=rotate           the gateway put again, and a new token
//                                      for a tunnel the platform made, once
//   POST space=ada do=disconnect       the tunnel gone, and what the platform
//                                      made
//   POST space=ada do=adopt tunnel=… service=…   record a pair made elsewhere,
//                                      with a gateway in front
//   POST do=tell conversation=… key=… text=… [about=…]   the machine telling
//                                      its owner what changed there
//                                      (./effects.ts)
//
// The space's owner connects, rotates and disconnects. Adopting is the
// platform owner's alone: the ids name resources in the platform's account,
// and a space that could write any service id could reach somebody else's
// machine. An adopted pair is only recorded, so disconnecting it forgets the
// ids, and rotating it only puts its gateway again; whoever made the tunnel
// rotates and removes it. A tunnel's token is answered once and never kept.
//
// A request reaches a machine two ways: an app's own worker asking for it
// (`reach`), built in the space and never an installed copy, and the space's
// owner asking with no app between (`machine`), by their connector or their
// Operator, which reaches only its own space's machine (`owners`). Either way
// the request goes on to the space's gateway (./gateway.ts) with the
// platform's own words taken off and its word on who is asking put on
// (`onward`), and every way it can fail to arrive is an answer.
//
// What only the host can do comes in as data: who is asking and where they
// stand (`Keeping`), and the call that hands a request to a gateway
// (`Relay`), which is a Workers for Platforms dispatch binding on yaks.app.
import { VIA } from '@yaks/api'
import type { Eid } from '@yaks/graph'
import {
  type Api,
  connect,
  disconnect,
  type Gateways,
  tunnels,
} from './cloudflare.ts'
import type { Told } from './effects.ts'
import { BY, CALLER, WITH } from './gateway.ts'

/** A tunnel as its host records it on the entity it reaches a machine from
 * (the `tunnel` component): its id, the VPC Service its gateway is bound to,
 * and whether it was made elsewhere and only recorded here. */
export type Tunnel = { id: string; service: string; adopted: boolean }

/** A space as this module reads it: its slug, and its tunnel or none. */
export type Held = { slug: string; tunnel: Tunnel | null }

/** Who is asking a machine, as the platform tells it (`CALLER`): an `app`'s
 * own worker; the owner's `operator`, in a conversation or a run of its own;
 * or the owner's own `connector`, the assistant they signed in to the
 * platform from. A machine's config opens paths, tools and a persona to each
 * by this word. */
export type Caller = 'app' | 'operator' | 'connector'

/** Who asks a machine for its owner: their connector unless it says their
 * Operator, which also names its space and the conversation it asks in
 * (`via`), where there is one. A request that carries the owner's own words
 * as they gave them, and nobody's reading of them, is their `own` act: the
 * machine is told who they are (`BY`), and writes it as theirs. Only the host
 * says so, of words it read itself. */
export type Calling =
  & { via?: () => Promise<string | undefined> | string | undefined }
  & { own?: boolean }
  & ({ caller: 'connector' } | { caller: 'operator'; space: string })

/** One call through a space's gateway, as its host makes it: the machine's
 * answer, null where the tunnel has no gateway, and a throw where the tunnel
 * or the machine did not answer. */
export type Relay = (out: Request) => Promise<Response | null>

/** The name of the gateway in front of the tunnel of the space `eid`, in the
 * namespace the host uploads gateways to (./cloudflare.ts `gateways`). */
export let gatewayOf = (eid: string): string => `tunnel-${eid}`

/** Where an app's worker asks for its space's machine, under the app's own
 * doors: `/tunneled/mail/inbound` is `/mail/inbound` on the machine. */
export let TUNNELED = '/tunneled/'

/** A refusal as this module answers one: its code, and the sentence it says. */
export type Ending = { status: number; code: string; message: string }

let ending = (e: Ending): Response =>
  Response.json({ error: { code: e.code, message: e.message } }, {
    status: e.status,
  })

let refused = (status: number, code: string, message: string): Response =>
  ending({ status, code, message })

// How a call that reached no machine ends, said the same to an app's worker
// and to the tunnel's owner.
let NO_TUNNEL = (space: Held): Ending => ({
  status: 404,
  code: 'no_tunnel',
  message:
    `${space.slug} has no tunnel to a machine; its owner makes one first`,
})
let NO_GATEWAY = (space: Held): Ending => ({
  status: 503,
  code: 'no_gateway',
  message:
    `${space.slug}'s tunnel has no gateway; its owner rotates the tunnel to make one`,
})
let UNREACHED = (space: Held): Ending => ({
  status: 502,
  code: 'unreached',
  message: `the machine ${space.slug}'s tunnel goes to did not answer`,
})

// ── A request on its way to a machine ───────────────────────────────────────

// The platform's own words about a request (the grants, who is looking), none
// of which is the machine's business, and the words it says to the machine
// itself: no caller's request names the conversation it was made in, or who
// is asking.
let OURS = /^(cookie|x-via)$|^x-yak-/

/** A request as it goes on to a machine: `req`'s method, body and headers at
 * `path` there, with the platform's own words taken off and its word on who
 * is asking put on: the conversation it was made in (`via`), whose that is
 * (`with`, only beside `via`) and whose own act it is (`by`). */
export let onward = (
  path: string,
  req: Request,
  caller: Caller,
  said: { via?: string; with?: string; by?: string } = {},
): Request => {
  let headers = new Headers()
  for (let [k, v] of req.headers) if (!OURS.test(k)) headers.set(k, v)
  headers.set(CALLER, caller)
  if (said.via) headers.set(VIA, said.via)
  if (said.via && said.with) headers.set(WITH, said.with)
  if (said.by) headers.set(BY, said.by)
  return new Request(`http://machine${path}`, {
    method: req.method,
    headers,
    body: req.body,
    redirect: 'manual',
    signal: req.signal,
  })
}

// `out` through the relay, or how it failed to arrive; a throw is told to
// `report` where there is one.
let relayed = async (
  space: Held,
  relay: Relay,
  out: Request,
  report?: (e: unknown) => void,
): Promise<Response> => {
  try {
    return await relay(out) ?? ending(NO_GATEWAY(space))
  } catch (e) {
    report?.(e)
    return ending(UNREACHED(space))
  }
}

/** An app as this module reads it: its slug, and whether it is an installed
 * copy of somebody else's. */
export type Reaching = { slug: string; installed?: unknown }

/** Why `app` may not reach the machine its space's tunnel goes to, or null
 * where it may: only an app built in the space reaches it, since an installed
 * copy's code was written elsewhere and a tunnel reaches into the owner's own
 * machine, and only while the space has a tunnel. */
export let barred = (space: Held, app: Reaching): Ending | null =>
  app.installed
    ? {
      status: 403,
      code: 'installed',
      message:
        `${app.slug} is an installed copy, and only an app built in ${space.slug} reaches the machine its tunnel goes to`,
    }
    : !space.tunnel
    ? NO_TUNNEL(space)
    : null

/** An app's own worker reaching the machine its space's tunnel goes to, at
 * `path` under its doors, or null for a path not at `TUNNELED`. `itself` is
 * whether the host knows the request for the app's own worker: nothing a
 * visitor holds opens it. The request goes on as an `app`'s, and the machine
 * decides what it answers. A throw from the relay is told to `report`. */
export let reach = async (
  req: Request,
  path: string,
  at: { space: Held; app: Reaching; itself: boolean },
  relay: Relay,
  report?: (e: unknown) => void,
): Promise<Response | null> => {
  if (!path.startsWith(TUNNELED)) return null
  if (!at.itself) {
    return refused(
      403,
      'not_the_app',
      "only the app's own worker reaches the machine its space's tunnel goes to",
    )
  }
  let bar = barred(at.space, at.app)
  if (bar) return ending(bar)
  let rest = path.slice(TUNNELED.length - 1) + new URL(req.url).search
  return await relayed(at.space, relay, onward(rest, req, 'app'), report)
}

/** Whether `asking` reaches the machine of the space `at` for a person seated
 * there as `role`: its owner alone, and their Operator only from that space,
 * since another space's members shape its instructions and memory. */
export let owners = (
  role: string | null | undefined,
  at: string,
  asking: Calling,
): boolean =>
  role == 'owner' && (asking.caller != 'operator' || asking.space == at)

/** The machine `space`'s tunnel goes to, as a `fetch` for its owner `person`,
 * asked as `asking` says (whom the host has found `owners`). Only the path of
 * what it is asked for is meant. Every ending is an answer: a space with no
 * tunnel, a tunnel with no gateway and a machine that is off are the machine
 * being unavailable to its owner. */
export let machine = (
  space: Held,
  person: string,
  asking: Calling,
  relay: Relay,
): typeof fetch =>
async (input, init) => {
  if (!space.tunnel) return ending(NO_TUNNEL(space))
  let req = new Request(input, init)
  let { pathname, search } = new URL(req.url)
  let out = onward(pathname + search, req, asking.caller, {
    via: await asking.via?.(),
    with: person,
    by: asking.own ? person : undefined,
  })
  return await relayed(space, relay, out)
}

// ── The door ────────────────────────────────────────────────────────────────

/** A space as the door finds it for whoever asks: its tunnel, and whether
 * they own it or own the platform. */
export type Kept = Held & { eid: string; owner: boolean; platform: boolean }

/** What the door reads and writes through its host. */
export type Keeping = {
  /** the account tunnels are made in, or null until the host has its token */
  account: Api | null
  /** the namespace gateways are uploaded to, or null until the host can */
  gateways: Gateways | null
  /** who is asking, by the host's id for them, or null for nobody */
  who: () => Promise<string | null>
  /** the space `slug`, as `person` stands in it, or null for none */
  find: (slug: string, person: string | null) => Promise<Kept | null>
  /** the tunnel recorded on the space `eid`, or none */
  write: (eid: string, row: Tunnel | null) => Promise<unknown>
  /** what the machine tells its owner `person`, taken in by the host: what
   * it answers, or null where none of their spaces with a tunnel holds the
   * conversation */
  tell: (person: string, told: Told) => Promise<object | null>
}

// A Cloudflare id, as the API spells one: a uuid. An eid is spelled the same.
let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let NO_ACCOUNT = 'the platform has no account token to make tunnels with'
let NO_UPLOAD = "the platform has no token to upload a tunnel's gateway with"

let shown = (space: Held, tunnel: Tunnel | null, more = {}): Response =>
  Response.json({ space: space.slug, tunnel, ...more })

/** The platform's door onto its spaces' tunnels, as the header says. */
export let door = async (req: Request, host: Keeping): Promise<Response> => {
  if (req.method != 'GET' && req.method != 'POST') {
    return refused(
      405,
      'method_not_allowed',
      'get the tunnel, or post a change',
    )
  }
  let form = req.method == 'POST' ? await req.formData() : null
  let said = (k: string) =>
    String(form?.get(k) ?? new URL(req.url).searchParams.get(k) ?? '')
  let person = await host.who()
  if (form && said('do') == 'tell') return await heard(host, person, said)
  let space = said('space') ? await host.find(said('space'), person) : null
  if (!space) {
    return refused(
      404,
      'no_space',
      `no space is called ${said('space') || '""'}`,
    )
  }
  if (!space.owner && !space.platform) {
    return refused(403, 'not_owner', `${space.slug}'s machine is its owner's`)
  }
  if (req.method == 'GET') return shown(space, space.tunnel)
  return await changed(host, space, said)
}

// A knock from the machine (./effects.ts `platformTell`): only its owner
// tells it, by their own connection, and it names its conversation and
// itself, and says something. What it tells of rides with it where it is an
// eid.
let heard = async (
  host: Keeping,
  person: string | null,
  said: (k: string) => string,
): Promise<Response> => {
  if (!person) {
    return refused(
      403,
      'not_owner',
      "a machine tells only its owner's Operator",
    )
  }
  let [conversation, key, text, about] = [
    'conversation',
    'key',
    'text',
    'about',
  ]
    .map(said)
  if (!conversation || !key || !text.trim()) {
    return refused(
      400,
      'bad_tell',
      'a knock names its conversation and itself, and says something',
    )
  }
  let told: Told = {
    conversation,
    key: key as Eid,
    text,
    ...UUID.test(about) ? { about: about as Eid } : {},
  }
  let answer = await host.tell(person, told)
  return answer ? Response.json(answer) : refused(
    404,
    'no_conversation',
    `no space of yours with a tunnel holds ${conversation}`,
  )
}

// A change to `space`'s tunnel, by its owner or the platform's.
let changed = async (
  host: Keeping,
  space: Kept,
  said: (k: string) => string,
): Promise<Response> => {
  let held = space.tunnel
  let act = said('do')
  let gateway = gatewayOf(space.eid)
  if (act == 'adopt') {
    if (!space.platform) {
      return refused(
        403,
        'not_platform',
        "adopting names the platform's own resources, so the platform's owner does it",
      )
    }
    // A pair the platform made would be left running with nothing naming it.
    if (held && !held.adopted) {
      return refused(
        409,
        'has_tunnel',
        `${space.slug} has a tunnel; disconnect it first`,
      )
    }
    let [id, service] = [said('tunnel'), said('service')]
    if (!UUID.test(id) || !UUID.test(service)) {
      return refused(400, 'bad_ids', 'tunnel and service are each a uuid')
    }
    if (!host.gateways) return refused(503, 'no_token', NO_UPLOAD)
    await host.gateways.put(gateway, service)
    let row = { id, service, adopted: true }
    await host.write(space.eid, row)
    return shown(space, row)
  }
  if (!space.owner) {
    return refused(403, 'not_owner', `${space.slug}'s machine is its owner's`)
  }
  if (act == 'connect') {
    if (held) {
      return refused(409, 'has_tunnel', `${space.slug} has a tunnel already`)
    }
    let port = Number(said('port'))
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return refused(400, 'bad_port', 'port is the one the machine serves on')
    }
    let { account, gateways } = host
    if (!account) return refused(503, 'no_token', NO_ACCOUNT)
    if (!gateways) return refused(503, 'no_token', NO_UPLOAD)
    let made = await connect(account, `space-${space.eid}`, { port })
    let row = { id: made.tunnel, service: made.service, adopted: false }
    try {
      await gateways.put(gateway, made.service)
      await host.write(space.eid, row)
    } catch (e) {
      await gateways.remove(gateway)
      await disconnect(account, made)
      throw e
    }
    return shown(space, row, { token: made.token })
  }
  if (act != 'rotate' && act != 'disconnect') {
    return refused(
      400,
      'bad_do',
      'do is connect, rotate, disconnect, adopt or tell',
    )
  }
  if (!held) return refused(404, 'no_tunnel', `${space.slug} has no tunnel`)
  let { account, gateways } = host
  if (!gateways) return refused(503, 'no_token', NO_UPLOAD)
  if (!held.adopted && !account) return refused(503, 'no_token', NO_ACCOUNT)
  if (act == 'rotate') {
    // An adopted tunnel is rotated where it was made; its gateway is ours.
    let token = account && !held.adopted
      ? await tunnels(account).rotate(held.id)
      : undefined
    await gateways.put(gateway, held.service)
    return shown(space, held, { token })
  }
  await gateways.remove(gateway)
  if (account && !held.adopted) {
    await disconnect(account, { tunnel: held.id, service: held.service })
  }
  await host.write(space.eid, null)
  return shown(space, null)
}

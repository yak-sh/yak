// `/api/tunnel`: the tunnel a space has to a machine (@yaks/tunnel, D-39583).
// The machine runs `cloudflared` with its tunnel's token and dials out, so it
// opens no port; the space's apps reach the paths it opens to them through the
// tunnel's gateway, and never the machine itself.
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
//
// The space's owner connects, rotates and disconnects. Adopting is the
// platform owner's alone (a seat in `yak`, the fee's gate, sell.ts `fees`):
// the ids name resources in the platform's account, and a space that could
// write any service id could reach somebody else's machine. An adopted pair is
// only recorded here, so disconnecting it forgets the ids, and rotating it
// only puts its gateway again; whoever made the tunnel rotates and removes it.
//
// The gateway is the one Worker bound to the tunnel's VPC Service
// (@yaks/tunnel gateway.ts), a script in the apps' dispatch namespace named
// for the space, so only this Worker calls it. An app's own worker reaches it
// as `env.BOX` or whatever its config's `vpc_services` names (dispatch.ts
// `shim`), which is `/api/tunneled/…` at the app's address acting as the app
// (`reach` below, through apps.ts): an app built in the space, never an
// installed copy and never a visitor. The gateway marks every request it
// passes on as the tunnel's, so an app never holds the binding, and the
// machine's server answers a marked request only at the paths its owner
// opened to the tunnel (@yaks/tunnel filter.ts).
//
// The space's owner reaches the same gateway with no app between (`machine`
// below): the MCP servers they keep on the machine are asked through it
// (mcp-remote.ts), each request naming the Operator conversation it was made
// in (`x-via`), which no app's request may say for itself. Both go through
// the one call (`through`).
//
// Every request handed to a gateway says which of the three is asking, in a
// word only this Worker sets (`x-yak-caller`, `Caller` below): an app's
// worker, the owner's Operator, or the owner's own connector. The machine's
// config opens a path to all of them or to the ones it names, so its owner
// can lend the Operator tools and model steps that no app in the space can
// reach.
//
// A tunnel's token is answered to the caller once and never kept or logged:
// the machine's `yak` puts it straight into its own vault. A website session
// or an OAuth token opens this door, never a pasted grant. Under `/api/`, the same-origin
// guard (route.ts `guarded`) stands in front of it the way it stands in front
// of the fee.
import {
  type Api,
  BY,
  CALLER,
  connect,
  disconnect,
  gateways,
  tunnels,
} from '@yaks/tunnel'
import * as dirPart from './directory.ts'
import {
  type App,
  directory,
  type Space,
  stamp,
  type Tunnel,
} from './directory.ts'
import type { Who } from './session.ts'
import { itsApp, namespace, nowhere, script } from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { resent } from '@yaks/cloudflare/api'
import type { Answer } from './apps.ts'
import { caught } from './defects.ts'
import { adminWho } from './asking.ts'

/** Where an app's worker asks for its space's machine. */
export let TUNNELED = '/tunneled/'

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

// The account the platform makes tunnels in, or null until its token is set.
// Its calls, and the gateways' below, go through the fetch every Cloudflare
// call does (@yaks/cloudflare/api).
let account = (env: Env): Api | null =>
  env.CF_TUNNEL_TOKEN && env.CF_ACCOUNT
    ? { account: env.CF_ACCOUNT, token: env.CF_TUNNEL_TOKEN, fetch: resent }
    : null

let NO_TOKEN =
  'the platform has no Cloudflare token to make tunnels with (CF_TUNNEL_TOKEN)'

// The gateways, in the namespace the apps' workers live in and uploaded with
// the token that uploads those (dispatch.ts), or null until it is set.
let front = (env: Env) =>
  env.CF_WORKERS_TOKEN && env.CF_ACCOUNT
    ? gateways(
      { account: env.CF_ACCOUNT, token: env.CF_WORKERS_TOKEN, fetch: resent },
      namespace(env),
    )
    : null

let NO_GATEWAY =
  "the platform has no Cloudflare token to upload a tunnel's gateway with " +
  '(CF_WORKERS_TOKEN)'

/** The script a space's gateway is, in the apps' namespace: an app's script
 * name always holds an underscore (dispatch.ts `scriptName`), and this never
 * does. */
export let gatewayOf = (space: Pick<Space, 'eid'>) => `tunnel-${space.eid}`

// Written through the kernel's door: every property of `tunnel` is stamped.
let wrote = (env: Env, space: Space, row: Tunnel | null) =>
  stamp(env, { entities: [{ entity: { eid: space.eid }, tunnel: row }] })

let shown = (space: Space, tunnel: Tunnel | null, more = {}) =>
  Response.json({ space: space.slug, tunnel, ...more })

// A Cloudflare id, as the API spells one: a uuid.
let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (req.method != 'GET' && req.method != 'POST') {
    return json(405, 'method_not_allowed', 'get the tunnel, or post a change')
  }
  let form = req.method == 'POST' ? await req.formData() : null
  let said = (k: string) =>
    String(form?.get(k) ?? new URL(req.url).searchParams.get(k) ?? '')
  let dir = dirOf(env)
  let space = said('space') ? await dir.space(said('space')) : null
  if (!space) {
    return json(404, 'no_space', `no space is called ${said('space') || '""'}`)
  }
  let who = await adminWho(
    env,
    req,
    (person) => dir.role(space, person),
  )
  let meta = await dir.space(dirPart.META.space)
  let platform = !!who.person && !!meta &&
    await dir.role(meta, who.person) == 'owner'
  let owner = who.role == 'owner'
  if (!owner && !platform) {
    return json(403, 'not_owner', `${space.slug}'s machine is its owner's`)
  }
  let held = space.tunnel
  let act = said('do')
  if (req.method == 'GET') return shown(space, held)

  if (act == 'adopt') {
    if (!platform) {
      return json(
        403,
        'not_platform',
        `adopting names the platform's own resources: an owner of ${meta?.slug} does it`,
      )
    }
    // A pair the platform made would be left running with nothing naming it.
    if (held && !held.adopted) {
      return json(
        409,
        'has_tunnel',
        `${space.slug} has a tunnel; disconnect it first`,
      )
    }
    let [id, service] = [said('tunnel'), said('service')]
    if (!UUID.test(id) || !UUID.test(service)) {
      return json(400, 'bad_ids', 'tunnel and service are each a uuid')
    }
    let g = front(env)
    if (!g) return json(503, 'no_token', NO_GATEWAY)
    await g.put(gatewayOf(space), service)
    let row = { id, service, adopted: true }
    await wrote(env, space, row)
    return shown(space, row)
  }
  if (!owner) {
    return json(403, 'not_owner', `${space.slug}'s machine is its owner's`)
  }
  if (act == 'connect') {
    if (held) {
      return json(409, 'has_tunnel', `${space.slug} has a tunnel already`)
    }
    let port = Number(said('port'))
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return json(400, 'bad_port', 'port is the one the machine serves on')
    }
    let api = account(env)
    if (!api) return json(503, 'no_token', NO_TOKEN)
    let g = front(env)
    if (!g) return json(503, 'no_token', NO_GATEWAY)
    let made = await connect(api, `space-${space.eid}`, { port })
    let row = { id: made.tunnel, service: made.service, adopted: false }
    try {
      await g.put(gatewayOf(space), made.service)
      await wrote(env, space, row)
    } catch (e) {
      await g.remove(gatewayOf(space))
      await disconnect(api, made)
      throw e
    }
    return shown(space, row, { token: made.token })
  }
  if (act != 'rotate' && act != 'disconnect') {
    return json(400, 'bad_do', 'do is connect, rotate, disconnect or adopt')
  }
  if (!held) return json(404, 'no_tunnel', `${space.slug} has no tunnel`)
  let g = front(env)
  if (!g) return json(503, 'no_token', NO_GATEWAY)
  let api = account(env)
  if (!held.adopted && !api) return json(503, 'no_token', NO_TOKEN)
  if (act == 'rotate') {
    // An adopted tunnel is rotated where it was made; its gateway is ours.
    let token = api && !held.adopted
      ? await tunnels(api).rotate(held.id)
      : undefined
    await g.put(gatewayOf(space), held.service)
    return shown(space, held, { token })
  }
  await g.remove(gatewayOf(space))
  if (api && !held.adopted) {
    await disconnect(api, { tunnel: held.id, service: held.service })
  }
  await wrote(env, space, null)
  return shown(space, null)
}

// The platform's own words about a request (the grants, who is looking), none
// of which is the machine's business, and the words it says to the machine
// itself: no caller's request names the conversation it was made in, or who
// is asking.
let OURS = /^(cookie|x-via)$|^x-yak-/

/** Who is asking a machine, as the platform tells it (@yaks/tunnel `CALLER`):
 * an `app`'s own worker; the owner's `operator`, in a conversation or a run of
 * its own; or the owner's own `connector`, the assistant they signed in to
 * yaks.app from, calling `command`. A machine's config opens paths, tools and
 * a persona to each by this word. */
export type Caller = 'app' | 'operator' | 'connector'

/** Who asks a machine for its owner: their connector unless it says their
 * Operator, which also names its space and the conversation it asks in
 * (`via`), where there is one. An Operator reaches only the machine of its own
 * space's tunnel: another space's members shape its instructions and memory,
 * so the owner's machine is no tool of theirs. A request that carries the owner's own words as they gave them, and
 * nobody's reading of them, is their `own` act: the machine is told who they
 * are (@yaks/tunnel `BY`), and writes it as theirs. Only the host says so, of
 * words it read itself: nothing a model or an app sends does. */
export type Calling =
  & { via?: () => Promise<string | undefined> | string | undefined }
  & { own?: boolean }
  & ({ caller: 'connector' } | { caller: 'operator'; space: string })

/** The header that names the conversation a request to a machine was made in:
 * an Operator's conversation with the tunnel's owner, by the id of its session
 * in the Operator's store. A request made in none carries no such header. */
export let VIA = 'x-via'

// A request as it goes on to a machine: `req`'s method, body and headers at
// `path` there, with the platform's own words taken off and its word on who
// is asking put on.
let onward = (
  path: string,
  req: Request,
  caller: Caller,
  via?: string,
  by?: string,
) => {
  let headers = new Headers()
  for (let [k, v] of req.headers) if (!OURS.test(k)) headers.set(k, v)
  headers.set(CALLER, caller)
  if (via) headers.set(VIA, via)
  if (by) headers.set(BY, by)
  return new Request(`http://machine${path}`, {
    method: req.method,
    headers,
    body: req.body,
    redirect: 'manual',
    signal: req.signal,
  })
}

/** The one call through a space's tunnel: `out` handed to the space's gateway,
 * which marks it as the tunnel's and passes it to the machine. The namespace
 * runs every script for an app and its visitor (dispatch.ts `script`), so the
 * call names who asks. Null for a tunnel with no gateway; a throw is the
 * tunnel or the machine not answering. */
export let through = async (
  env: Pick<Env, 'DISPATCH'>,
  space: Pick<Space, 'eid'>,
  app: Pick<App, 'eid'>,
  who: Pick<Who, 'person' | 'role'>,
  out: Request,
): Promise<Response | null> => {
  if (!env.DISPATCH) return null
  try {
    return await script(env.DISPATCH, gatewayOf(space), app, who).fetch(out)
  } catch (e) {
    if (nowhere(e)) return null
    throw e
  }
}

// How a call that reached no machine ends, said the same to an app's worker
// and to the tunnel's owner.
let ENDS = {
  no_tunnel: (space: Space) => `${space.slug} has no tunnel`,
  no_gateway: (space: Space) =>
    `${space.slug}'s tunnel has no gateway; its owner rotates the tunnel to make one`,
  unreached: (space: Space) =>
    `the machine ${space.slug}'s tunnel goes to did not answer`,
}

/** An app's own worker reaching the machine its space's tunnel goes to, as
 * the app itself: nothing a visitor holds opens it, and an installed copy's
 * code was written elsewhere. The path and the app's request go on to the
 * space's gateway, which marks it as the tunnel's; the machine decides what it
 * answers. */
export let reach: Answer = async (
  { env, req, path, space, app, who, json },
) => {
  if (!path.startsWith(TUNNELED)) return null
  if (!itsApp(who, app)) {
    return json(
      403,
      'not_the_app',
      "only the app's own worker reaches the machine its space's tunnel goes to",
    )
  }
  if (app.installed) {
    return json(
      403,
      'installed',
      `${app.slug} is an installed copy, and only an app built in ${space.slug} reaches the machine its tunnel goes to`,
    )
  }
  if (!space.tunnel) return json(404, 'no_tunnel', ENDS.no_tunnel(space))
  let out = onward(
    path.slice(TUNNELED.length - 1) + new URL(req.url).search,
    req,
    'app',
  )
  try {
    return await through(env, space, app, who, out) ??
      json(503, 'no_gateway', ENDS.no_gateway(space))
  } catch (e) {
    caught(e, { request: 'tunnel', space: space.slug, app: app.slug })
    return json(502, 'unreached', ENDS.unreached(space))
  }
}

/** The machine a space's tunnel goes to, as a `fetch` for the space's owner
 * and nobody else: null to a member, to a stranger, and for a space that is
 * gone. Who owns the space is read from the whole directory as this call
 * finds it, never from a narrowed view of it or from a row written earlier.
 * Only the path of what it is asked for is meant, and each request goes on
 * saying who asks for the owner (`asking`): their connector, or their
 * Operator and the conversation it is made in, where there is one. Every
 * ending is an answer, as `reach` gives it: a space with no tunnel, a tunnel
 * with no gateway and a machine that is off are the machine being unavailable
 * to its owner, and no fault of the platform's to report. */
export let machine = async (
  env: Env,
  at: string,
  person: string,
  asking: Calling = { caller: 'connector' },
): Promise<typeof globalThis.fetch | null> => {
  if (!person || !at) return null
  let dir = dirOf(env)
  let [space, seats] = await Promise.all([dir.at(at), dir.sitting(person)])
  let role = seats.get(at)
  if (!space || space.trashed || role != 'owner') return null
  if (asking.caller == 'operator' && asking.space != at) return null
  return async (input, init) => {
    if (!space.tunnel) return json(404, 'no_tunnel', ENDS.no_tunnel(space))
    let req = new Request(input, init)
    let { pathname, search } = new URL(req.url)
    let out = onward(
      pathname + search,
      req,
      asking.caller,
      await asking.via?.(),
      asking.own ? person : undefined,
    )
    // Asked for the space itself, which is no app: a gateway calls nothing
    // out, so no connection is lent on this call.
    try {
      return await through(env, space, space, { person, role }, out) ??
        json(503, 'no_gateway', ENDS.no_gateway(space))
    } catch {
      return json(502, 'unreached', ENDS.unreached(space))
    }
  }
}

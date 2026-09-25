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
// (`reach` below, through tunnel_door.ts): an app built in the space, never an
// installed copy and never a visitor. The gateway marks every request it
// passes on as the tunnel's, so an app never holds the binding, and the
// machine's server answers a marked request only at the paths its owner
// opened to the tunnel (@yaks/tunnel filter.ts).
//
// A tunnel's token is answered to the caller once and never kept or logged:
// the machine's `yak` puts it straight into its own vault. Session
// cookie only, never an agent's bearer, and under `/api/`, so the same-origin
// guard (route.ts `guarded`) stands in front of it the way it stands in front
// of the fee.
import { type Api, connect, disconnect, gateways, tunnels } from '@yaks/tunnel'
import * as dirPart from './directory.ts'
import { directory, type Space, stamp, type Tunnel } from './directory.ts'
import { itsApp, namespace, nowhere, script } from './dispatch.ts'
import { bound, type Env } from './env.ts'
import type { Answer } from './plugin.ts'
import { caught } from './sentry.ts'
import { whoIs } from './session.ts'
import { TUNNELED } from './tunnel_door.ts'

let dirOf = (env: Env) =>
  directory(bound(env.DIRECTORY, dirPart.fetch, env), true)

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

// The account the platform makes tunnels in, or null until its token is set.
let account = (env: Env): Api | null =>
  env.CF_TUNNEL_TOKEN && env.CF_ACCOUNT
    ? { account: env.CF_ACCOUNT, token: env.CF_TUNNEL_TOKEN }
    : null

let NO_TOKEN =
  'the platform has no Cloudflare token to make tunnels with (CF_TUNNEL_TOKEN)'

// The gateways, in the namespace the apps' workers live in and uploaded with
// the token that uploads those (dispatch.ts), or null until it is set.
let front = (env: Env) =>
  env.CF_WORKERS_TOKEN && env.CF_ACCOUNT
    ? gateways(
      { account: env.CF_ACCOUNT, token: env.CF_WORKERS_TOKEN },
      namespace(env),
    )
    : null

let NO_GATEWAY =
  "the platform has no Cloudflare token to upload a tunnel's gateway with " +
  '(CF_WORKERS_TOKEN)'

/** The script a space's gateway is, in the apps' namespace: an app's script
 * name always holds an underscore (dispatch.ts `scriptName`), and this never
 * does. */
export let gatewayOf = (space: Space) => `tunnel-${space.eid}`

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
  let who = await whoIs(
    req,
    env.SESSION_SECRET,
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
// of which is the machine's business.
let OURS = /^x-yak-/

/** An app's own worker reaching the machine its space's tunnel goes to, as
 * the app itself: nothing a visitor holds opens it, and an installed copy's
 * code was written elsewhere. The path and the app's request go on to the
 * space's gateway, which marks it as the tunnel's; the machine decides what it
 * answers. */
export let reach: Answer = async (
  { env, req, path, space, app, who, json },
) => {
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
  if (!space.tunnel) {
    return json(404, 'no_tunnel', `${space.slug} has no tunnel`)
  }
  let headers = new Headers()
  for (let [k, v] of req.headers) if (!OURS.test(k)) headers.set(k, v)
  headers.delete('cookie')
  let out = new Request(
    `http://machine${path.slice(TUNNELED.length - 1)}${
      new URL(req.url).search
    }`,
    { method: req.method, headers, body: req.body, redirect: 'manual' },
  )
  let none = () =>
    json(
      503,
      'no_gateway',
      `${space.slug}'s tunnel has no gateway; its owner rotates the tunnel to make one`,
    )
  if (!env.DISPATCH) return none()
  try {
    return await script(env.DISPATCH, gatewayOf(space), app, who).fetch(out)
  } catch (e) {
    if (nowhere(e)) return none()
    caught(e, { request: 'tunnel', space: space.slug, app: app.slug })
    return json(
      502,
      'unreached',
      `the machine ${space.slug}'s tunnel goes to did not answer`,
    )
  }
}

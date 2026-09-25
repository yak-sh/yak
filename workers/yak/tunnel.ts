// `/api/tunnel`: the machine a space is linked to (@yaks/tunnel, D-39583). A
// linked machine runs `cloudflared` with its tunnel's token and dials out, so
// it opens no port; the space's apps reach one service on it through a
// `vpc_services` binding in their wrangler config (deploy_worker.ts).
//
//   GET  ?space=ada                    the link, or null
//   POST space=ada do=connect port=N   a new tunnel and service; the token once
//   POST space=ada do=rotate           a new token for the tunnel, once
//   POST space=ada do=disconnect       the link gone, and what the platform made
//   POST space=ada do=adopt tunnel=… service=…   record a pair made elsewhere
//
// The space's owner connects, rotates and disconnects. Adopting is the
// platform owner's alone (a seat in `yak`, the fee's gate, sell.ts `fees`):
// the ids name resources in the platform's account, and a space that could
// write any service id could bind its apps to somebody else's machine. An
// adopted pair is only recorded here, so disconnecting it forgets the ids and
// rotating it is refused; whoever made it rotates and removes it.
//
// A token is answered to the caller once and never kept or logged: the
// machine's `yak` puts it straight into its own vault. Session cookie only,
// never an agent's bearer, and under `/api/`, so the same-origin guard
// (route.ts `guarded`) stands in front of it the way it stands in front of the
// fee.
import { type Api, connect, disconnect, tunnels } from '@yaks/tunnel'
import * as dirPart from './directory.ts'
import { directory, type Space, stamp, type Tunnel } from './directory.ts'
import { bound, type Env } from './env.ts'
import { whoIs } from './session.ts'

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

// Written through the kernel's door: every property of `tunnel` is stamped.
let wrote = (env: Env, space: Space, row: Tunnel | null) =>
  stamp(env, { entities: [{ entity: { eid: space.eid }, tunnel: row }] })

let shown = (space: Space, tunnel: Tunnel | null, more = {}) =>
  Response.json({ space: space.slug, tunnel, ...more })

// A Cloudflare id, as the API spells one: a uuid.
let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (req.method != 'GET' && req.method != 'POST') {
    return json(405, 'method_not_allowed', 'get the link, or post a change')
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
  let link = space.tunnel
  let act = said('do')
  if (req.method == 'GET') return shown(space, link)

  if (act == 'adopt') {
    if (!platform) {
      return json(
        403,
        'not_platform',
        `adopting names the platform's own resources: an owner of ${meta?.slug} does it`,
      )
    }
    // A pair the platform made would be left running with nothing naming it.
    if (link && !link.adopted) {
      return json(409, 'linked', `${space.slug} is linked; disconnect it first`)
    }
    let [id, service] = [said('tunnel'), said('service')]
    if (!UUID.test(id) || !UUID.test(service)) {
      return json(400, 'bad_ids', 'tunnel and service are each a uuid')
    }
    let row = { id, service, adopted: true }
    await wrote(env, space, row)
    return shown(space, row)
  }
  if (!owner) {
    return json(403, 'not_owner', `${space.slug}'s machine is its owner's`)
  }
  if (act == 'connect') {
    if (link) {
      return json(409, 'linked', `${space.slug} is linked already`)
    }
    let port = Number(said('port'))
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return json(400, 'bad_port', 'port is the one the machine serves on')
    }
    let api = account(env)
    if (!api) return json(503, 'no_token', NO_TOKEN)
    let made = await connect(api, `space-${space.eid}`, { port })
    let row = { id: made.tunnel, service: made.service, adopted: false }
    try {
      await wrote(env, space, row)
    } catch (e) {
      await disconnect(api, made)
      throw e
    }
    return shown(space, row, { token: made.token })
  }
  if (!link) {
    return json(404, 'unlinked', `no machine is linked to ${space.slug}`)
  }
  if (act == 'rotate') {
    if (link.adopted) {
      return json(
        409,
        'adopted',
        'an adopted tunnel is rotated where it was made',
      )
    }
    let api = account(env)
    if (!api) return json(503, 'no_token', NO_TOKEN)
    return shown(space, link, { token: await tunnels(api).rotate(link.id) })
  }
  if (act == 'disconnect') {
    if (!link.adopted) {
      let api = account(env)
      if (!api) return json(503, 'no_token', NO_TOKEN)
      await disconnect(api, { tunnel: link.id, service: link.service })
    }
    await wrote(env, space, null)
    return shown(space, null)
  }
  return json(
    400,
    'bad_do',
    'do is connect, rotate, disconnect or adopt',
  )
}

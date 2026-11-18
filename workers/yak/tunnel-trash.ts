// The person’s purge of a tunnel kept in the trash. Disconnecting removes
// only its generated gateway; the tunnel and service keep their names here.
import { disconnect } from '@yaks/tunnel'
import { gatewayOf, type Tunnel } from '@yaks/tunnel/hosted'
import type { Kind } from './confirm.ts'
import { type Directory, type Space, stamp } from './directory.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import { account, front } from './tunnel.ts'

export let purgeTunnel = async (
  env: Env,
  _dir: Directory,
  space: Space,
  who: Who,
): Promise<string> => {
  let t = space.tunnel
  if (!t) return 'The space holds no tunnel.'
  let gateways = front(env)
  if (!gateways) throw new Error('the platform cannot remove tunnel gateways')
  let api = account(env)
  if (!t.adopted && !api) {
    throw new Error('the platform cannot remove tunnels')
  }
  await gateways.remove(gatewayOf(space.eid))
  if (api && !t.adopted) {
    await disconnect(api, { tunnel: t.id, service: t.service })
  }
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      tunnel: null,
      tunnel_trashed: null,
    }],
  }, { actor: { by: who.person!, via: who.via } })
  return 'The tunnel was permanently purged.'
}

export let trashedTunnel: Kind<Tunnel> = {
  kind: 'tunnel',
  find: (_dir, space, target) =>
    Promise.resolve(
      target == space.eid && space.tunnelTrashed ? space.tunnel : null,
    ),
  typed: (t) => t.id,
  title: () => 'Permanently purge this tunnel?',
  until: () => 'The tunnel is kept in the trash, with its names held.',
  lines: (_space, t) => [
    'The saved tunnel and service identifiers, and the way to restore them.',
    ...t.adopted
      ? ['The adopted tunnel and service stay with whoever made them.']
      : [
        'The Cloudflare Tunnel and Workers VPC Service, releasing their names.',
      ],
  ],
  press: () => 'Permanently purge tunnel',
  act: (env, dir, space, _t, who) => purgeTunnel(env, dir, space, who),
}

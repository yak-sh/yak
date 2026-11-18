// The person’s purge of a tunnel kept in the trash. Disconnecting removes
// only its generated gateway; the tunnel and service keep their names here.
import { disconnect } from '@yaks/tunnel'
import { gatewayOf, type Tunnel } from '@yaks/tunnel/hosted'
import type { Kind } from './confirm.ts'
import { stamp } from './directory.ts'
import { account, front } from './tunnel.ts'

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
  act: async (env, _dir, space, t, who) => {
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
  },
}

// @yaks/tunnel: a machine reached from a hosted space through a Cloudflare
// Tunnel and a Workers VPC Service. The account calls that make and remove
// one, and the gateway in front of it, are ./cloudflare.ts; the tunnel's two
// ends are ./gateway.ts, the module the gateway runs, and ./filter.ts, the
// machine's check on what comes through; the filter as a machine's server
// takes it is ./routes.ts, and the connector it runs is ./service.ts, each its
// own subpath because each is one role's; the `tunnel` component that records
// an entity's pair is ./vocab.json.

export {
  type Api,
  connect,
  disconnect,
  type Gateways,
  gateways,
  type Made,
  type Pair,
  services,
  type Target,
  tunnels,
} from './cloudflare.ts'
export { Closed, filter, opens } from './filter.ts'
export { GATEWAY, HEADER } from './gateway.ts'
export { docs, tunnelDoc } from './vocab.ts'

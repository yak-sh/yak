// @yaks/tunnel: a machine linked to a hosted space through a Cloudflare Tunnel
// and a Workers VPC Service. The account calls that make and unmake one, and
// the gateway in front of it, are ./cloudflare.ts; the link's two ends, the
// gateway's module and the machine's door, are ./link.ts; the connector and
// door a machine runs are ./service.ts, its own subpath because it starts a
// process; the `tunnel` component that records which tunnel and service an
// entity is linked by is ./vocab.json.

export {
  type Api,
  connect,
  disconnect,
  type Gateways,
  gateways,
  type Link,
  type Made,
  services,
  type Target,
  tunnels,
} from './cloudflare.ts'
export { GATEWAY, HEADER, link, type Opened, opens } from './link.ts'
export { docs, tunnelDoc } from './vocab.ts'

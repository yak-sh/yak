// @yaks/tunnel: a machine linked to a hosted space through a Cloudflare Tunnel
// and a Workers VPC Service. The account calls that make and unmake one are
// ./cloudflare.ts; the connector a machine runs is ./service.ts, its own
// subpath because it starts a process; the `tunnel` component that records
// which tunnel and service an entity is linked by is ./vocab.json.

export {
  type Api,
  connect,
  disconnect,
  type Link,
  type Made,
  services,
  type Target,
  tunnels,
} from './cloudflare.ts'
export { docs, tunnelDoc } from './vocab.ts'

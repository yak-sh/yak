/**
 * @yaks/sync — connects a client {@link https://jsr.io/@yaks/graph |
 * @yaks/graph} to a server: a plugin that sends a local graph's writes to the
 * server over HTTP and applies the server's writes back over a WebSocket.
 *
 * A graph in a page over {@link https://jsr.io/@yaks/ram | @yaks/ram} is
 * a complete graph — same `apply()`, same queries, same bundles — but it is
 * the only participant. This package adds the other one.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { sync } from '@yaks/sync'
 *
 * // let g = graph({ storage: ram(vocab, { adopt: true }), vocab })
 * // let link = sync(g, { url: 'https://recipes.example' })
 * // link.subscribe('.dinner&.serves>4')
 * ```
 *
 * ## Writes are optimistic A write commits locally first — the page renders it
 * before anything crosses the network — and is then sent as `POST /apply`. The
 * list of bundles the server responds with is applied back through the same
 * local graph, which is how the numbers it assigned, the properties it stamped
 * and the entities it deleted reach the client. If the server refuses the
 * write, the optimistic change is undone from the copy {@link sync} took of
 * those entities beforehand, and the refusal is reported. If the server is
 * merely unreachable, nothing is undone: the write may have been applied there
 * and only the response lost.
 *
 * ## Two keywords, one apply()
 * A client holds state the server owns, state this browser owns, and state
 * that dies with the tab. Each component declares which it is, using the two
 * core vocabulary keywords:
 *
 * ```json
 * { "$defs": { "draft": { "type": "object", "sync": "none",
 *     "properties": { "text": { "type": "string" } } } } }
 * ```
 *
 * `sync` declares who is told about a write — `server` (the default) and
 * `peers` are sent, `none` stays here — and `durable` declares how long the
 * value lives: `forever` (the default) is the vault, `connection` or a
 * duration is memory. All of them go through the same `apply()`.
 *
 * ## Reading is a subscription
 * {@link Sync.subscribe} opens a stored query on the server's `/ws`. Its
 * answer — and every later change to it, including what left the set — is
 * applied to the local graph, so a render reads the local store and never
 * awaits. A dropped socket reconnects with a widening backoff, sends every
 * subscription again, and treats the first frame after a reopen as the whole
 * set.
 *
 * ## Both transports are injected
 * {@link SyncOpts.fetch} and {@link SyncOpts.connect} default to the
 * platform's `fetch` and `WebSocket`, and either can be passed in — which is
 * how this package is tested against an in-process handler with no network at
 * all.
 *
 * @module
 */

export {
  type Replica,
  type SubscribeOpts,
  type Sync,
  sync,
  type SyncOpts,
} from './sync.ts'
export {
  type Fetch,
  post,
  type PostOpts,
  type Refusal,
  type Report,
  type Trouble,
} from './outbound.ts'
export { land, snapshot, strip } from './inbound.ts'
export {
  type Ask,
  backoff,
  type Connect,
  type Frame,
  type Socket,
  type Timer,
  type Wire,
  wire,
  type WireOpts,
} from './socket.ts'
export { durableOf, inverse, local, outbound, outward, syncOf } from './tier.ts'
export {
  asked,
  asking,
  before,
  clean,
  ECHO,
  echo,
  echoed,
  marks,
  replicate,
  SENT,
} from './mark.ts'
export {
  type Port,
  type PortLink,
  portLink,
  type RequestOptions,
} from './port.ts'

export { type Coverage, covers, delivered } from './coverage.ts'

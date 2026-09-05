/**
 * @yaks/sync — the wire tier for a client {@link https://jsr.io/@yaks/graph |
 * @yaks/graph}: a plugin that carries a local graph's writes to a server and
 * the server's writes back.
 *
 * A graph in a page over {@link https://jsr.io/@yaks/memory | @yaks/memory} is
 * a complete graph — same `apply()`, same queries, same bundles — it just has
 * nobody else in it. This package is the nobody else.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { memory } from '@yaks/memory'
 * import { sync } from '@yaks/sync'
 *
 * // let g = graph({ storage: memory(vocab, { adopt: true }), vocab })
 * // let wire = sync(g, { url: 'https://recipes.example' })
 * // wire.subscribe('.dinner&.serves>4')
 * ```
 *
 * ## Writes are optimistic
 * A write commits locally FIRST — the page renders it before anything crosses
 * the network — and is then forwarded to `POST /apply`. The batch the server
 * answers with is applied back through the same local graph, which is how the
 * numbers it minted, the stamps it wrote and the entities it killed reach the
 * client. If the server REFUSES the batch, the optimistic change is undone
 * from the image {@link sync} captured before it and the refusal is reported.
 * If the server is merely unreachable, nothing is undone: the batch may have
 * landed and the answer been lost.
 *
 * ## Three tiers, one apply()
 * A client holds state the server owns, state this browser owns, and state
 * that dies with the tab. Which is which is declared on the component, as a
 * vocabulary keyword ({@link syncKeywords}):
 *
 * ```json
 * { "$defs": { "draft": { "type": "object", "persist": "local",
 *     "properties": { "text": { "type": "string" } } } } }
 * ```
 *
 * `wire` (the default) syncs; `local` and `none` never leave the process. All
 * three ride the same `apply()`.
 *
 * ## Reading is a subscription
 * {@link Sync.subscribe} opens a saved query on the server's `/ws`. Its answer
 * — and every later change to it, including what LEFT the set — is applied to
 * the local graph, so a render reads the local store and never awaits. A
 * dropped socket reconnects with a widening backoff, puts every subscription
 * back, and treats the first frame after a reopen as the whole set.
 *
 * ## Both transports are injected
 * {@link SyncOpts.fetch} and {@link SyncOpts.connect} default to the
 * platform's `fetch` and `WebSocket`, and either can be handed in — which is
 * how this package is tested against an in-process handler with no network at
 * all.
 *
 * @module
 */

export { type Sync, sync, type SyncOpts } from './sync.ts'
export {
  type Fetch,
  post,
  type PostOpts,
  type Refusal,
  type Report,
  type Trouble,
} from './outbound.ts'
export { land, strip } from './inbound.ts'
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
export {
  inverse,
  outward,
  SYNC_URI,
  syncKeywords,
  type Tier,
  tierOf,
} from './tier.ts'
export {
  asked,
  asking,
  before,
  clean,
  ECHO,
  echo,
  echoed,
  SENT,
} from './mark.ts'

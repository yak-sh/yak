// A store as a GRAPH (T-33814, T-33815): bundles in, bundles out, and one
// filter line for a read. Every caller that reaches the meta space — the
// directory part's door, sign-in, the platform's own crash reports, the
// feedback tool, the invitation that mints a person — speaks THIS, and so does
// every caller that writes the platform's own rows into an APP's store
// (unseen.ts). None of them spells a store path or a mutation envelope.
//
// A bundle is `{entity: {eid}, comp: {...}}`, the read shape written back: an
// omitted column is untouched, a null column is cleared, a null component is
// dropped, and `tombstone: {}` is death. An eid the batch MINTS is a `$alias`,
// and the applied bundle says what it became. A filter line is the dot-param
// grammar @yaks/query parses — `.space.slug=ada&.doc?` — with values written
// RAW: this door does the escaping, so no caller reaches for
// encodeURIComponent again.
//
// `KERNEL` is the platform writing about its own data — a `plan`, a `meter`, a
// `signin`, an `exception` — whose columns are server-owned and refused at the
// ordinary door. It is never forwarded from anywhere a client can reach
// (directory.ts VOUCH), so it cannot arrive from outside.
import type { Bundle } from '@yaks/graph'
import { type Door, type Namespace, storeOf } from './door.ts'
import { PLATFORM_STORE } from './vocab.ts'

/** The meta store, in the graph's own wire. */
export type Meta = {
  /** a filter line → the entities it selects, whole */
  query: (line: string) => Promise<Bundle[]>
  /** a batch of bundles → the batch as applied, aliases resolved */
  apply: (
    bundles: Bundle[],
    headers?: Record<string, string>,
  ) => Promise<Bundle[]>
}

/** The platform writing about its own data: server-owned columns admitted. */
export let KERNEL: Record<string, string> = { 'x-yak-kernel': '1' }

/**
 * The graph's own doors over a store: `POST /apply` takes the bundles as they
 * are and answers the batch as applied, `GET /query?q=` takes the whole filter
 * line as one parameter. This is what graph.ts's Store serves, at the directory
 * and at every app alike — {@link meta} is it aimed at `yak/platform`, and
 * unseen.ts aims it at one app's own store.
 */
export let metaOf = (store: Door): Meta => ({
  query: async (line) => {
    let r = await store(`/query?q=${encodeURIComponent(line)}`)
    if (!r.ok) throw new Error(`meta store: ${await r.text()}`)
    return await r.json() as Bundle[]
  },
  apply: async (bundles, headers = {}) => {
    let r = await store('/apply', {
      method: 'POST',
      body: JSON.stringify(bundles),
    }, headers)
    if (!r.ok) throw new Error(`meta store refused: ${await r.text()}`)
    return await r.json() as Bundle[]
  },
})

/** What a batch minted, by the alias it was written under. */
export let minted = (applied: Bundle[]): Record<string, string> =>
  Object.fromEntries(
    applied.flatMap((b) =>
      typeof b.$alias == 'string' ? [[b.$alias, b.entity.eid]] : []
    ),
  )

// One door per binding, so the answer is the SAME object every time: what is
// memoized on a door (the seed the directory part runs once, directory.ts) is
// memoized per isolate, and a test that builds its own gets its own.
let doors = new WeakMap<object, Meta>()

/** The directory's store. The env is the one binding it reads, so a Store
 * object — which holds the namespace and no service binding — reaches the
 * directory the way the kernel does (meter.ts `metering`). */
export let meta = (env: { STORE: Namespace }): Meta => {
  let ns = env.STORE as unknown as object
  let held = doors.get(ns)
  if (!held) doors.set(ns, held = metaOf(storeOf(env.STORE, PLATFORM_STORE)))
  return held
}

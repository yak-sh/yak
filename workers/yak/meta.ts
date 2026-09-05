// The directory's own store, as a GRAPH (T-33814): bundles in, bundles out,
// and one filter line for a read. Every caller that reaches the meta space —
// the directory part's door, sign-in, the platform's own crash reports, the
// feedback tool, the invitation that mints a person — speaks THIS, and none of
// them spells a store path or a mutation envelope any more.
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
import type { Change } from '../../src/types.ts'
import type { Env } from './env.ts'
import { type Door, storeOf } from './store.ts'
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
 * line as one parameter. This is what graph.ts's Store serves, and what
 * {@link meta} becomes the moment the DO export moves to it.
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

// ---- the lowering, until the DO export moves (T-33815) ----------------------
//
// TODO(T-33815, T-33809): the object at `yak/platform` is still the OLD Store
// class — index.ts exports store.ts, and switching it moves every APP store
// too, which is T-33815's, over rows T-33809 carries across. Until then the
// object at that address speaks `{entities: [...]}` on `/apply`, answers
// `{ok, changes, aliases}`, and reads its filter off the raw search string
// rather than `?q=`. `legacy` below is that difference and nothing else: the
// wire every caller speaks is already the graph's, so the flip is deleting
// this function and pointing `meta` at `metaOf`.

// A filter line escaped for the old door, which splits the search string
// itself: each VALUE is escaped and the operators and `&` separators are left
// as the structure they are. The two grammars agree on every line the
// directory writes — `.eid=`, `.limit=`, presence, want, comparisons — so
// nothing else is translated.
let OPERATOR = /^(\.[A-Za-z_.\-[\]]+(?:!=|~=|<=|>=|<|>|=|!|\?))([\s\S]*)$/

let escaped = (line: string): string =>
  line.split('&').map((token) => {
    let m = token.match(OPERATOR)
    return m ? m[1] + encodeURIComponent(m[2]) : encodeURIComponent(token)
  }).join('&')

// The old door's answer as bundles: its flat changes gathered by entity, each
// minted one wearing the `$alias` it was named by.
let lifted = (
  out: { changes?: Change[]; aliases?: Record<string, string> },
) => {
  let named: Record<string, string> = {}
  for (let [alias, eid] of Object.entries(out.aliases ?? {})) named[eid] = alias
  let by = new Map<string, Bundle>()
  for (let c of out.changes ?? []) {
    let b = by.get(c.eid) ?? {
      entity: { eid: c.eid },
      ...(named[c.eid] ? { $alias: named[c.eid] } : {}),
    }
    if (c.name != 'entity') b[c.name] = c.comp as Bundle[string]
    by.set(c.eid, b)
  }
  return [...by.values()]
}

let legacy = (store: Door): Meta => ({
  query: async (line) => {
    let r = await store(`/query?${escaped(line)}`)
    if (!r.ok) throw new Error(`meta store: ${await r.text()}`)
    return await r.json() as Bundle[]
  },
  apply: async (bundles, headers = {}) => {
    let r = await store('/apply', {
      method: 'POST',
      body: JSON.stringify({ entities: bundles }),
    }, headers)
    if (!r.ok) throw new Error(`meta store refused: ${await r.text()}`)
    return lifted(await r.json())
  },
})

// One door per binding, so the answer is the SAME object every time: what is
// memoized on a door (the seed the directory part runs once, directory.ts) is
// memoized per isolate, and a test that builds its own gets its own.
let doors = new WeakMap<object, Meta>()

/** The directory's store. */
export let meta = (env: Env): Meta => {
  let ns = env.STORE as unknown as object
  let held = doors.get(ns)
  if (!held) doors.set(ns, held = legacy(storeOf(env.STORE, PLATFORM_STORE)))
  return held
}

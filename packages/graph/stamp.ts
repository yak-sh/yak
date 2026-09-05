// Provenance: who wrote this, and when. Two components, paired by meaning —
// `created` is set once, at birth; `updated` is the last touch, absent until
// the first edit after birth. Both are server-owned: a caller may not write
// them, and this phase is their only writer.
//
// The actor rides IN the batch, as the `$actor` component. That is deliberate:
// the door that received the write — an HTTP handler that authenticated a
// session, a CLI that knows who is at the keyboard, a test that says so
// outright — is the only thing that can know who is writing, and it is that
// door's job to trust or overwrite what a client claimed. `apply()` stamps
// what reached it.
//
// The columns are the vocabulary's, not this file's: a graph whose `created`
// carries only `at` gets only `at`, and a graph with no `created` component at
// all is stamped not at all. Nothing here assumes a shape.

import type { Vocab } from '@yaks/vocab'
import type { Actor, Bundle, Comp, Eid } from './bundle.ts'
import type { Tx } from './storage.ts'
import type { State } from './state.ts'
import { then } from './pipe.ts'

/** The actor a batch names: the first `$actor` component in it. A batch speaks
 * with one voice, so the first one found is the writer for the whole batch. */
export let actorOf = (bundles: Bundle[]): Actor =>
  bundles.find((b) => b.$actor)?.$actor ?? {}

// The stamp for one entity, narrowed to the columns this vocabulary declares
// on that component — `at`, and whichever of `by`/`via` the batch's actor
// named. An empty result means there is nothing to say.
let mark = (
  vocab: Vocab,
  comp: string,
  now: string,
  actor: Actor,
): Comp | undefined => {
  let info = vocab.comp(comp)
  if (!info) return undefined
  let has = new Set(vocab.columns(comp))
  let out: Comp = {}
  if (has.has('at')) out.at = now
  if (has.has('by') && actor.by) out.by = actor.by
  if (has.has('via') && actor.via) out.via = actor.via
  return Object.keys(out).length ? out : undefined
}

/**
 * The stamp phase: `created` on every entity this batch brought into being,
 * `updated` on every one it touched but did not create. The stamps are written
 * through the transaction and synthesized into the batch, so a cache that
 * applies the return sees the same provenance a fresh read would.
 */
export let stamp = (
  bundles: Bundle[],
  tx: Tx,
  vocab: Vocab,
  st: State,
  now: string,
): Bundle[] | Promise<Bundle[]> => {
  let actor = actorOf(bundles)
  let born = new Set(st.born.map((e) => e.eid))
  let dead = new Set(st.killed)
  let out: Bundle[] = []
  let add = (eid: Eid, comp: string) => {
    let m = mark(vocab, comp, now, actor)
    if (m) out.push({ entity: { eid }, [comp]: m })
  }
  for (let e of st.born) if (!dead.has(e.eid)) add(e.eid, 'created')
  for (let eid of st.touched) {
    if (!born.has(eid) && !dead.has(eid)) add(eid, 'updated')
  }
  // The identities storage minted ride back too: a client that guessed an eid
  // learns the `num` that came with it.
  let births = st.born.filter((e) => !dead.has(e.eid))
    .map((e) => ({ entity: e }))
  if (!out.length) return [...bundles, ...births]
  return then(tx.patch(out), () => [...bundles, ...out, ...births])
}

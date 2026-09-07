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
import type { Actor, Bundle, Comp } from './bundle.ts'
import type { State } from './state.ts'
import type { Patch, Rule } from './rules.ts'

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
 * The stamp phase, as two rules. `created` goes on every entity the graph holds
 * none for — which is what a birth IS — and `updated` on every other entity the
 * batch touched; the gate on `created` is what keeps them apart. The phase
 * judges both against ONE frozen view (./rules.ts), so a birth is never also a
 * touch. What they produce is written through the transaction and synthesized
 * into the batch, so a cache that applies the return sees the provenance a
 * fresh read would.
 *
 * A graph whose vocabulary declares no `created` is stamped not at all: a rule
 * about a component that does not exist here is inert.
 */
export let stamps: Rule[] = [
  {
    name: 'created',
    phase: 'stamp',
    match: '.entity, +!created, *created',
    run: (_bound, ctx) => wear('created', ctx.vocab, ctx.now, ctx.actor),
  },
  {
    name: 'updated',
    phase: 'stamp',
    match: '.entity, .created, *updated',
    run: (_bound, ctx) => wear('updated', ctx.vocab, ctx.now, ctx.actor),
  },
]

// One rule's patch: the component, narrowed to the columns this vocabulary
// declares. Nothing to say is no patch — the gate has already put the
// component on.
let wear = (
  comp: string,
  vocab: Vocab,
  now: string,
  actor: Actor,
): Patch | undefined => {
  let m = mark(vocab, comp, now, actor)
  return m ? { [comp]: m } : undefined
}

/**
 * The identities storage minted, carried back in the batch: a client that
 * guessed an eid learns the `num` that came with it. The entity is carried BY
 * REFERENCE, not copied — an adapter whose numbers the database picks
 * (@yaks/d1) fills the `num` in when its batch lands, which is after this phase
 * and before the caller sees the answer.
 */
export let births = (bundles: Bundle[], st: State): Bundle[] => {
  let dead = new Set(st.killed)
  return [
    ...bundles,
    ...st.born.filter((e) => !dead.has(e.eid)).map((e) => ({ entity: e })),
  ]
}

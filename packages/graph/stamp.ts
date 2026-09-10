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
import type { Bound, Patch, Rule } from './rules.ts'

/** The actor a batch names: the first `$actor` component in it. A batch speaks
 * with one voice, so the first one found is the writer for the whole batch. */
export let actorOf = (bundles: Bundle[]): Actor =>
  bundles.find((b) => b.$actor)?.$actor ?? {}

// The stamp for one entity, narrowed to the columns this vocabulary declares
// on that component — `at`, and whichever of `by`/`via` the batch's actor
// named. An empty result means there is nothing to say.
type Attribution = { by?: string | null; via?: string | null }

let mark = (
  vocab: Vocab,
  comp: string,
  now: string,
  actor: Actor,
  overrides?: Attribution,
): Comp | undefined => {
  let info = vocab.comp(comp)
  if (!info) return undefined
  let has = new Set(vocab.columns(comp))
  let out: Comp = {}
  if (has.has('at')) out.at = now
  for (let col of ['by', 'via'] as const) {
    if (!has.has(col)) continue
    if (overrides && col in overrides) out[col] = overrides[col]
    else if (actor[col]) out[col] = actor[col]
  }
  return Object.keys(out).length ? out : undefined
}

/** Application policy may classify a touched entity and supply its per-entity
 * attribution. The generic rules still own column narrowing and the clock.
 * Returning null suppresses provenance (for example, a settled no-op). */
export type StampPolicy = (bundle: Bound) =>
  | ({
    kind: 'created' | 'updated'
  } & Attribution)
  | null

/** Default provenance uses two rules judged against ONE frozen view: a birth
 * wears created, a later touch wears updated. Policy can choose or suppress the
 * stamp, but both routes use the same clock, attribution and vocabulary writer.
 * Now, Actor and Vocab are rule resources; no app vocabulary is assumed. */
export let provenance = (policy?: StampPolicy): Rule[] =>
  policy
    ? [{
      name: 'provenance',
      phase: 'stamp',
      // The policy chooses which component to create; no unconditional ensure
      // may run here, because a suppressed stamp must write nothing at all.
      match: '.entity, #Vocab, #Actor, #Now',
      run: (b: Bound) => {
        let choice = policy(b)
        if (!choice) return
        return wear(choice.kind, b.Vocab, b.Now.at, b.Actor, choice)
      },
    }]
    : [
      {
        name: 'created',
        phase: 'stamp',
        match: '.entity, +!created, *created, #Vocab, #Actor, #Now',
        run: ({ Vocab, Now, Actor }) => wear('created', Vocab, Now.at, Actor),
      },
      {
        name: 'updated',
        phase: 'stamp',
        match: '.entity, .created, +updated, *updated, #Vocab, #Actor, #Now',
        run: ({ Vocab, Now, Actor }) => wear('updated', Vocab, Now.at, Actor),
      },
    ]

export let stamps: Rule[] = provenance()

// One rule's patch: the component, narrowed to the columns this vocabulary
// declares. Nothing to say is no patch — the gate has already put the
// component on.
let wear = (
  comp: string,
  vocab: Vocab,
  now: string,
  actor: Actor,
  overrides?: Attribution,
): Patch | undefined => {
  let m = mark(vocab, comp, now, actor, overrides)
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

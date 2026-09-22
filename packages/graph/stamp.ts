// Provenance: who wrote this, and when. Two paired components — `created` is
// set once, when the entity is created; `updated` records the last write, and
// is absent until the first edit after creation. Both are server-owned: a
// caller may not write them, and this phase is their only writer.
//
// A mark is the third form, and records an event rather than the entity's
// lifecycle: `completed`, `archived`, `notified` — a component a client writes
// empty and the server fills in with the same `{at, by, via}` columns. There is
// no list of marks here either; any component whose vocabulary declares that
// trio server-owned is a mark, and gets filled in.
//
// The actor travels in the change, as the `$actor` key. That is deliberate:
// whatever received the write — an HTTP handler that authenticated a session, a
// CLI that knows who is at the keyboard, a test that states it outright — is
// the only thing that can know who is writing, and it is that code's job to
// trust or replace what a client claimed. `apply()` stamps whatever reaches it.
//
// The columns come from the vocabulary, not from this file: a graph whose
// `created` declares only `at` gets only `at`, and a graph with no `created`
// component at all is not stamped. Nothing here assumes a particular shape.

import type { Vocab } from '@yaks/vocab'
import type { Actor, Bundle, Comp } from './bundle.ts'
import type { State } from './state.ts'
import type { Bound, Patch, Rule } from './rules.ts'

/**
 * Sign a whole change as one actor's. Whatever `$actor` the bundles already
 * carried is removed: who is writing is decided by the code that received the
 * request, never by the client — @yaks/api's `/apply` handler, or @yaks/tools'
 * runner applying what a tool returned.
 *
 * An actor is a pair, because a write has two answers to "whose is this": the
 * identity it acts for (`by`) and the instrument it came through (`via`) — a
 * session, a run, a connector. A caller that knows only one passes only one.
 *
 * ```ts
 * signed([{ entity: { eid: 'b1' } }], { by: 'm1' })
 * // [{ entity: { eid: 'b1' }, $actor: { by: 'm1' } }]
 * ```
 */
export let signed = (change: Bundle[], who: Actor | null): Bundle[] =>
  change.map((b) => {
    let out: Bundle = { ...b }
    delete out.$actor
    if (who && (who.by || who.via)) out.$actor = { ...who }
    return out
  })

/** The actor a change names: the first `$actor` in it. A change has one
 * writer, so the first one found is the writer for the whole change. */
export let actorOf = (bundles: Bundle[]): Actor =>
  bundles.find((b) => b.$actor)?.$actor ?? {}

// The stamp for one entity, narrowed to the columns this vocabulary declares
// on that component — `at`, and whichever of `by`/`via` the change's actor
// supplied. An empty result means there is nothing to write.
type Attribution = { by?: string | null; via?: string | null }

let mark = (
  vocab: Vocab,
  comp: string,
  now: string,
  actor: Actor,
  overrides?: Attribution,
  held?: Comp,
): Comp | undefined => {
  let info = vocab.comp(comp)
  if (!info) return undefined
  let has = new Set(vocab.columns(comp))
  // A column something else already filled is left as it was found: a hook
  // that set the mark's author (@yaks/task keeps a completion's author across
  // edits) and a graph whose policy supplied the writer both run before this.
  let said = (col: string) => held?.[col] != null
  let out: Comp = {}
  if (has.has('at') && !said('at')) out.at = now
  for (let col of ['by', 'via'] as const) {
    if (!has.has(col) || said(col)) continue
    if (overrides && col in overrides) out[col] = overrides[col]
    else if (actor[col]) out[col] = actor[col]
  }
  return Object.keys(out).length ? out : undefined
}

/** An application's policy may classify a written entity and supply its
 * per-entity attribution. The generic rules still decide which columns exist
 * and what the timestamp is. Returning null writes no provenance at all — for
 * a write that turned out to change nothing, say. */
export type StampPolicy = (bundle: Bound) =>
  | ({
    kind: 'created' | 'updated'
  } & Attribution)
  | null

/** Default provenance is two rules evaluated against one frozen state: a newly
 * created entity gets `created`, a later write gets `updated`. A policy may
 * choose the component or write none at all, but both paths use the same
 * timestamp, attribution and column narrowing. `#Now`, `#Actor` and `#Vocab`
 * are rule resources; no application vocabulary is assumed. */
export let provenance = (policy?: StampPolicy): Rule[] =>
  policy
    ? [{
      name: 'provenance',
      phase: 'stamp',
      // The policy chooses which component to write; the match can carry no
      // unconditional `+`, because a policy that writes no provenance must
      // write nothing at all.
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

/** Whether a component is a mark: one a client writes empty and the server
 * fills in — `completed`, `archived`, `notified` — recognized by its declared
 * columns, so a new one is picked up with no edit here. `created` and
 * `updated` declare the same columns but fire when the entity is created or
 * written rather than when the component itself is written, so they keep their
 * own rules and are excluded by name. */
export let marked = (vocab: Vocab, comp: string): boolean => {
  if (comp == 'created' || comp == 'updated') return false
  let has = new Set(vocab.comp(comp)?.stamped ?? [])
  return has.has('at') && (has.has('by') || has.has('via'))
}

/**
 * One rule per mark: its `{at, by, via}` are filled the first time the mark is
 * written.
 *
 * A mark is recorded once — the rule's condition is that its own `at` is
 * empty, so a later patch of the same component leaves the original values
 * alone, and archiving something again does not rewrite who archived it first.
 * That is the whole difference from `updated`, which is meant to change.
 *
 * The rules are derived from the vocabulary, not from a list of component
 * names: a graph that declares those three columns server-owned gets the rule,
 * and one that does not gets no rule at all.
 */
export let marks = (vocab: Vocab): Rule[] =>
  vocab.all.filter((c) => marked(vocab, c)).map((comp) => ({
    name: `mark/${comp}`,
    phase: 'stamp',
    match: `.${comp}, ${comp}.at=, *${comp}, #Vocab, #Actor, #Now`,
    run: (b: Bound) =>
      wear(comp, b.Vocab, b.Now.at, b.Actor, undefined, b[comp] as Comp),
  }))

// One rule's patch: the component, narrowed to the columns this vocabulary
// declares. Nothing to write means no patch — the match's `+` clause has
// already added the component itself.
let wear = (
  comp: string,
  vocab: Vocab,
  now: string,
  actor: Actor,
  overrides?: Attribution,
  held?: Comp,
): Patch | undefined => {
  let m = mark(vocab, comp, now, actor, overrides, held)
  return m ? { [comp]: m } : undefined
}

/**
 * Add the identities storage created to the change, so a client that generated
 * an eid learns the `num` assigned to it. Each entity is added by reference,
 * not copied — an adapter whose numbers the database picks (@yaks/d1) fills
 * the `num` in when its statements run, which happens after this phase and
 * before the caller sees the return value.
 */
export let births = (bundles: Bundle[], st: State): Bundle[] => {
  let dead = new Set(st.killed)
  return [
    ...bundles,
    ...st.born.filter((e) => !dead.has(e.eid)).map((e) => ({ entity: e })),
  ]
}

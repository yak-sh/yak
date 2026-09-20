// Opening the desk: what a host does about a dream that has come back, and
// the two guards that keep it to one desk.
//
// A `dream` is a standing intention with a floor under it — do not come back
// before this — and that floor is the whole queue. Whatever wants writing
// files a dream, in its own words, with the floor set to the quiet it wants;
// when the dream is stirred and the floor has passed, ONE transcript opens on
// it and is asked those words. The desk takes the dream's `claim` while it
// works, so a second stir finds the lock and leaves, and the floor moves past
// the rest the host configured, so a desk that died without releasing cannot
// reopen before then either: one guard for the desk that is up, one for the
// desk that went away.
//
// WHAT opens is not decided here. A transcript wearing a voice, asked of a
// provider at an effort, is a fact about the box and never about the graph, so
// the config names it (./effects.ts) and this module writes it. Nothing is
// launched: what dreaming writes is a session and its first entry —
// @yaks/session's words — and whoever runs sessions on this host runs it.
//
// The dream's own record of coming back is `recall`: how many times it has
// surfaced, and when it last did. Its columns are stamped, so the write goes
// through the effects door trusted, like any other thing a host says about
// itself.

import type { Bundle, Comp, Tx } from '@yaks/graph'
import { then } from '@yaks/graph'
import type { Handler, Watch, Write } from '@yaks/effects'
import { BODY, DOC } from '@yaks/doc'
import { link } from '@yaks/edge'
import { FIRED, next, WAKE } from '@yaks/wake'

/** This package's own words. */
export let DREAM = 'dream'
export let RECALL = 'recall'

// The words the desk is WRITTEN IN, which belong to other packages: a
// transcript, its lines and its lock are @yaks/session's, a voice is
// @yaks/persona's entity said through @yaks/kernel's `references` relation.
// Dreaming writes them; it declares none of them, and a host that composes
// this facet without those vocabularies is refused by the vocabulary, not
// here.
export let SESSION = 'session'
export let ENTRY = 'entry'
export let CONTENT = 'content'
export let USING = 'using'
export let CLAIM = 'claim'
export let REFERENCES = 'references'

/** What a host starts when a dream comes back, as a config names it. Every
 * field is the host's to say: nothing here has a default worth guessing. */
export type Desk = {
  /** the provider entity the first entry asks */
  provider?: string
  /** the model entity it asks for */
  model?: string
  /** the reasoning effort it asks at */
  effort?: string
  /** the voice it wears — a persona, said as a `references` edge */
  persona?: string
  /** who the transcript speaks as */
  actor?: string
  /** the words to ask, for a dream that carries none of its own */
  ask?: string
}

/** How the desk opens: what it starts, and how long the dream rests after. */
export type Open = {
  /** what to start */
  desk: Desk
  /** how long the dream rests once a desk opens — a @yaks/wake recurrence
   * (`1h`, `@daily`, `0 9 * * 1-5`). Absent, the floor is left where it is and
   * the lock is the only guard. */
  rest?: string
  /** the clock, injected so a test can hold it still (default: now) */
  now?: () => string
  /** where a new eid comes from (default: a uuid) */
  eid?: () => string
}

let clock = () => new Date().toISOString()
let uuid = () => crypto.randomUUID() as string

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let str = (c: Comp | undefined, k: string): string =>
  c?.[k] == null ? '' : String(c[k])

let num = (c: Comp | undefined, k: string): number => Number(c?.[k] ?? 0)

/** Whether a dream may come back at `at`: it has no floor, or the floor has
 * passed. A floor nobody can read is no floor — a dream is not held down by a
 * date that says nothing. */
export let due = (dream: Comp | undefined, at: string): boolean => {
  let floor = Date.parse(str(dream, 'floor'))
  return Number.isNaN(floor) || floor <= Date.parse(at)
}

/**
 * The bundles that open a desk on a dream: the transcript, its first entry
 * asked in `words`, the voice it wears, and — on the dream itself — the lock
 * that says a desk is up, the floor moved past its rest, and the count of how
 * often it has come back.
 *
 * Pure: the seam a test asserts on with no graph anywhere.
 */
export let desk = (
  dreamed: Bundle,
  words: string,
  o: Open,
  at: string = clock(),
): Bundle[] => {
  let { desk: d, rest } = o
  let eid = o.eid ?? uuid
  let session = eid()
  let using: Comp = {
    ...(d.provider ? { provider: d.provider } : {}),
    ...(d.model ? { model: d.model } : {}),
    ...(d.effort ? { effort: d.effort } : {}),
  }
  let was = comp(dreamed, RECALL)
  let floor = rest ? next(rest, Date.parse(at)) : null
  return [
    {
      entity: { eid: session },
      [SESSION]: d.actor ? { actor: d.actor } : {},
    },
    {
      entity: { eid: eid() },
      [ENTRY]: { session, seq: 1 },
      [CONTENT]: { body: words },
      ...(Object.keys(using).length ? { [USING]: using } : {}),
    },
    ...(d.persona ? [link(session, REFERENCES, d.persona)] : []),
    {
      entity: dreamed.entity,
      [CLAIM]: { session },
      ...(floor ? { [DREAM]: { floor } } : {}),
      [RECALL]: {
        count: num(was, 'count') + 1,
        first_at: str(was, 'first_at') || at,
        last_at: at,
      },
    },
  ]
}

// The decision, over the dream as it stands post-commit: the desk opens when
// the entity is a dream, its floor has passed, nothing holds its lock, and
// there are words to ask. Every other case is a dream that is simply not
// asking for anything right now, which is the ordinary case and not a fault.
let open = (o: Open, eid: string, tx: Tx, write: Write) =>
  then(tx.get([eid]), (found) => {
    let it = found[0]
    let dreamed = comp(it, DREAM)
    let at = (o.now ?? clock)()
    if (!it || !dreamed || !due(dreamed, at)) return
    if (comp(it, CLAIM)) return
    let words = str(comp(it, DOC), BODY) || o.desk.ask || ''
    if (!words) return
    return write(desk(it, words, o, at))
  })

/**
 * The handler a dream's own stirring runs: registered on `created(dream)` and
 * on `changed(dream.floor)`, so a dream filed now opens a desk now, and a
 * dream whose floor was moved back into the present opens one then.
 *
 * ```ts
 * import { effects } from '@yaks/effects'
 * import { opening } from '@yaks/dreaming'
 *
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * fx.created('dream', opening({ desk: { model: 'O-1' }, rest: '1h' }))
 * ```
 *
 * It is idempotent, which is what lets a boot reconciliation replay it over
 * every dream in the graph: the second run finds the lock, or the floor it
 * moved, and opens nothing. Its own write moves that floor, so the write wakes
 * this handler once more and that run is the one that finds the dream resting.
 */
export let opening = (o: Open): Handler => (event, tx, write) =>
  open(o, event.entity.eid, tx, write)

/**
 * The handler a WAKE runs: registered on `created(fired)` and
 * `changed(fired.at)`, it is how a dream that rests comes back at all. A
 * recurring @yaks/wake `wake` on the dream — or one aimed at it through
 * `wake.target` — fires, and the dream is asked again whether it is due.
 *
 * A wake that fires on something that is not a dream is nothing to this
 * handler, which is why it may be registered on the component rather than on
 * one schedule.
 */
export let ringing = (o: Open): Handler => (event, tx, write) =>
  then(tx.get([event.entity.eid]), (found) =>
    open(
      o,
      str(comp(found[0], WAKE), 'target') || event.entity.eid,
      tx,
      write,
    ))

/**
 * The two watches that make a dream come back: the dream stirring — filed now,
 * or its floor moved into the present — and a @yaks/wake `wake` firing on one.
 * {@link https://jsr.io/@yaks/dreaming/doc/effects/~/effects | the effects
 * facet} is this list, built from what a config named.
 */
export let watches = (o: Open): Watch[] => {
  let stir = opening(o)
  let rang = ringing(o)
  return [
    {
      comp: DREAM,
      created: stir,
      changed: { floor: stir },
      // The handler opens nothing on a dream that is resting or already has a
      // desk, so replaying it over every dream at boot is safe: what a crash
      // interrupted is picked up, and what it did not is left alone.
      sweep: { pending: `.${DREAM}` },
      doc: 'open a desk on a dream whose floor has passed',
    },
    {
      comp: FIRED,
      created: rang,
      changed: { at: rang },
      doc: 'a wake came back on a dream: ask whether it is due',
    },
  ]
}

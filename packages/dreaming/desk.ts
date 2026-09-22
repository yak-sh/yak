// Opening the desk — one agent session on a dream that has come due — and the
// two guards that keep a dream to one session at a time.
//
// A `dream` is a standing intention whose `floor` column is the earliest it
// may run again, and that column is the whole queue: anything that wants
// writing later files a dream with its body text and sets `floor` to when it
// should next run. When the dream is checked and its floor has passed, one
// session opens on it and is asked that text. The session takes the dream's
// `claim` while it runs, so a second check finds the claim and does nothing,
// and the floor moves forward by the configured rest interval, so a session
// that died without releasing its claim cannot reopen before then either: one
// guard for the session that is running, one for the session that vanished.
//
// What gets opened is not decided here. A session with a persona, asked of a
// provider at an effort, is a fact about the machine and never about the
// graph, so the configuration names it (./effects.ts) and this module writes
// it. No process is launched: this package writes a session row and its first
// entry — @yaks/session's components — and whatever runs sessions on this
// machine runs it.
//
// The dream's own record of having run is `recall`: how many times it has come
// due, and when it last did. Those columns are server-stamped, so the write
// goes through the effects pipeline as trusted, like anything else the server
// records about itself.

import type { Bundle, Comp, Tx } from '@yaks/graph'
import { then } from '@yaks/graph'
import type { Handler, Watch, Write } from '@yaks/effects'
import { BODY, DOC } from '@yaks/doc'
import { link } from '@yaks/edge'
import { FIRED, next, WAKE } from '@yaks/wake'

/** The components this package declares. */
export let DREAM = 'dream'
export let RECALL = 'recall'

// The components a desk is written with, which belong to other packages: the
// session, its entries and its claim are @yaks/session's, and the persona is
// @yaks/persona's entity, linked through @yaks/kernel's `references` relation.
// This package writes them but declares none of them, so composing this plugin
// without those vocabularies is refused by the vocabulary loader, not here.
export let SESSION = 'session'
export let ENTRY = 'entry'
export let CONTENT = 'content'
export let USING = 'using'
export let CLAIM = 'claim'
export let REFERENCES = 'references'

/** The session to open when a dream comes due, as the configuration names it.
 * Every field comes from the configuration: nothing here has a default worth
 * guessing. */
export type Desk = {
  /** the provider entity the first entry asks */
  provider?: string
  /** the model entity it asks for */
  model?: string
  /** the reasoning effort it asks at */
  effort?: string
  /** the persona it runs with, linked by a `references` edge */
  persona?: string
  /** the identity the session writes as */
  actor?: string
  /** the text to ask, for a dream that has no body text of its own */
  ask?: string
}

/** How a desk opens: what session to start, and how long the dream rests
 * afterwards. */
export type Open = {
  /** the session to start */
  desk: Desk
  /** how long the dream rests once a session opens — a @yaks/wake recurrence
   * (`1h`, `@daily`, `0 9 * * 1-5`). Omitted, the floor is left where it is
   * and the claim is the only guard. */
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

/** Whether a dream may run at time `at`: it has no floor, or its floor has
 * passed. A floor that cannot be parsed counts as no floor — a dream is not
 * held back by a date nothing can read. */
export let due = (dream: Comp | undefined, at: string): boolean => {
  let floor = Date.parse(str(dream, 'floor'))
  return Number.isNaN(floor) || floor <= Date.parse(at)
}

/**
 * The bundles that open a desk on a dream: the session, its first entry
 * carrying `words`, the persona edge, and — on the dream itself — the claim
 * recording that a session is open, the floor moved forward by its rest, and
 * the count of how often it has run.
 *
 * A pure function, so a test can assert on it with no graph involved.
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

// The decision, made against the dream as it stands after the commit: a
// session opens when the entity is a dream, its floor has passed, nothing
// holds its claim, and there is text to ask. Every other case is a dream that
// has nothing to do right now, which is ordinary and not an error.
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
 * The handler that runs when a dream itself changes: registered on
 * `created(dream)` and on `changed(dream.floor)`, so a dream created now opens
 * a session now, and a dream whose floor was moved back into the present opens
 * one then.
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
 * every dream in the graph: the second run finds the claim, or the floor it
 * moved, and opens nothing. Its own write moves that floor, so the write
 * triggers this handler once more, and that run is the one that finds the
 * dream resting.
 */
export let opening = (o: Open): Handler => (event, tx, write) =>
  open(o, event.entity.eid, tx, write)

/**
 * The handler a WAKE runs: registered on `created(fired)` and
 * `changed(fired.at)`, it is how a resting dream comes back at all. A
 * recurring @yaks/wake `wake` on the dream — or one aimed at it through
 * `wake.target` — fires, and the dream is checked again for whether it is due.
 *
 * A wake that fires on something that is not a dream does nothing here, which
 * is why this can be registered on the component rather than on one particular
 * schedule.
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
 * The two watches that bring a dream back: the dream itself changing — created
 * now, or its floor moved into the present — and a @yaks/wake `wake` firing on
 * one. {@link https://jsr.io/@yaks/dreaming/doc/effects/~/effects | the
 * `effects` export} is this list, built from what the configuration named.
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
      // session, so replaying it over every dream at boot is safe: what a
      // crash interrupted is picked up, and what it did not is left alone.
      sweep: { pending: `.${DREAM}` },
      doc: 'open a desk on a dream whose floor has passed',
    },
    {
      comp: FIRED,
      created: rang,
      changed: { at: rang },
      doc: 'a wake fired on a dream: check whether it is due',
    },
  ]
}

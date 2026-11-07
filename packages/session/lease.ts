// The lock rule, as one hook on the `precondition` phase.
//
// Why that phase. `precondition` runs inside the batch's own transaction and
// before a single row has moved. Both facts are load-bearing. Inside the
// transaction, so the holder this hook reads is the holder the batch is about
// to write against — a check outside it is a check against a graph somebody
// else may have moved in between. Before any write, so the holder is read
// before the cascade phase can remove it: a batch that deletes a session and
// takes its lock in the same breath must still bounce, and a check that ran
// after the cascade would find an empty lock and admit the take.
//
// The lock. A claim is a lease, not a patch. Writing one over another session's
// fails the whole batch loudly — release, then claim. The same session
// re-claiming is a no-op refresh, so a worker replaying its own take is
// idempotent. A release (`claim: null`) is deliberately unguarded: releasing is
// how a lock is handed over, and the start-up pass frees a dead session's locks
// without impersonating that session.
//
// A new lock also leaves a `worked` edge from its session to what it took
// (@yaks/edge `link`), so what a session worked on outlives the claim: its
// name (./name.ts), its row and memory_session read it after the release. A
// graph whose vocabulary declares no links gets none, as a rule about
// components a vocabulary lacks never fires.
//
// The batch is checked as a whole, because a batch may take two locks, and the
// verdict has to be about the batch rather than about each bundle in turn.

import type { Bundle, Comp, Eid, Graph, Hook } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { after } from '@yaks/fp'
import { EDGE, link } from '@yaks/edge'
import { CLAIM } from './comp.ts'
import { Bounced } from './bounce.ts'

/** What the hook needs from the application: a clock, so a test can stamp a
 * fixed moment and a graph can stamp the moment it committed. */
export type LeaseOpts = {
  /** the moment a new lock is stamped with (default: now, ISO-8601) */
  now?: () => string
}

// One component off a bundle, or undefined. `null` means "drop it", which is
// not a value the check is about.
let of = (b: Bundle | undefined, name: string): Comp | undefined =>
  (b?.[name] ?? undefined) as Comp | undefined

/** The locks a batch takes: the entity, and the session it hands the lock to.
 * A bundle that drops a lock states no take and is not here. */
export let takes = (bundles: Bundle[]): [Eid, Eid][] =>
  bundles.flatMap((b) => {
    let s = of(b, CLAIM)?.session
    return s ? [[b.entity.eid, String(s)] as [Eid, Eid]] : []
  })

/** The relation a take leaves from its session to what it took. */
export let WORKED = 'worked'

// One end of the `worked` edges whose other end is among `ids`. A claim goes
// once its task is done or cancelled (./run.ts), so who worked what is read
// here; a vocabulary without the relation has no such edges.
let across = async (
  g: Graph,
  end: 'from' | 'to',
  ids: Eid[],
): Promise<Eid[]> => {
  if (!ids.length || !g.vocab.comp(WORKED)) return []
  let far = end == 'from' ? 'to' : 'from'
  let rows = await g.rows(
    `.${WORKED}&.${EDGE}.${end}=${ids.join(',')}&.fields=${EDGE}.${far}`,
  )
  return [...new Set(rows.map((r) => String(r[`${EDGE}.${far}`])))]
}

/** What `session` took, whether or not it still holds it. */
export let workedOn = (g: Graph, session: Eid): Promise<Eid[]> =>
  across(g, 'from', [session])

/** The sessions that took any of `on`, whether or not they still hold it. */
export let takers = (g: Graph, on: Eid[]): Promise<Eid[]> => across(g, 'to', on)

/**
 * The `precondition` hook: refuse a take of a held lock ({@link Bounced}),
 * stamp `at` on every lock the batch newly takes, and link its session
 * `worked` to what it took.
 *
 * Registered by {@link https://jsr.io/@yaks/session/doc/~/sessions | sessions};
 * exported on its own for a graph that wants the rule without the vocabulary.
 */
export let leasing = (opts: LeaseOpts = {}): Hook => (bundles, tx, _, ctx) => {
  let taken = takes(bundles)
  if (!taken.length) return bundles
  let now = opts.now ?? (() => new Date().toISOString())
  let want = [...new Set(taken.map(([on]) => on))]
  return after(tx.get(want), (found) => {
    let at = new Map(found.map((b) => [b.entity.eid, b]))
    // The holder of each contested entity, as the batch found it — then as the
    // batch itself leaves it, so two bundles taking one lock for two sessions
    // collide with each other and not only with the graph.
    let held = new Map<Eid, Eid>()
    for (let [on, b] of at) {
      let s = of(b, CLAIM)?.session
      if (s) held.set(on, String(s))
    }
    let fresh = new Set<Eid>()
    for (let [on, session] of taken) {
      let holder = held.get(on)
      if (holder && holder != session) throw new Bounced(on, session, holder)
      if (!holder) fresh.add(on)
      held.set(on, session)
    }
    if (!fresh.size) return bundles
    // A new lock is stamped with the moment it was taken. `at` is
    // server-owned, so admission refuses it from an untrusted client; this
    // phase runs after admission, which is what lets a hook stamp at all.
    let stamp = now()
    let vocab = (ctx?.graph as { vocab?: Vocab } | undefined)?.vocab
    let links = !!vocab?.comp(EDGE) && !!vocab.comp(WORKED)
    let worked = links
      ? [...fresh].map((on) => link(held.get(on)!, WORKED, on))
      : []
    let stamped = bundles.map((b) => {
      let c = of(b, CLAIM)
      if (!c?.session || !fresh.has(b.entity.eid)) return b
      fresh.delete(b.entity.eid) // one stamp per lock, however it was stated
      return { ...b, [CLAIM]: { ...c, at: stamp } }
    })
    return [...stamped, ...worked]
  })
}

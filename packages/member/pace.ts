// A stored component's `pace` (@yaks/vocab), held per writer: a change that
// writes one is refused when the same writer wrote a row wearing it less than a
// pace ago, and when it writes two at once. It is the flood rule a chat needs —
// one line a second from each person, however fast a page sends — said once in
// the vocabulary and held here, for every door, rather than in every page that
// reads the rows.
//
// A writer is the change's principal, and everyone signed out is one writer:
// nobody. The store cannot tell one anonymous visitor from another, so they
// share one pace, which errs the safe way; a component that should hear each
// of them apart asks a `floor` of `person` too.
//
// What a writer wrote, and when, is read off the stamps the graph already
// keeps: a row's `created` says who made it, and its `updated` who changed it
// last. A change that leaves every property of the component as it stands is
// no write of it, so a retry of the same line is not refused for its own
// first landing.

import type { Bundle, Comp, Eid, Tx } from '@yaks/graph'
import { dead, each, then } from '@yaks/graph'
import { absent, and, eq, ge, or, present } from '@yaks/query'
import { paceOf, syncOf, type Vocab } from '@yaks/vocab'

/** How often each writer writes each paced component, in ms, by name. */
export type Paces = Record<string, number>

/** A write refused for coming sooner than its component's pace. */
export class Paced extends Error {
  /**
   * @param actor who was writing, or `null` for somebody signed out
   * @param comp the component they wrote
   * @param pace how often one writer may write it, in ms
   * @param wait how long until they may again, in ms
   */
  constructor(
    public actor: Eid | null,
    public comp: string,
    public pace: number,
    public wait: number,
  ) {
    super(
      `${comp} is written at most once every ${span(pace)} by each writer — ` +
        `${actor ?? 'someone signed out'} may again in ${span(wait)}`,
    )
    this.name = 'Paced'
  }
}

// A span as a person reads it: `1s`, `250ms`, `1.5s`.
let span = (ms: number) =>
  ms >= 1000 ? `${+(ms / 1000).toFixed(1)}s` : `${ms}ms`

/**
 * The paces a loaded vocabulary declares on stored components. A relayed one
 * is @yaks/sync's to keep: its value never reaches a store.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { pacesIn } from '@yaks/member'
 * let v = loadVocab({
 *   $defs: {
 *     line: { component: true, type: 'object', pace: '1s' },
 *     spot: {
 *       component: true,
 *       type: 'object',
 *       sync: 'peers',
 *       durable: 'connection',
 *       pace: '100ms',
 *     },
 *   },
 * })
 * assertEquals(pacesIn(v), { line: 1000 })
 * ```
 */
export let pacesIn = (v: Vocab): Paces =>
  Object.fromEntries(
    v.all.flatMap((c) => {
      let pace = paceOf(v, c)
      return pace && syncOf(v, c) == 'server' ? [[c, pace]] : []
    }),
  )

// The rows wearing `comp` that this writer made, or last changed, since then.
let wrote = (comp: string, who: Eid | null, since: string) => {
  let by = (stamp: string) =>
    who ? eq(`${stamp}.by`, who) : absent(`${stamp}.by`)
  let at = (stamp: string) => and(by(stamp), ge(`${stamp}.at`, since))
  return and(present(comp), or(at('created'), at('updated')))
}

// When this writer last wrote a row, by its stamps; 0 when neither says.
let last = (row: Bundle, who: Eid | null) =>
  Math.max(
    0,
    ...['created', 'updated'].map((stamp) => {
      let s = row[stamp] as Comp | undefined
      return s && (s.by ?? null) == who ? Date.parse(String(s.at)) || 0 : 0
    }),
  )

// Whether a bundle writes this component: gives or changes one of its
// properties, where the row holds another value or none.
let writes = (b: Bundle, comp: string, row: Bundle | undefined) => {
  let patch = b[comp] as Comp | null | undefined
  if (!patch || dead(b)) return false
  let held = row?.[comp] as Comp | null | undefined
  return !held || Object.entries(patch).some(([p, v]) => held[p] != v)
}

/**
 * Refuse a change that writes a paced component sooner than its pace allows
 * this writer: two at once, or one less than a pace after the last row wearing
 * it they wrote. `now` is the moment the change is taken, in ms.
 */
export let pacing = (
  paces: Paces,
  tx: Tx,
  who: Eid | null,
  bundles: Bundle[],
  now: number = Date.now(),
): Bundle[] | Promise<Bundle[]> => {
  let paced = Object.keys(paces).filter((c) => bundles.some((b) => b[c]))
  if (!paced.length) return bundles
  let eids = [...new Set(bundles.map((b) => b.entity.eid))]
  return then(tx.get(eids), (rows) => {
    let held = new Map(rows.map((r) => [r.entity.eid, r]))
    return each(paced, bundles, (out, comp) => {
      let pace = paces[comp]
      let writing = bundles.filter((b) =>
        writes(b, comp, held.get(b.entity.eid))
      )
      if (writing.length > 1) throw new Paced(who, comp, pace, pace)
      if (!writing.length) return out
      let since = new Date(now - pace + 1).toISOString()
      return then(tx.read(wrote(comp, who, since)), (recent) => {
        if (!recent.length) return out
        let at = Math.max(...recent.map((r) => last(r, who)))
        throw new Paced(who, comp, pace, at ? at + pace - now : pace)
      })
    })
  })
}

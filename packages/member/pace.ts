// A stored component's pace is held per instrument, entity and component.
// The graph's entity stamps cannot keep these clocks: another instrument or
// an unrelated component can overwrite updated without changing this clock.
// `_pace{writes}` keeps the last accepted write of each key on its entity,
// inside the same transaction as the values it admits. Expired clocks are
// discarded on that entity's next paced write.
//
// A writer is the bundle's vouched via, whether signed in or out. All writers
// with no via share a clock on that entity's component. Authentication belongs
// to the receiving door, which replaces whatever actor the client claimed.
//
// Saying the same values again is no write and starts no clock. Clearing a
// component goes at once and leaves its clock intact; deleting the entity
// removes the clocks with it, through the graph's ordinary lifecycle.

import type { Bundle, Comp, Eid, ReadTx } from '@yaks/graph'
import { after } from '@yaks/fp'
import { composed, dead, raced, token, writers } from '@yaks/graph'
import { paceOf, syncOf, type Vocab } from '@yaks/vocab'

/** How often one via writes one entity’s component, in ms, by name. */
export type Paces = Record<string, number>

/** A write refused for coming sooner than its component's pace. */
export class Paced extends Error {
  /**
   * @param actor the writing instrument, or `null` when no via was supplied
   * @param comp the component they wrote
   * @param pace how often one writer may write it, in ms
   * @param wait how long until they may again, in ms
   */
  constructor(
    public actor: Eid | null,
    public comp: string,
    public pace: number,
    public wait: number,
    public entity?: Eid,
  ) {
    super(
      `${comp} is written at most once every ${span(pace)} by each writer — ` +
        `${actor ?? 'a writer with no via'} may again in ${span(wait)}`,
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

// One independent clock. The ledger is read whole, never queried inside.
type Write = { comp: string; via: Eid | null; at: number }

let clocks = (row: Bundle | undefined, paces: Paces, now: number): Write[] => {
  let ledger = row?._pace as Comp | undefined
  if (ledger) return ledger.writes as Write[]
  // TODO: Remove this transition reader once pre-ledger rows have migrated.
  // Their stamps lack component history, so conservatively initialize every
  // worn paced component from both recent instruments. The first accepted
  // write persists these clocks; all later checks read only the ledger.
  let recent = new Map<string, Write>()
  for (let stamp of ['created', 'updated']) {
    let s = row?.[stamp] as Comp | undefined
    if (!s) continue
    let at = Date.parse(String(s.at))
    if (!Number.isFinite(at)) continue
    let via = s.via as Eid | undefined ?? null
    for (let [comp, pace] of Object.entries(paces)) {
      if (!row?.[comp] || at + pace <= now) continue
      let key = JSON.stringify([comp, via])
      if (at > (recent.get(key)?.at ?? -Infinity)) {
        recent.set(key, { comp, via, at })
      }
    }
  }
  return [...recent.values()]
}

// A JSON-valued property read from storage is another object, but the same
// value is still a retry. Use the graph's own value tokens for that case.
let same = (a: unknown, b: unknown) =>
  a == b || typeof a == 'object' && typeof b == 'object' && token(a) == token(b)

// Whether this patch gives or changes a value; clearing goes at once.
let writes = (patch: Comp | null, held: Comp | undefined) =>
  !!patch &&
  (!held || Object.entries(patch).some(([p, v]) => !same(v, held[p])))

/**
 * Refuse writes sooner than the component's pace permits their via on that
 * entity. Append the accepted clocks as server-owned patches for the graph to
 * persist with the batch. Distinct entities, components and vias hold
 * independent clocks; all writers with no via share one on each component.
 * `now` is the moment the batch is taken, in ms.
 */
export let pacing = (
  paces: Paces,
  tx: ReadTx,
  bundles: Bundle[],
  now: number = Date.now(),
): Bundle[] | Promise<Bundle[]> => {
  if (!bundles.some((b) => Object.keys(paces).some((c) => b[c]))) return bundles
  let eids = [...new Set(bundles.map((b) => b.entity.eid))]
  let writer = writers(bundles)
  return after(tx.get(eids), (rows) => {
    let held = new Map(rows.map((r) => [r.entity.eid, r]))
    // A transaction writes one resulting value per component. Deletion wins,
    // and the graph swallows a patch that raced a tombstone; neither may gain
    // a clock patch that would bring a deleted entity back.
    let patches = composed(bundles.filter((b) => {
      let row = held.get(b.entity.eid)
      return !row || !dead(row) || !raced(b)
    }))
    let added: Bundle[] = []
    for (let b of patches) {
      if (dead(b)) continue
      let eid = b.entity.eid
      let row = held.get(eid)
      let via = writer(eid).via ?? null
      let recent = clocks(row, paces, now)
      let next: Write[] | undefined
      for (let [comp, pace] of Object.entries(paces)) {
        if (!writes(b[comp] as Comp | null, row?.[comp] as Comp | undefined)) {
          continue
        }
        let last = recent.find((w) => w.comp == comp && w.via == via)
        let wait = last ? last.at + pace - now : 0
        if (wait > 0) throw new Paced(via, comp, pace, wait, eid)
        next ??= recent.filter((w) => w.at + (paces[w.comp] ?? 0) > now)
        next.push({ comp, via, at: now })
      }
      if (next) {
        added.push({
          entity: b.entity,
          _pace: { writes: next },
          $actor: writer(eid),
          $quiet: true,
        })
      }
    }
    return added.length ? [...bundles, ...added] : bundles
  })
}

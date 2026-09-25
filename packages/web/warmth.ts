// The warmth of an entity: the recall-decay rank behind `.order=hot`, and the
// retirement damper that sinks a dead venture beneath live work.
import { type Comps, matchQuery, parseQuery } from './query.ts'

// The warmth of an entity, on (0,1] — the rank behind '.order=hot'.
// Recall aggregates (count, first_at, last_at) are the whole model:
// every recall earns a day of STABILITY, and spacing multiplies it —
// the same count spread over months buys more durability than an
// afternoon of cramming (mean interval, in weeks, is the multiplier).
// The score decays exponentially past last_at against that stability,
// so top-of-mind-for-hours / recallable-for-days / rings-a-bell-for-
// months fall out of one curve. No recall row yet: the entity's own last
// touch (updated.at, else created.at) counts as a single touch — new
// things start hot and fade
// unless used. The clock rides in as a parameter (tests fix it), and no
// stored score exists anywhere to sweep.
let DAY = 86_400_000
export let hot = (c: Comps, now: number): number => {
  let r = c.recall
  let count = Number(r?.count ?? 0)
  let last = Date.parse(String(r?.last_at ?? ''))
  if (!count || Number.isNaN(last)) {
    count = 1
    last = Date.parse(
      String(c.updated?.at ?? c.created?.at ?? ''),
    )
    if (Number.isNaN(last)) return 0
  }
  let first = Date.parse(String(r?.first_at ?? ''))
  if (Number.isNaN(first)) first = last
  let mean = count > 1 ? Math.max(0, last - first) / (count - 1) : 0
  let stability = DAY * count * (1 + mean / (7 * DAY))
  return Math.exp(-Math.max(0, now - last) / stability)
}

// Retirement is a damper, not an eraser: a retired project — and every
// task filed under it — keeps its whole recall curve but sinks beneath
// live work wherever warmth ranks (.order=hot, the digest). The lookup
// is the same comps fetcher matchQuery's path preds ride, so every
// caller already holds one.
export let SUNK = 0.1
// The far arm — a task whose PROJECT is archived — is a forward deref
// (task → its project → that project's archived stamp), so it IS the traversal
// grammar. `.archived.at` is the canonical presence spelling: the column is
// not-null. The self arm (this row IS
// an archived project) has no ref to deref, so it stays a direct test.
let SUNK_PROJECT = parseQuery('.filed.project.archived.at!')
export let sunk = (
  c: Comps,
  ent?: (eid: string) => Comps | undefined,
): boolean => (!!c.project && !!c.archived) || matchQuery(c, SUNK_PROJECT, ent)
export let warm = (
  c: Comps,
  now: number,
  ent?: (eid: string) => Comps | undefined,
) => hot(c, now) * (sunk(c, ent) ? SUNK : 1)

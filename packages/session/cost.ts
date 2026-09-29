// What a transcript cost, in dollars. Each request's `cost` (@yaks/model) is
// stored on its entry, beside its `usage`: the dollars the provider reported
// wherever it reports them (OpenRouter's usage, Claude Code's closing line),
// and otherwise the usage weighed at the `price` on the row of the model that
// answered it, in the transaction that writes the usage. A model with no price
// leaves its requests unweighed, since absent beats zero.
//
// A session's `cost` is the sum of its entries' and is never stored: a second
// copy would drift from the entries it sums, and a transcript whose entries
// record no cost has none, not zero.

import type { Bundle, Comp, Hook } from '@yaks/graph'
import { then } from '@yaks/graph'
import { COST, PRICE, type Price, USAGE, type Usage, weigh } from '@yaks/model'
import type { DerivedProp } from '@yaks/sql'
import { col, eq, fn, join, select, sub, table } from '@yaks/sql'
import { ASK, USING } from './native.ts'

// The model an entry asked (`ask.to`), or the one its `using` names.
let served = (b: Bundle | undefined): string | undefined => {
  let to = (b?.[ASK] as Comp | undefined)?.to ??
    (b?.[USING] as Comp | undefined)?.model
  return to == null ? undefined : String(to)
}

/**
 * The precondition that weighs a request its provider named no price for: a
 * bundle carrying `usage` and no `cost` gains `cost{dollars, reported: false}`
 * when the model that answered it has a `price`. The model and the counts are
 * the bundle's over the entry as stored, so a patch that only adds the usage
 * is weighed whole; a cost the entry already records stands.
 */
export let weighing: Hook = (bundles, tx) => {
  let owed = bundles.filter((b) => b[USAGE] && !(COST in b))
  if (!owed.length) return bundles
  let eids = owed.map((b) => b.entity.eid)
  return then(tx.get(eids, [ASK, USING, USAGE, COST]), (held) => {
    let stored = new Map(held.map((b) => [b.entity.eid, b]))
    let was = (b: Bundle) => stored.get(b.entity.eid)
    let fresh = owed.filter((b) => !was(b)?.[COST])
    let model = (b: Bundle) => served(b) ?? served(was(b))
    let models = [...new Set(fresh.map(model).filter((m) => m != null))]
    return then(models.length ? tx.get(models, [PRICE]) : [], (rows) => {
      let price = new Map(
        rows.filter((r) => r[PRICE]).map((r) => [r.entity.eid, r[PRICE]]),
      )
      return bundles.map((b) => {
        let at = fresh.includes(b) && price.get(model(b) ?? '')
        if (!at) return b
        let usage = { ...was(b)?.[USAGE] as Usage, ...b[USAGE] as Usage }
        let dollars = weigh(at as Price, usage)
        return { ...b, [COST]: { dollars, reported: false } }
      })
    })
  })
}

/** `session.cost` as SQL, for @yaks/sqlite's derived-property registry: the
 * dollars its entries record, or nothing where none records any. */
export let sessionCost: DerivedProp = {
  tag: 'number',
  expr: (owner) =>
    sub(select({
      cols: [fn('sum', col('dollars', 'k'))],
      from: table('entry', 'e'),
      joins: [
        join(table(COST, 'k'), eq(col('entity', 'k'), col('entity', 'e'))),
      ],
      where: eq(col('session', 'e'), owner),
    })),
}

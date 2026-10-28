// A single stored reference-presence selector needs its owner and target,
// already scoped by the dialect, without a general predicate/window plan.
import type { And } from '@yaks/query/core'
import type { Vocab } from '@yaks/vocab'
import type { BindOpts } from './bind.ts'
import { and, cond, join, notNull, raw, type Select, select } from './ast.ts'
import type { Dialect } from './sqlite.ts'

export let presence = (
  query: And,
  vocab: Vocab,
  opts: BindOpts,
  d: Dialect,
): Select | undefined => {
  if (
    !d.scoped || opts.eids || opts.graves || opts.archetypes ||
    opts.extend?.length || query.clauses.length != 1
  ) return undefined
  let c = query.clauses[0]
  if (
    c.kind != 'pred' || c.not || c.where || c.op != '!' || c.value ||
    c.path.length != 2
  ) return undefined
  let [comp, prop] = c.path, p = vocab.prop(comp, prop)
  if (
    comp == 'entity' || p?.category != 'ref' || p.computed ||
    vocab.comp(comp)?.computed || vocab.comp(p.ref!)?.computed ||
    opts.derived?.[`${comp}.${prop}`] || opts.absent?.includes(comp)
  ) return undefined
  let value = d.col(comp, prop, vocab)
  if (!value) return undefined
  return select({
    cols: [raw(d.membership)],
    from: raw(d.spine),
    joins: [
      join(
        raw(d.joined?.(comp) ?? d.table(comp)),
        raw(d.joinOn(comp, 'entity')),
      ),
    ],
    where: and(notNull(raw(value)), cond(d.live())),
    order: opts.unordered ? [] : [
      ...vocab.prop('entity', 'num')
        ? [raw(d.col('entity', 'num', vocab)!)]
        : [],
      raw(d.ownerKey('entity')),
    ],
  })
}

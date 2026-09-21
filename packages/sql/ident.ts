// The identity operand list. `.eid=` and `.num=` on the entity table NAME
// entities rather than compare a column, so the right-hand side is a set — the
// shape an index can look up, and the shape a client fetching named rows asks
// for.
//
// A human-readable id belongs here too: @yaks/id reads `B-7` as the entity
// numbered 7 (the letter is for display, the number is the identity), so one
// syntax fetches by eid, by entity number, or by the id a person types. Every
// operand falls into one of the two sets an evaluator looks it up in.
//
// `undefined` is a deliberate decline: an empty value (which means absence), a
// range, or an operand that is not a number under `.num`. The caller then
// compiles the column the ordinary way, so nothing that already worked
// changes.

import { parse } from '@yaks/id'

/** An operand list, split into the eids and the entity numbers it names. */
export type Identity = { eids: string[]; nums: number[] }

/**
 * The entities an operand list names, or `undefined` when the value is not an
 * operand list. `column` is the entity-table column the query used: `eid`
 * accepts either form, `num` accepts only numbers.
 */
export let identity = (
  column: string,
  value: string,
): Identity | undefined => {
  if (!value || value.includes('..')) return undefined
  let out: Identity = { eids: [], nums: [] }
  for (let operand of value.split(',')) {
    let id = parse(operand)
    if (id) out.nums.push(id.num)
    else if (column == 'num') return undefined
    else out.eids.push(operand)
  }
  return out
}

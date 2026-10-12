// The identity operand list. `.entity.eid=` and `.entity.num=` on the entity
// table name entities rather than compare a column, so the right-hand side is a
// set — the shape an index can look up, and the shape a client fetching named
// rows asks for.
//
// A human-readable id belongs here too: @yaks/id reads `B-7` as the entity
// numbered 7 (the letter is for display, the number is the identity), so one
// syntax fetches by eid, by entity number, or by the id a person types. Every
// operand falls into one of the two sets an evaluator looks it up in.
//
// `undefined` is a deliberate decline: an empty value (which means absence), a
// range, or an operand that is not a number under `.entity.num`. The caller then
// compiles the column the ordinary way, so nothing that already worked
// changes.

import { parse } from '@yaks/id'
import type { Value } from '@yaks/query/core'

/** Literal operands for keyed equality, or undefined for ranges and absence. */
export let literals = (value: Value | null): string[] | undefined => {
  if (!value || value.kind == 'range') return undefined
  if (value.kind != 'list') return value.raw ? [value.raw] : undefined
  // An empty scalar on its own asks for absence; inside a list it names the
  // empty value, so keyed membership must retain it as a literal.
  let items = value.items.map((item) =>
    item.kind == 'scalar' || item.kind == 'time' ? [item.raw] : literals(item)
  )
  return items.every((item): item is string[] => item != null)
    ? items.flat()
    : undefined
}

/** An operand list, split into the eids and the entity numbers it names. */
export type Identity = { eids: string[]; nums: number[] }

/**
 * The entities an operand list names, or `undefined` when the value is not an
 * operand list. `prop` is the `entity` property the query used: `eid`
 * accepts either form, `num` accepts only numbers.
 */
export let identity = (
  prop: string,
  value: string | Value | null,
  exact = false,
): Identity | undefined => {
  if (prop != 'eid' && prop != 'num') return undefined
  let operands = typeof value == 'string'
    ? !value || value.includes('..') ? undefined : value.split(',')
    : literals(value)
  if (!operands) return undefined
  let out: Identity = { eids: [], nums: [] }
  for (let operand of operands) {
    let id = exact && prop == 'eid' ? undefined : parse(operand)
    if (id) out.nums.push(id.num)
    else if (prop == 'num') return undefined
    else out.eids.push(operand)
  }
  return out
}

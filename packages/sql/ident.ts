// The IDENTITY operand list. `.eid=` and `.num=` on the spine NAME entities
// rather than compare a column, so their right-hand side is a set — the shape
// an index answers, and the shape a client fetching named rows asks for.
//
// A human id lands here too: @yaks/id reads `B-7` as the entity numbered 7 (the
// letter is display, the number is identity), so one spelling fetches by eid, by
// spine number, or by the id a person types. Every operand falls into one of the
// two sets an evaluator looks it up in.
//
// `undefined` is the deliberate decline: an empty value (absence grammar), a
// range, or a word that is no number under `.num`. The caller then lowers the
// column the ordinary way, so nothing that already worked changes shape.

import { parse } from '@yaks/id'

/** An operand list, split into the eids and the spine numbers it names. */
export type Identity = { eids: string[]; nums: number[] }

/**
 * The entities an operand list names, or `undefined` when the value is not one.
 * `column` is the spine column the query said: `eid` takes either spelling,
 * `num` only numbers.
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

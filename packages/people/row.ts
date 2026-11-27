// What a person's row says, read without the phone metadata the rest of this
// package matches numbers by, so a store that only reads an address loads none
// of it.
import type { Bundle, Comp } from '@yaks/graph'

/** The component `name` of `row`, or an empty one. */
export let fields = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}

/** The address a person's row lists, as it is typed. */
/// emailOf({ entity: { eid: 'a' }, individual: { email: 'ann@x.org' } }) -> 'ann@x.org'
/// emailOf(undefined) -> undefined
export let emailOf = (row: Bundle | undefined): string | undefined => {
  let email = fields(row, 'individual').email
  return typeof email == 'string' ? email : undefined
}

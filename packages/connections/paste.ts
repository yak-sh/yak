// A pasted key as the write that keeps it: the connection's secret given its
// value, which @yaks/secrets takes out of the write and seals in the vault,
// and the connection marked connected. `connect` writes it for trusted code,
// and a page writes it itself through the graph (./form.ts): both are this.
// It reads nothing, so a browser can make it from what it already holds.

import type { Bundle } from '@yaks/graph'
import type { Field } from './field.ts'
import { CONNECTION } from './identity.ts'

/** What a person gave: the one key, or each field by name. */
export type Pasted = { key: string } | { fields: Record<string, string> }

/** What the vault keeps for a pasted credential: one field's value as it is,
 * so one key is kept as it always was, and several as a JSON object by name. */
export let keptOf = (
  name: string,
  fields: Field[],
  given: Pasted,
): string => {
  let said = 'key' in given
    ? fields.length == 1 ? { [fields[0].name]: given.key } : {}
    : given.fields
  let extra = Object.keys(said).filter((k) => !fields.some((f) => f.name == k))
  let missing = fields.filter((f) => !said[f.name])
  if (extra.length || missing.length) {
    throw new Error(
      `${name} is connected with ${fields.map((f) => f.label).join(', ')}; ${
        missing.length
          ? `${missing.map((f) => f.label).join(', ')} not given`
          : `it has no ${extra.join(', ')}`
      }`,
    )
  }
  return fields.length == 1 ? said[fields[0].name] : JSON.stringify(
    Object.fromEntries(fields.map((f) => [f.name, said[f.name]])),
  )
}

/** The write keeping `given` as connection `b`'s credential, through the
 * integration `name` that asks for `fields`: its secret's value, and its
 * status connected. */
export let pasted = (
  b: Bundle,
  name: string,
  fields: Field[],
  given: Pasted,
): Bundle => ({
  entity: { eid: b.entity.eid },
  secret: {
    name: String((b.secret as { name?: string } | undefined)?.name),
    value: keptOf(name, fields, given),
  },
  [CONNECTION]: { status: 'connected' },
})

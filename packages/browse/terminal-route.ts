/** CLI addresses share Browse's route grammar; Inspect selects its reading. */
import { schemaPath } from './navigation.ts'
import { entityPath, searchPath } from './url.ts'
import { BARE, parse, SHORT } from '@yaks/id'
import { EID } from './types.ts'
// An id opens its entity in every spelling the graph addresses: a human id or
// number, a `#` handle, the handle copied without its `#` (an eid's first
// segment), or a whole eid. Anything else is a query.
let named = (what: string) =>
  !!parse(what) || SHORT.test(what) || BARE.test(what) ||
  EID.test(what)
export let start = (what: string, inspect = false): string => {
  if (!what) return inspect ? schemaPath : '/'
  return named(what)
    ? `${entityPath(what)}${inspect ? '?v=Debug' : ''}`
    : searchPath(what)
}

// Where a text property's suggestions come from. A vocabulary declaration
// names a well (`{text: 'domains'}`), and the well answers the values seen so
// far. The editor that sets such a property (@yaks/ux) and the query field
// that completes one (fields.tsx) read the same wells; a plugin may replace
// one while the column still selects its control through the registry.
import { domains, useHold } from '../live.ts'
import { propAt } from '../props.ts'

export let wells: Record<string, () => string[]> = {
  domains: () => domains.value,
}

export let defineWells = (sources: typeof wells) =>
  Object.assign(wells, sources)

// What a well asks the server, held while a picker draws its values. Without
// a hold a well answers from the rows this tab holds (the query field's
// completion, which is no component).
let asks: Record<string, { agg: string; line: string }> = {
  domains: { agg: domains.agg, line: domains.line },
}

/** A well's values, held for the mounted picker that draws them. */
export let useWell = (well: string): string[] => {
  useHold(asks[well])
  return wells[well]?.() ?? []
}

// The well a property's declaration names, or '' for none.
export let wellOf = (comp: string, prop: string): string => {
  let type = propAt(comp, prop)?.type
  return type && typeof type == 'object' && 'text' in type ? type.text : ''
}

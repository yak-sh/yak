// The census's pure half: what the admin interface derives from the
// vocabulary, kept DOM-free so tests can hold the derivation property —
// a new comp in types.ts appears here with zero admin edits. The sidebar
// is every vocabulary component; a component's table columns are its own
// props (wire-writable AND stamped — outcomes belong on the page) between
// the id/title lead and the entity timestamps.
import { comps, type PropType, stamped } from '../types.ts'
import { type Row } from '../client.ts'

export let censusComps = () => Object.keys(comps).sort()

// A section lists by component PRESENCE, not primary kind: an entity
// appears under EVERY component it carries. A facet (alias, email) always
// rides a higher-ranked kind — kindOf picks one, so a kind filter empties
// its section (P-19 is alias{slug} yet kindOf=project). Presence picks all.
export let inSection = (rows: Row[], kind: string): Row[] =>
  rows.filter((r) => r.comps[kind])

// The sidebar count is the same rule tallied: each entity increments every
// vocabulary component it wears, so the counts and sections agree.
export let countsByPresence = (rows: Row[], order = censusComps()) => {
  let counts: Record<string, number> = {}
  for (let r of rows) {
    for (let k of order) if (r.comps[k]) counts[k] = (counts[k] ?? 0) + 1
  }
  return counts
}

// One index column: the lead/timestamp columns carry only a key; a
// vocabulary column carries its comp + PropType so the cell can pick a
// face (dot, chip, text) the same way editors pick a control.
export type Col = { key: string; comp?: string; prop?: string; t?: PropType }

export let columnsFor = (kind: string): Col[] => [
  { key: 'id' },
  { key: 'title' },
  ...Object.entries(comps[kind] ?? {}).map(([prop, t]) => (
    { key: prop, comp: kind, prop, t }
  )),
  ...Object.entries(stamped[kind] ?? {}).map(([prop, t]) => (
    { key: prop, comp: kind, prop, t }
  )),
  { key: 'modified' },
]

// The route below /admin: '' = first content kind's index; a kind; a
// kind + 'new'. Pure over the path so the view stays a lookup.
export let adminRoute = (
  path: string,
): { kind: string; form: boolean } => {
  let [, , kind, verb] = path.split('/')
  return {
    kind: kind || censusComps()[0],
    form: verb == 'new',
  }
}

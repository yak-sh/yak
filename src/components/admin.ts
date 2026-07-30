// The census's pure half: what the admin interface derives from the
// vocabulary, kept DOM-free so tests can hold the derivation property —
// a new comp in types.ts appears here with zero admin edits. The sidebar
// is kindOrder split into content and system; a kind's table columns are
// its own comp props (wire-writable AND stamped — outcomes belong on the
// page) between the id/title lead and the entity timestamps.
import { comps, kindOrder, type PropType, stamped } from '../types.ts'

// The chrome kinds — the UI's own furniture and the machinery's audit
// rows. Real to the graph, noise to a census; the sidebar folds them.
let SYSTEM = new Set([
  'card',
  'client',
  'camera',
  'fold',
  'claim',
  'stop_request',
  'send_request',
  'conflict',
])

export let groupedKinds = () => ({
  content: kindOrder.filter((k) => !SYSTEM.has(k)),
  system: kindOrder.filter((k) => SYSTEM.has(k)),
})

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
    kind: kind || groupedKinds().content[0],
    form: verb == 'new',
  }
}

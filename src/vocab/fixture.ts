// The vocabulary fixture: one canonical JSON face for every DATA export of
// types.ts, so "the generated file says exactly what the hand-written one
// said" is a string comparison. Key order is kept where it is load-bearing
// (comps/sessionComps/stamped drive delete order and doc generation; arrays
// are ordered by nature) and sorted where it is not (renames, partition,
// prefix, indexes), so a harmless emission-order difference never fails the
// gate while a real vocabulary drift always does.

// deno-lint-ignore no-explicit-any
type Mod = Record<string, any>

let sorted = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a < b ? -1 : 1))

// The exports whose object KEY ORDER carries meaning — emitted verbatim.
let ordered = ['comps', 'sessionComps', 'stamped']
// Ordered lists and scalar tables, compared as-is.
let plain = [
  'statuses',
  'turnStates',
  'messageRoles',
  'httpMethods',
  'roleStates',
  'roleSurfaces',
  'wakePolicies',
  'ventureStates',
  'ventureModes',
  'dirs',
  'subModes',
  'verdicts',
  'grades',
  'noticeKinds',
  'kindOrder',
  'edges',
  'governed',
  'capabilities',
  'sessionFacetNames',
  'sessionActive',
]
// Maps whose key order is incidental — sorted before comparison.
let unordered = ['renames', 'viewRenames', 'propRenames', 'partition', 'prefix']
// Sets — compared as sorted arrays.
let sets = ['byName', 'plurals']
// Maps of arrays (indexes) — keys sorted, rows kept in order.
let mapsOfRows = ['indexes']

export let capture = (mod: Mod): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let k of ordered) out[k] = JSON.stringify(mod[k])
  for (let k of plain) out[k] = JSON.stringify(mod[k])
  for (let k of unordered) out[k] = JSON.stringify(sorted(mod[k]))
  for (let k of sets) out[k] = JSON.stringify([...mod[k]].sort())
  for (let k of mapsOfRows) out[k] = JSON.stringify(sorted(mod[k]))
  return out
}

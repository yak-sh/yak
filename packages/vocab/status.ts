// The `status` keyword: a component's status computed from the components its
// entity wears, declared once as data so every evaluator is built from it.
//
//   "task": {
//     "component": true,
//     "status": { "cancelled": "cancelled", "completed": "done", "default": "open" }
//   }
//
// The map is ordered, and order is the rule: the first rung whose component
// the entity wears gives the status, and an entity wearing none reads as
// `default`. The component gains a computed `status` property from it
// (`task.status`), read-only, whose closed set is every status the ladder can
// give. An entity without the component has no status at all.
//
// The rungs are usually marks (a component with a stamped `at` and a `by` or
// `via`, recording what happened to the entity), but any component can be
// one: a held `claim` reads `wip`. Another package adds a rung through
// `extends` on the component, and its rungs are appended in the order the
// documents were loaded, after the declaring document's.
//
// @yaks/sql reads the ladder as SQL and @yaks/match reads it off a bundle, both
// from `CompInfo.ladder`; nothing else writes one out. The keyword is `status`;
// a mark is a component with stamped `at` and `by`/`via`. The words stay apart.

import type { Ladder, PropSchema } from './types.ts'

let DEFAULT = 'default'

let wrong = (name: string, why: string): never => {
  throw new Error(`'${name}' status: ${why}`)
}

// The rungs a `status` map names, in order, checked for the shape a rung has.
let rungsOf = (name: string, said: unknown): [string, string][] => {
  if (!said || typeof said != 'object' || Array.isArray(said)) {
    wrong(name, 'is a map from a component to the status it gives')
  }
  let out = Object.entries(said as Record<string, unknown>)
    .filter(([comp]) => comp != DEFAULT)
  for (let [comp, status] of out) {
    if (typeof status != 'string' || !status) {
      wrong(name, `${comp} gives no status`)
    }
    if (comp == name) wrong(name, `${comp} is the component itself`)
  }
  return out as [string, string][]
}

/**
 * A component entry with another document's rungs appended: an `extends`
 * entry's `status` adds rungs to the ladder its component declares, after
 * that ladder's own. The default stays the declaring document's, and a rung
 * the ladder already has is a collision, not an override.
 */
export let appended = (
  name: string,
  base: PropSchema,
  more: Record<string, string>,
): PropSchema => {
  if (!base.status) wrong(name, 'extends a component with no status to add to')
  if (DEFAULT in more) wrong(name, 'an extension adds rungs, not a default')
  let status = { ...base.status }
  for (let [comp, s] of rungsOf(name, more)) {
    if (comp in status) wrong(name, `${comp} already reads ${status[comp]}`)
    status[comp] = s
  }
  return { ...base, status }
}

/**
 * The ladder a component entry's `status` declares, or undefined when it
 * declares none. A rung whose component this load does not declare is left
 * out, the way a graph composed without that package has none of its rows;
 * a rung naming a computed component is refused, since no entity wears one.
 */
export let ladderOf = (
  name: string,
  schema: PropSchema,
  defs: Record<string, PropSchema>,
): Ladder | undefined => {
  let said = schema.status
  if (said === undefined) return undefined
  let rungs = rungsOf(name, said).filter(([comp]) => defs[comp])
  for (let [comp] of rungs) {
    if (defs[comp].computed === true) wrong(name, `${comp} is computed`)
  }
  let fallback = said[DEFAULT]
  if (typeof fallback != 'string' || !fallback) {
    wrong(name, 'names no default, the status of an entity wearing no rung')
  }
  // The entry a loaded vocabulary reports carries the property this made
  // (`Vocab.def`), and reads back as the same ladder; a stored one is a second
  // home for the status.
  let own = schema.properties?.status
  if (own && own.computed !== true) {
    wrong(name, 'computes the status property, so it stores none')
  }
  return {
    rungs: rungs.map(([comp, status]) => ({ comp, status })),
    default: fallback,
  }
}

/** Every status a ladder can give, in ladder order with the default last. */
let statuses = (l: Ladder): string[] => [
  ...new Set([...l.rungs.map((r) => r.status), l.default]),
]

/** The `status` property a ladder gives its component: computed from the
 * component's own entity, a closed set, never written. */
export let statusProp = (l: Ladder): PropSchema => ({
  type: 'string',
  enum: statuses(l),
  computed: true,
  reads: [],
  description: `where it stands: ${
    l.rungs.map((r) => `${r.status} wearing ${r.comp}`).join(', ')
  }${l.rungs.length ? ', else ' : ''}${l.default}`,
})

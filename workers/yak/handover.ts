// One person's rows becoming another's (newcomer.ts `keep`): every row that
// names `from`, read by `.refs=from&*`, names `to` instead. The directory
// moves its seats and browsers this way, and a space's Operator store its
// conversations, requests, asks, wake-ups, drafts and Updates, so whatever
// names a person moves with them without a list to keep. Who wrote a row
// (`created`, `updated`) is history and stays as it was.
import type { Bundle } from '@yaks/graph'

const KEPT = new Set(['entity', 'created', 'updated'])

// A reference reads back as its eid, or as `{eid, name}` where its target
// has a name.
let is = (v: unknown, who: string) =>
  v === who || (v as { eid?: unknown } | null)?.eid === who
let names = (v: unknown, who: string): boolean =>
  is(v, who) || Array.isArray(v) && v.some((x) => names(x, who))
let swapped = (v: unknown, from: string, to: string): unknown =>
  is(v, from) ? to : Array.isArray(v) ? v.map((x) => swapped(x, from, to)) : v

/** The patches that make `rows` name `to` where they named `from`: each
 * component that named them, whole, and no row that did not. */
export let handover = (rows: Bundle[], from: string, to: string): Bundle[] =>
  rows.flatMap((row) => {
    let comps = Object.entries(row).flatMap(([name, comp]) => {
      if (KEPT.has(name) || name.startsWith('$') || !comp) return []
      if (typeof comp != 'object' || Array.isArray(comp)) return []
      let props = Object.entries(comp as Record<string, unknown>)
      if (!props.some(([, v]) => names(v, from))) return []
      return [[
        name,
        Object.fromEntries(
          props.map(([k, v]) => [k, swapped(v, from, to)]),
        ),
      ]]
    })
    return comps.length
      ? [{ entity: { eid: row.entity.eid }, ...Object.fromEntries(comps) }]
      : []
  })

/** The query reading every row that names `person`, whole. */
export let naming = (person: string) => `.refs=${person}&*`

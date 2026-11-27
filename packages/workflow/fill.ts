// A step's `write`, filled for one binding of its match: pure data in, bundles
// out. A whole string `$name` the match bound is replaced by what it bound, at
// any depth; an entity eid `$name` the match did not bind names a fresh entity,
// one per binding, so two bindings in one batch never write the same row. That
// is graph's `filled` for a bundle template rather than a query's write
// clauses.

import { type Bundle, type Eid, mint } from '@yaks/graph'

/** A template filled for one binding: its bundles, and the eids it made
 * fresh, which are the rows a workflow's step stamps `made` on. */
export type Filled = { bundles: Bundle[]; fresh: Eid[] }

let named = (v: unknown): string | undefined =>
  typeof v == 'string' && v.length > 1 && v[0] == '$' ? v.slice(1) : undefined

/**
 * `write` with each `$name` the binding holds as its value, and each unbound
 * `$name` eid fresh from `make` (a v4 UUID by default).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { fill } from '@yaks/workflow'
 *
 * let { bundles, fresh } = fill(
 *   [{ entity: { eid: '$c' }, call: { to: 'ship', args: { order: '$o' } } }],
 *   { o: 'o1' },
 *   () => 'c1',
 * )
 * equal(bundles, [{ entity: { eid: 'c1' }, call: { to: 'ship', args: { order: 'o1' } } }])
 * equal(fresh, ['c1'])
 * ```
 */
export let fill = (
  write: Bundle[],
  vars: Record<string, unknown>,
  make: () => Eid = mint,
): Filled => {
  let made = new Map<string, Eid>()
  for (let b of write) {
    let name = named(b.entity?.eid)
    if (name && !(name in vars) && !made.has(name)) made.set(name, make())
  }
  let value = (v: unknown): unknown => {
    let name = named(v)
    if (name != null) {
      if (name in vars) return vars[name]
      if (made.has(name)) return made.get(name)
      return v
    }
    if (Array.isArray(v)) return v.map(value)
    if (v && typeof v == 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, value(x)]),
      )
    }
    return v
  }
  return {
    bundles: write.map((b) => value(b) as Bundle),
    fresh: [...made.values()],
  }
}

/** The components a template writes: its bundles' keys, less `entity` and
 * the `$` requests. */
export let writes = (write: Bundle[]): string[] => [
  ...new Set(
    write.flatMap((b) =>
      Object.keys(b).filter((k) => k != 'entity' && k[0] != '$')
    ),
  ),
]

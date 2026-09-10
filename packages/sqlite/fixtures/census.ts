// Frozen pre-archetype gather oracle (T-37056). Test-only; do not modernize it.
import type { Column, Vocab } from '@yaks/vocab'
import type { BindOpts, Derived } from '@yaks/sql'
import type { Driver } from '../driver.ts'
import type { Bundle, Comp } from '../bundle.ts'
import { tombstoned } from '@yaks/graph'

let read1 = (v: Vocab, comp: string, derived: Derived): Column[] =>
  v.columns(comp).map((p) => v.column(comp, p)!)
    .filter((c) => c.persist || derived[`${comp}.${c.prop}`])

// The projected read for one component: each scalar straight off the row, each
// reference joined back to its target's eid, keyed by the owner eid. A
// component with no columns reads a bare presence flag.
//
// A column whose READ differs from its storage is read through its registered
// expression instead — the same `derived` registry @yaks/sql consults when it
// compiles a query (see @yaks/sql/derived.ts). That is what keeps the two
// readers agreeing: a value the filter resolves one way cannot come back
// gathered another. It is also the seam a content-addressed column lands on —
// @yaks/blob registers one override per body column, and the gather returns the
// text rather than the address the row holds.
//
// So the component table is aliased by its OWN NAME here, exactly as the binder
// joins it, and an override's `deps` are LEFT JOINed the same way: a registered
// expression is written once and reads the same in both places.
let project = (
  v: Vocab,
  comp: string,
  derived: Derived,
): { sel: string[]; joins: string[] } => {
  let self = `"${comp}"`
  let sel: string[] = []
  let joins: string[] = []
  let deps = new Set<string>()
  for (let c of read1(v, comp, derived)) {
    let own = derived[`${comp}.${c.prop}`]
    if (own) {
      for (let d of own.deps ?? []) deps.add(d)
      sel.push(`${own.expr(`${self}."entity"`)} as "${c.prop}"`)
    } else if (c.category == 'ref') {
      let a = `r_${c.prop.replaceAll(/[^A-Za-z0-9]/g, '_')}`
      joins.push(`left join entity "${a}" on "${a}".id = ${self}."${c.prop}"`)
      sel.push(`"${a}".eid as "${c.prop}"`)
    } else {
      sel.push(`${self}."${c.prop}" as "${c.prop}"`)
    }
  }
  for (let d of deps) {
    if (d == comp) continue
    joins.push(`left join "${d}" on "${d}"."entity" = ${self}."entity"`)
  }
  return { sel, joins }
}

export let get = (
  driver: Driver,
  vocab: Vocab,
  eids: string[],
  opts: BindOpts = {},
): Bundle[] => {
  let found = new Map<string, Bundle>()
  // Bound parameter count and SQL-cache size; gather a COMPONENT per set,
  // never every component per entity (a 1,000-entry transcript is otherwise
  // tens of thousands of queries). A JSON array uses one bind and one stable
  // prepared statement shape regardless of cardinality (SQLite 3.38+).
  // Materialize the selected ids once: re-running a window subquery
  // for each component could select different owners under a concurrent writer.
  // Keep caller order and duplicate semantics.
  for (let i = 0; i < eids.length; i += 4096) {
    let ids = eids.slice(i, i + 4096)
    let params = [JSON.stringify(ids)]
    let sub = 'select value from json_each(?)'
    let owners: number[] = []
    let byId = new Map<number, Bundle>()
    for (
      let row of driver.query(
        `select e.id, e.eid, e.num, t.entity as dead${
          vocab.comp('archetype')
            ? ', (select a.eid from entity a where a.id = e.archetype) as archetype'
            : ''
        } from entity e
       left join tombstone t on t.entity = e.id where e.eid in (${sub})`,
        params,
      )
    ) {
      let eid = String(row.eid)
      owners.push(Number(row.id))
      let entity = {
        eid,
        ...row.num == null ? {} : { num: Number(row.num) },
        ...(row.archetype == null ? {} : { archetype: String(row.archetype) }),
      }
      let bundle = row.dead == null ? { entity } : tombstoned(entity)
      found.set(eid, bundle)
      byId.set(Number(row.id), bundle)
    }
    if (!owners.length) continue
    params = [JSON.stringify(owners)]
    // A wide vocabulary is usually sparse. Ask which tables have rows in
    // this set before projecting their columns; empty facets need no joins
    // or driver round trip. Short-circuit globally empty tables before walking
    // the owners: otherwise each empty facet costs 4096 fruitless index probes
    // per chunk in a wide read. This is a live existence check, not a cached
    // census that could miss a newly populated table on this or another handle.
    // One owner already costs only one lookup; it needs no extra table probe.
    // Every membership probe uses the same bound owner set.
    let names = vocab.all.filter((c) => c != 'entity')
    let present: string[] = []
    // Stay below SQLite's compound-select limit even for very wide vocabularies.
    for (let j = 0; j < names.length; j += 400) {
      present.push(
        ...driver.query(
          `with owners as materialized (select value from json_each(?)) ` +
            names.slice(j, j + 400).map((c) =>
              `select '${c}' as name where ${
                owners.length > 1 ? `exists (select 1 from "${c}") and ` : ''
              }exists (select 1 from owners
            cross join "${c}" where "${c}".entity = owners.value)`
            ).join(' union all '),
          params,
        ).map((r) => String(r.name)),
      )
    }
    for (let comp of present) {
      // The spine pass already resolved every owner's storage id. Do not join
      // it again for each component just to recover the eid we already hold.
      // References still use project()'s joins; only ownership stays numeric.
      let { sel, joins } = project(vocab, comp, opts.derived ?? {})
      for (
        let row of driver.query(
          `select ${[`"${comp}".entity as "@id"`, ...sel].join(', ')} ` +
            `from "${comp}" ${joins.join(' ')} ` +
            `where "${comp}".entity in (${sub})`,
          params,
        )
      ) {
        let { '@id': owner, ...value } = row
        let b = byId.get(Number(owner))!
        if ('tombstone' in b) continue
        b[comp] = value as Comp
      }
    }
  }
  return eids.flatMap((eid) => found.has(eid) ? [found.get(eid)!] : [])
}

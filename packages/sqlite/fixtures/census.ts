// Frozen pre-archetype gather oracle (T-37056). Test-only: it reads the way
// gather read before archetypes, so keep its plan, not the newer one.
import type { Prop, Vocab } from '@yaks/vocab'
import {
  among,
  and,
  as,
  type BindOpts,
  col,
  cross,
  type Derived,
  type Driver,
  each,
  eq,
  exists,
  type Expr,
  type Join,
  left,
  lit,
  select,
  sub,
  table,
  unionAll,
} from '@yaks/sql'
import type { Bundle, Comp } from '../bundle.ts'
import { tombstoned } from '@yaks/graph'

let read1 = (v: Vocab, comp: string, derived: Derived): Prop[] =>
  v.props(comp).map((p) => v.prop(comp, p)!)
    .filter((c) => !c.computed || derived[`${comp}.${c.prop}`])

// The projected read for one component: each scalar straight off the row, each
// reference joined back to its target's eid, keyed by the owner eid. A
// component with no properties reads a bare presence flag.
//
// A property whose READ differs from its storage is read through its registered
// expression instead — the same `derived` registry @yaks/sql consults when it
// compiles a query (see @yaks/sql/derived.ts). That is what keeps the two
// readers agreeing: a value the filter resolves one way cannot come back
// gathered another. It is also the seam a content-addressed property lands
// on — @yaks/blob registers one override per body property, and the gather
// returns the text rather than the address the row holds.
//
// So the component table is aliased by its OWN NAME here, exactly as the binder
// joins it, and an override's `deps` are LEFT JOINed the same way: a registered
// expression is written once and reads the same in both places.
let project = (
  v: Vocab,
  comp: string,
  derived: Derived,
): { sel: Expr[]; joins: Join[] } => {
  let sel: Expr[] = []
  let joins: Join[] = []
  let deps = new Set<string>()
  for (let c of read1(v, comp, derived)) {
    let own = derived[`${comp}.${c.prop}`]
    if (own) {
      for (let d of own.deps ?? []) deps.add(d)
      sel.push(as(own.expr(col('entity', comp)), c.prop))
    } else if (c.category == 'ref') {
      let a = `r_${c.prop.replaceAll(/[^A-Za-z0-9]/g, '_')}`
      joins.push(
        left(table('entity', a), eq(col('id', a), col(c.prop, comp))),
      )
      sel.push(as(col('eid', a), c.prop))
    } else {
      sel.push(as(col(c.prop, comp), c.prop))
    }
  }
  for (let d of deps) {
    if (d == comp) continue
    joins.push(left(table(d), eq(col('entity', d), col('entity', comp))))
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
    let owners: number[] = []
    let byId = new Map<number, Bundle>()
    for (
      let row of driver.query(select({
        cols: [
          col('id', 'e'),
          col('eid', 'e'),
          col('num', 'e'),
          as(col('entity', 't'), 'dead'),
          ...(vocab.comp('archetype')
            ? [as(
              sub(select({
                cols: [col('eid', 'a')],
                from: table('entity', 'a'),
                where: eq(col('id', 'a'), col('archetype', 'e')),
              })),
              'archetype',
            )]
            : []),
        ],
        from: table('entity', 'e'),
        joins: [
          left(table('tombstone', 't'), eq(col('entity', 't'), col('id', 'e'))),
        ],
        where: among(col('eid', 'e'), each(ids)),
      }))
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
    // A wide vocabulary is usually sparse. Ask which tables have rows in
    // this set before projecting their columns; an empty component table needs
    // no join and no driver round trip. Short-circuit globally empty tables
    // before walking the owners: otherwise each empty component table costs
    // 4096 fruitless index probes per chunk in a wide read. This is a live existence check, not a cached
    // census that could miss a newly populated table on this or another handle.
    // One owner already costs only one lookup; it needs no extra table probe.
    // Every membership probe uses the same bound owner set.
    let names = vocab.all.filter((c) => c != 'entity')
    let present: string[] = []
    // Stay below SQLite's compound-select limit even for very wide vocabularies.
    for (let j = 0; j < names.length; j += 400) {
      let probes = names.slice(j, j + 400).map((c) =>
        select({
          cols: [as(lit(c), 'name')],
          where: and(
            ...(owners.length > 1
              ? [exists(select({ cols: [lit(1)], from: table(c) }))]
              : []),
            exists(select({
              cols: [lit(1)],
              from: table('owners'),
              joins: [cross(table(c))],
              where: eq(col('entity', c), col('value', 'owners')),
            })),
          ),
        })
      )
      present.push(
        ...driver.query({
          ...unionAll(...probes),
          with: [{ name: 'owners', q: each(owners), materialized: true }],
        }).map((r) => String(r.name)),
      )
    }
    for (let comp of present) {
      // The spine pass already resolved every owner's storage id. Do not join
      // it again for each component just to recover the eid we already hold.
      // References still use project()'s joins; only ownership stays numeric.
      let { sel, joins } = project(vocab, comp, opts.derived ?? {})
      for (
        let row of driver.query(select({
          cols: [as(col('entity', comp), '@id'), ...sel],
          from: table(comp),
          joins,
          where: among(col('entity', comp), each(owners)),
        }))
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

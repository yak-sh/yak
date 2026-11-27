// The death cascade, compiled. A reference property declares in the vocabulary
// what happens to it when the entity it points at is deleted — `cascade`
// deletes the row's owner too, `detach` sets the column to NULL, `release`
// deletes the row — and @yaks/graph decides all of it. What it needs from a
// storage backend is the answer to one question: given the entities this
// transaction deleted, which others are deleted with them, and which surviving
// rows have to drop a reference?
//
// Walked, that question is one read per rung of the chain, and another per soft
// reference property. Against a database across a network each of those is a
// round trip, so here it is a statement instead: a `with recursive` over the
// cascade columns, seeded with the entities named as deleted, that follows
// every reference backwards at once — a chain of any length in one query.
//
// A statement, but not necessarily one statement. Every backward term is a term
// of the same compound SELECT, and workerd limits a compound SELECT to five
// terms (./compound.ts). Each reference column has its own indexed term.
// Split the terms to fit the engine's compound SELECT and CTE cursor limits.
// A vocabulary {@link narrow} enough to fit in one statement is answered
// whole. A wider one is asked in rounds. Each statement is transitive within
// its own tables, so the caller re-asks with whatever the last round turned
// up until nothing new comes back.
//
// The depth count stops climbing where the walk would otherwise loop. A cycle
// among cascade properties (an entity that exists to describe an entity that
// exists to describe it) would increase the depth forever and never repeat a
// row, so the rung number saturates at {@link DEEP}: past that, a row already
// reached at that depth is a row the recursion has seen, and `union` drops it.
// The set of entities is complete at any depth — only the count stops.
//
// This lives in @yaks/sql because @yaks/sqlite and @yaks/d1 share one dialect
// and must not each write it; @yaks/graph never sees SQL at all, and a storage
// backend that cannot compile this (a map, a browser cache) is walked
// instead.

import type { Vocab } from '@yaks/vocab'
import { ARMS, cut } from './compound.ts'
import {
  among,
  and,
  as,
  at,
  call,
  col,
  cross,
  type Cte,
  eq,
  exists,
  fn,
  lit,
  not,
  oneOf,
  op,
  type Raw,
  raw,
  select,
  type Stmt,
  table,
  union,
  unionAll,
  val,
} from './ast.ts'
import { DEPTH, render as renderIn } from './render.ts'
import { field, indexName } from './sqlite.ts'

/** How far a cascade's rungs are counted before the number stops climbing.
 * Depth only decides the order the deleted entities come back in; it never
 * limits which ones are deleted. */
export let DEEP = 32

// The CTE's name, and the alias the entity table is read through. Both are
// named so that no component can collide with them — a vocabulary owns every
// ordinary name.
let W = '__doom'
let E = '__e'
let doomed = at(W)
let entity = at(E)
let owner = (comp: string) => col(comp == 'entity' ? 'id' : 'entity', comp)
let alive = (comp: string) =>
  not(exists(select({
    cols: [lit(1)],
    from: table('tombstone'),
    where: eq(col('entity', 'tombstone'), owner(comp)),
  })))

// SQLite 3.54.1 counts FROM sources again each time a CTE is named. The
// seed takes at most two cursors, and a recursive arm takes three (the
// worklist, component and tombstone). A soft-reference arm takes three of
// its own and names the worklist twice: once to seek referrers and once to
// exclude dead owners. Leave room for at least one such arm.
let softCost = (cascade: number): number => 3 + 2 * (1 + 2 + 3 * cascade)
let width = (terms: number, cursors: number): number =>
  Math.min(
    terms,
    Math.floor((cursors - 1 - softCost(0)) / (softCost(1) - softCost(0))),
  )

/** Whether the vocabulary's cascade fits in one statement. When it does,
 * {@link looseSql} can restate the closure, so both lookups can run together. */
export let narrow = (
  v: Vocab,
  terms: number = ARMS,
  cursors: number = DEPTH,
): boolean => v.deaths('cascade').length <= width(terms, cursors)

/** What a look at the file found it lacks of the vocabulary's schema (as
 * @yaks/sqlite's survey reports it): each component whose table it lacks, each
 * `comp.prop` whose column it lacks, and each declared index it lacks. A store
 * whose schema is still catching up to the code reading it lacks some. */
export type Lacks = {
  absent?: readonly string[]
  lacking?: readonly string[]
  unindexed?: readonly string[]
}

// What the terms are built over: the references whose column the file holds,
// and the indexes it holds. A reference the file has no column for points at
// nothing, and SQLite refuses a statement naming a column or forcing an index
// it lacks.
type Held = {
  v: Vocab
  deaths: (kind: 'cascade' | 'detach' | 'release') => [string, string][]
  index: (comp: string, prop: string) => string | undefined
}

// Each reference has its own seek. An OR over several columns lets stale
// small-table statistics replace all their indexes with a table scan.
let seek = (v: Vocab, comp: string, prop: string): string | undefined => {
  let index = v.indexes(comp).find((i) => i.props[0] == prop && !i.present)
  return index && indexName(v, comp, index.props)
}

let held = (v: Vocab, lacks: Lacks): Held => {
  let absent = new Set(lacks.absent)
  let lacking = new Set(lacks.lacking)
  let unindexed = new Set(lacks.unindexed)
  return {
    v,
    deaths: (kind) =>
      v.deaths(kind).filter(([c, p]) =>
        !absent.has(c) && !lacking.has(`${c}.${p}`)
      ),
    index: (comp, prop) => {
      let index = seek(v, comp, prop)
      return index && !unindexed.has(index) ? index : undefined
    },
  }
}

// What of `lacks` changes the terms, as a key: the references it leaves out
// and the seeks it cannot force.
let lackKey = (v: Vocab, lacks: Lacks): string => {
  let h = held(v, lacks)
  let kinds = ['cascade', 'detach', 'release'] as const
  return kinds.map((k) =>
    h.deaths(k).map(([c, p]) => `${c}.${p}=${h.index(c, p) ?? ''}`).join(',')
  ).join(';')
}

let seed = (eids: string[]): string =>
  eids.length == 1 ? eids[0] : JSON.stringify([...new Set(eids)])

let seeds = (eids: string[], recursive = false) =>
  select({
    cols: [col('id', 'entity'), ...(recursive ? [lit(0)] : [])],
    ...(eids.length == 1
      ? {
        from: table('entity'),
        where: oneOf(col('eid'), eids),
      }
      : {
        from: call('json_each', [val(seed(eids))], '__seeds'),
        joins: [cross(table('entity', undefined, 'sqlite_autoindex_entity_1'))],
        where: eq(col('eid', 'entity'), col('value', '__seeds')),
      }),
  })

let points = (comp: string, prop: string) =>
  eq(col(field(prop), comp), doomed('id'))

// UNION deduplicates and, together with the saturating depth, terminates.
let closure = (h: Held, eids: string[], group: [string, string][]): Cte => {
  let initial = seeds(eids, true)
  let steps = group.map(([comp, prop]) =>
    select({
      cols: [
        owner(comp),
        fn('min', op('+', doomed('depth'), lit(1)), lit(DEEP)),
      ],
      from: table(W),
      joins: [cross(table(comp, undefined, h.index(comp, prop)))],
      where: and(points(comp, prop), alive(comp)),
    })
  )
  return {
    name: W,
    cols: ['id', 'depth'],
    recursive: steps.length > 0,
    q: steps.length ? union(initial, ...steps) : initial,
  }
}

// The closure and reference terms depend on the vocabulary, what the file
// lacks of it and the engine's allowance, never on the identities seeded into
// them. Keep their SQL once for a single identity and for a JSON set,
// including the empty set. Each answer owns its statement and bindings; no
// caller can change a kept plan.
type Plan = Partial<Record<'doom' | 'loose', Raw[]>>
type Build = (h: Held, eids: string[], terms: number, cursors: number) => Raw[]

// Text written with the names `v` stores its words under (./render.ts).
let render = (n: Stmt, v: Vocab): Raw => renderIn(n, undefined, undefined, v)
let plans = new WeakMap<Vocab, Map<string, [Plan, Plan]>>()
let planned = (
  v: Vocab,
  eids: string[],
  terms: number,
  lacks: Lacks,
  cursors: number,
  kind: keyof Plan,
  build: Build,
): Raw[] => {
  let cache = plans.get(v)
  if (!cache) plans.set(v, cache = new Map())
  let whole = !lacks.absent?.length && !lacks.lacking?.length &&
    !lacks.unindexed?.length
  let key = `${terms}:${cursors}|${whole ? '' : lackKey(v, lacks)}`
  let forms = cache.get(key)
  if (!forms) cache.set(key, forms = [{}, {}])
  let one = eids.length == 1
  let plan = forms[one ? 0 : 1]
  let kept = plan[kind] ??= build(
    held(v, lacks),
    one ? [''] : [],
    terms,
    cursors,
  )
  if (!kept.length) return []
  let value = seed(eids)
  return kept.map((s) => raw(s.sql, [value, ...s.params.slice(1)], 'entity'))
}

/**
 * Everything deleted along with these entities, the named ones included: one row
 * per deleted entity, with the eid, the entity number, and the rung it was
 * reached on. Ordered by rung, and within a rung by the order the entities were
 * created in, which is the order the walk this replaces returned them in.
 *
 * One statement when the vocabulary is {@link narrow}, and otherwise one per
 * group of terms — each a complete closure over its own tables, to be re-asked
 * with what the others turned up until nothing new comes back.
 *
 * The statements read only what the file holds: `lacks` says what of the
 * vocabulary's schema it does not hold yet.
 */
export let doomSql = (
  v: Vocab,
  eids: string[],
  terms: number = ARMS,
  lacks: Lacks = {},
  cursors: number = DEPTH,
): Raw[] => planned(v, eids, terms, lacks, cursors, 'doom', doom)

let doom: Build = (h, eids, terms, cursors) =>
  cut(h.deaths('cascade'), width(terms, cursors)).map((group) =>
    render(
      select({
        with: [closure(h, eids, group)],
        cols: [
          entity('eid'),
          entity('num'),
          as(fn('min', doomed('depth')), 'depth'),
        ],
        from: table(W),
        joins: [{
          ...cross(table('entity', E)),
          on: eq(entity('id'), doomed('id')),
        }],
        group: [doomed('id')],
        order: [col('depth'), doomed('id')],
      }),
      h.v,
    )
  )

/**
 * Every soft reference into the closure of these entities: a surviving row's
 * `detach` or `release` property pointing at one of the deleted entities,
 * returned as (component, property, owner). Empty when the vocabulary declares
 * no soft reference at all.
 *
 * The closure is restated inside the statement when the vocabulary is
 * {@link narrow} — which is what lets this be sent in the same batch as
 * {@link doomSql}, before anyone has read either answer. When it is not, one
 * statement cannot express the closure, so what it is given is the set it
 * answers about: the caller passes a set that is already closed (the last
 * round's, which added nothing).
 *
 * Deleted entities are excluded on purpose — a deleted entity's own tombstone
 * already covers it, so only a surviving row is told to drop its reference.
 * `lacks` is as {@link doomSql} takes it.
 */
export let looseSql = (
  v: Vocab,
  eids: string[],
  terms: number = ARMS,
  lacks: Lacks = {},
  cursors: number = DEPTH,
): Raw[] => planned(v, eids, terms, lacks, cursors, 'loose', loose)

let loose: Build = (h, eids, terms, cursors) => {
  let cascade = narrow(h.v, terms, cursors) ? h.deaths('cascade') : []
  let head = cascade.length
    ? closure(h, eids, cascade)
    : { name: W, q: seeds(eids) }
  let soft = [...h.deaths('release'), ...h.deaths('detach')]
  let room = Math.min(
    terms,
    Math.floor((cursors - 1) / softCost(cascade.length)),
  )
  if (!soft.length) return []
  return cut(soft, room).map((group) => {
    let parts = group.map(([comp, prop]) =>
      select({
        distinct: true,
        cols: [
          as(val(comp), 'comp'),
          as(val(prop), 'prop'),
          entity('eid'),
          as(entity('id'), 'ord'),
        ],
        from: table(W),
        joins: [
          cross(table(comp, undefined, h.index(comp, prop))),
          { ...cross(table('entity', E)), on: eq(entity('id'), owner(comp)) },
        ],
        where: and(
          points(comp, prop),
          not(
            among(
              owner(comp),
              select({ cols: [doomed('id')], from: table(W) }),
            ),
          ),
          alive(comp),
        ),
      })
    )
    let query = parts.length == 1 ? parts[0] : unionAll(...parts)
    // The seed parameter must precede the component and property bindings.
    return render({ ...query, with: [head], order: [col('ord')] }, h.v)
  })
}

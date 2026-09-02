// Query-result components: declared indexed inputs, projection, and bounded
// invalidation for components that exist only in a query answer. The graph
// vocabulary remains the sole write contract; these values cannot ride /apply.
import type { Sql } from './store/sql.ts'
import type { Change } from './types.ts'
import { eager } from './db.ts'
import { materialize } from './persona.ts'
import { personaGraph } from './persona_graph.ts'
import { EXISTS, type Pred, type ResultComp, resultComps } from './query.ts'

export type ResultState = {
  comp: Record<string, unknown> | null
  depends: Set<string>
  meta?: unknown
}

type Declaration = {
  name: ResultComp
  inputs: Pred[]
  read: (db: Sql, eid: string, now: number) => ResultState
  dirty: (db: Sql, state: ResultState, batch: Change[]) => boolean
}

let materializedRead = (
  db: Sql,
  eid: string,
  now: number,
): ResultState => {
  let { all, deps } = personaGraph(db, [eid])
  let p = all.find((r) => r.eid == eid && r.comps.persona && r.comps.doc)
  if (!p) return { comp: null, depends: new Set([eid]) }
  let home = (p.comps.persona.home as string | null) ?? null
  // memory.scope is indexed. Joining the named facets keeps this result equal
  // to `.memory.scope=…` without routing through graph_query recursively.
  let scopeSql = home
    ? `select e.eid from entity s
         join memory m on m.scope = s.id
         join doc_value d on d.entity = m.entity
         join entity e on e.id = m.entity
         left join quarantined q on q.entity = m.entity
        where s.eid = ? and q.entity is null`
    : `select e.eid from memory m
         join doc_value d on d.entity = m.entity
         join entity e on e.id = m.entity
         left join quarantined q on q.entity = m.entity
        where m.scope is null and q.entity is null`
  let scoped = (db.prepare(scopeSql).all(...(home ? [home] : [])) as {
    eid: string
  }[]).map((r) => r.eid)
  return {
    comp: {
      text: materialize(all, deps, p, now),
      scoped,
    },
    depends: new Set([eid, ...all.map((r) => r.eid), ...scoped]),
    meta: { home },
  }
}

let materializedDirty = (
  db: Sql,
  state: ResultState,
  batch: Change[],
) => {
  let home = (state.meta as { home?: string | null } | undefined)?.home ?? null
  for (let c of batch) {
    if (c.name == 'dependency') {
      let type = c.comp?.type
      if (
        (type == 'contains' || type == 'reads') && state.depends.has(c.eid)
      ) return true
      continue
    }
    if (state.depends.has(c.eid)) {
      if (
        c.name == 'entity' || c.name == 'doc' || c.name == 'persona' ||
        c.name == 'memory' || c.name == 'recall' || c.name == 'feedback'
      ) return true
      continue
    }
    // A memory can enter the untiered scope without having been a prior input.
    // Inspect only the touched eid through eager's keyed read.
    if (c.name != 'doc' && c.name != 'memory') continue
    let comps = eager(db, c.eid)
    if (
      comps.doc && comps.memory &&
      ((comps.memory.scope as string | null) ?? null) == home
    ) return true
  }
  return false
}

// One component declaration, selected by its component name. This is not an
// application projector namespace: callers only speak ordinary component
// predicates, and the engine consumes the declaration internally.
let materialized: Declaration = {
  name: 'materialized',
  inputs: [
    { comp: 'persona', prop: '', op: EXISTS, value: '' },
    { comp: 'doc', prop: '', op: EXISTS, value: '' },
  ],
  read: materializedRead,
  dirty: materializedDirty,
}

let declaration = (name: ResultComp): Declaration => {
  if (name == materialized.name) return materialized
  throw new Error(`no declaration for query-result component: ${name}`)
}

export let isResultComp = (name: string): name is ResultComp =>
  name in resultComps

export let resultsOf = (preds: Pred[]): ResultComp[] => [
  ...new Set(
    preds.filter((p) => isResultComp(p.comp)).map((p) => p.comp as ResultComp),
  ),
]

// A result component's declared stored inputs are the indexed candidate set.
// The original predicate is applied after projection, so `.materialized!`
// remains an ordinary presence test over the finished row.
export let inputsOf = (preds: Pred[]): Pred[] => {
  let names = resultsOf(preds)
  if (!names.length) return preds
  for (let p of preds) {
    if (isResultComp(p.comp) && !p.prop && p.op != EXISTS) {
      throw new Error('query-result component absence is unbounded')
    }
  }
  return [
    ...preds.filter((p) => !isResultComp(p.comp)),
    ...names.flatMap((name) => declaration(name).inputs),
  ]
}

export let resultStates = (
  db: Sql,
  names: ResultComp[],
  eids: Iterable<string>,
  now = Date.now(),
) => {
  let out = new Map<string, Map<ResultComp, ResultState>>()
  for (let eid of eids) {
    let states = new Map<ResultComp, ResultState>()
    for (let name of names) {
      states.set(name, declaration(name).read(db, eid, now))
    }
    out.set(eid, states)
  }
  return out
}

export let withResults = <
  T extends {
    eid: string
    comps: Record<string, Record<string, unknown>>
  },
>(
  db: Sql,
  preds: Pred[],
  rows: T[],
  now = Date.now(),
): T[] => {
  let names = resultsOf(preds)
  if (!names.length) return rows
  let states = resultStates(db, names, rows.map((r) => r.eid), now)
  return rows.map((r) => {
    let comps = { ...r.comps }
    for (let [name, state] of states.get(r.eid) ?? []) {
      if (state.comp) comps[name] = state.comp
    }
    return { ...r, comps }
  })
}

export let resultDirty = (
  db: Sql,
  name: ResultComp,
  state: ResultState,
  batch: Change[],
) => declaration(name).dirty(db, state, batch)

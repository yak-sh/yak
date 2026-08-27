// Derived query projections: transient values computed beside ordinary query
// membership. This module is the one registry seam for projector names,
// bounded reads, and dependency-based subscription invalidation. A projector's
// value never becomes a graph component and can never ride /apply.
import type { DatabaseSync } from './sqlite.ts'
import type { Change } from './types.ts'
import { eager } from './db.ts'
import { evalGraph, personaGraph } from './graph_query.ts'
import { materialize } from './persona.ts'
import type { Derivation } from './query.ts'

export type PersonaProjection = { text: string; scoped: string[] }
export type Derived = Partial<Record<Derivation, unknown>>

export type DerivedState = {
  value: unknown
  depends: Set<string>
  meta?: unknown
}

type Projector = {
  read: (db: DatabaseSync, eid: string, now: number) => DerivedState
  dirty: (
    db: DatabaseSync,
    state: DerivedState,
    batch: Change[],
  ) => boolean
}

let personaRead = (
  db: DatabaseSync,
  eid: string,
  now: number,
): DerivedState => {
  let { all, deps } = personaGraph(db, [eid])
  let p = all.find((r) => r.eid == eid && r.comps.persona && r.comps.doc)
  if (!p) return { value: null, depends: new Set([eid]) }
  let home = (p.comps.persona.home as string | null) ?? null
  let scoped = evalGraph(
    db,
    home ? `.memory.scope=${home}` : '.memory.scope=',
  ).hits
    .filter((r) => r.comps.memory && r.comps.doc)
    .map((r) => r.eid)
  return {
    value: {
      text: materialize(all, deps, p, now),
      scoped,
    } satisfies PersonaProjection,
    depends: new Set([eid, ...all.map((r) => r.eid), ...scoped]),
    meta: { home },
  }
}

let personaDirty = (
  db: DatabaseSync,
  state: DerivedState,
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
    // A memory can ENTER this persona's untiered scope without having been a
    // prior dependency. Inspect only the touched eid through eager's keyed
    // read; an unrelated graph row never expands into a scan.
    if (c.name != 'doc' && c.name != 'memory') continue
    let comps = eager(db, c.eid)
    if (
      comps.doc && comps.memory &&
      ((comps.memory.scope as string | null) ?? null) == home
    ) return true
  }
  return false
}

let projectors: Record<Derivation, Projector> = {
  persona: { read: personaRead, dirty: personaDirty },
}

export let derive = (
  db: DatabaseSync,
  names: Derivation[],
  eids: Iterable<string>,
  now = Date.now(),
) => {
  let out = new Map<string, Map<Derivation, DerivedState>>()
  for (let eid of eids) {
    let values = new Map<Derivation, DerivedState>()
    for (let name of names) {
      values.set(name, projectors[name].read(db, eid, now))
    }
    out.set(eid, values)
  }
  return out
}

export let derivedValues = (
  states: Map<string, Map<Derivation, DerivedState>>,
): Record<string, Derived> =>
  Object.fromEntries(
    [...states].map(([eid, values]) => [
      eid,
      Object.fromEntries(
        [...values].map(([name, state]) => [name, state.value]),
      ),
    ]),
  )

export let deriveDirty = (
  db: DatabaseSync,
  name: Derivation,
  state: DerivedState,
  batch: Change[],
) => projectors[name].dirty(db, state, batch)

// The persona graph read: bounded, level-batched closures over persona tier
// edges. Persona materialization and fleet projection share this indexed input
// boundary so neither query nor daemon callers ever need a graph snapshot.
import type { Sql } from './store/sql.ts'
import { depsOf, rowsOf } from './db.ts'
import { type Dep, kindOf, sessionOf } from './types.ts'
import type { Row } from './client.ts'

// A persona plus every row it reaches through outgoing contains/reads edges.
// The walk is batched per level: one rowsOf + one depsOf per BFS generation,
// not one statement bundle per tier member.
export let personaGraph = (
  db: Sql,
  roots: string[],
): { all: Row[]; deps: Dep[] } => {
  let all = new Map<string, Row>()
  let deps: Dep[] = []
  let seenDep = new Set<string>()
  let seen = new Set<string>()
  let absorb = (eids: string[]) => {
    for (let r of rowsOf(db, eids)) {
      if (!r.comps.entity) continue
      let session = sessionOf(r.comps)
      if (session) r.comps.session = session
      all.set(r.eid, {
        eid: r.eid,
        num: Number(r.comps.entity.num ?? 0),
        kind: kindOf(r.comps),
        comps: r.comps,
      })
    }
  }
  let frontier = [...new Set(roots.filter(Boolean))]
  while (frontier.length) {
    for (let e of frontier) seen.add(e)
    let level = new Set(frontier)
    absorb(frontier)
    let next = new Set<string>()
    for (let d of depsOf(db, frontier)) {
      if (!level.has(d.parent)) continue
      if (d.type != 'contains' && d.type != 'reads') continue
      let key = `${d.parent}\0${d.type}\0${d.child}`
      if (!seenDep.has(key)) {
        seenDep.add(key)
        deps.push(d)
      }
      if (!seen.has(d.child)) next.add(d.child)
    }
    frontier = [...next]
  }
  // The standing goals ride every rendered persona (M-31946 §5) yet hang off
  // no persona edge, so they join the universe by their own table, not the
  // walk. Few by design; titles only are read.
  let goals = (db.prepare(
    `select o.eid as eid from goal t join entity o on o.id = t.entity`,
  ).all() as { eid: string }[]).map((r) => r.eid).filter((e) => !all.has(e))
  absorb(goals)
  // A persona is COMMON because a PROJECT contains it — an edge that points AT
  // the persona, which a downward walk never sees. A render rooted on one
  // persona has to know it anyway: without it the renderer reads every direct
  // member as identity, so a spawn's prompt ordered its documentation and its
  // rules as if they were who the agent is. The containing project joins the
  // universe with that edge; a parent that is not a project is dropped again,
  // so the walk stays bounded by what the render actually asks.
  let up = depsOf(
    db,
    [...all.values()].filter((r) => r.comps.persona).map(
      (r) => r.eid,
    ),
  ).filter((d) =>
    d.type == 'contains' && all.has(d.child) && !all.has(d.parent)
  )
  let parents = [...new Set(up.map((d) => d.parent))]
  absorb(parents)
  for (let e of parents) if (!all.get(e)?.comps.project) all.delete(e)
  for (let d of up) {
    if (!all.has(d.parent)) continue
    let key = `${d.parent}\0${d.type}\0${d.child}`
    if (seenDep.has(key)) continue
    seenDep.add(key)
    deps.push(d)
  }
  // A memory's `feedback.by` names who gave the correction — a reference, not
  // an edge, so the walk above never reaches it. The renderer sorts the
  // OWNER's direction ahead of the working rules and asks that author whether
  // it is a person, so the authors join the universe the way the goals do.
  let authors = [
    ...new Set(
      [...all.values()]
        .map((r) => r.comps.feedback?.by)
        .filter((e): e is string => !!e),
    ),
  ].filter((e) => !all.has(e))
  absorb(authors)
  return { all: [...all.values()], deps }
}

// Every persona and project is a bounded indexed root set, then the same tier
// closure above. This is the daemon-side projection universe.
export let projectionGraph = (db: Sql) => {
  let roots = (db.prepare(
    `select o.eid as eid from persona t join entity o on o.id = t.entity
     union
     select o.eid from project t join entity o on o.id = t.entity`,
  ).all() as { eid: string }[]).map((r) => r.eid)
  return personaGraph(db, roots)
}

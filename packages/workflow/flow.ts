// A workflow as a person reads it: its map, laid out in stages, and its cases
// moving through. Pure: a host reads the rows (the steps the workflow
// contains, their `requires` edges, its cases, the rows made for them and the
// results answering their calls) and hands them here.
//
// Where a case is follows from what was made for it: the steps it reached
// (they made a row for it) that no step it reached follows, and any step
// whose call or task for it is still open. It is done when nothing holds it
// and nothing follows where it stands.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { CASE, type Feed, feeds, type Mapped } from './map.ts'

/** A step on the map: its eid, its name and the steps that feed it. */
export type Placed = { eid: Eid; title: string; after: Eid[] }

/** One case, read: the item it is for, what each step made for it and which
 * of those rows are outdated, the steps it stands at, the open calls and tasks
 * holding it, and whether it is done. */
export type Read = {
  eid: Eid
  item: Eid
  made: Record<Eid, Bundle[]>
  outdated: Eid[]
  at: Eid[]
  held: Bundle[]
  done: boolean
}

/** What a step has: the cases not done standing at it, the cases it made
 * rows for, and how many of its rows are outdated. */
export type Count = { at: number; made: number; outdated: number }

/** A workflow read whole. */
export type Flow = {
  stages: Placed[][]
  feeds: Feed[]
  cases: Read[]
  counts: Record<Eid, Count>
}

/** The rows a flow is read from. */
export type Rows = {
  /** the step rows the workflow contains */
  steps: Bundle[]
  /** `requires` edges, from a step to a step it waits for */
  requires?: Bundle[]
  /** its cases, in the order they are listed */
  cases?: Bundle[]
  /** the rows made for them, each carrying `made{case, step}` */
  made?: Bundle[]
  /** the results answering calls among them */
  results?: Bundle[]
  /** the rows made before their step's last edit */
  outdated?: Eid[]
}

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''

/** A step's name: its title, else its match. */
/// named({ entity: { eid: 's' }, step: { match: '$o .order' } }) -> '$o .order'
export let named = (b: Bundle): string =>
  str(comp(b, 'doc').title) || str(comp(b, 'step').match) || b.entity.eid

/** Whether a row holds its case: a call nothing answered yet, or a task not
 * completed or cancelled. */
export let open = (b: Bundle, answered: Set<Eid>): boolean =>
  b.call
    ? !answered.has(b.entity.eid)
    : !!b.task && !b.completed && !b.cancelled

// Steps in stages: the first those nothing feeds, each later one those whose
// feeders all stand in the stages before. Steps feeding each other in a loop
// make a last stage, so every step is drawn.
let layer = (ids: Eid[], into: Map<Eid, Eid[]>): Eid[][] => {
  let stages: Eid[][] = [], placed = new Set<Eid>()
  let left = ids
  while (left.length) {
    let ready = left.filter((s) => into.get(s)!.every((f) => placed.has(f)))
    if (!ready.length) ready = left
    stages.push(ready)
    for (let s of ready) placed.add(s)
    left = left.filter((s) => !placed.has(s))
  }
  return stages
}

/**
 * The workflow `rows` hold, read: its map in stages and its cases, each with
 * where it stands. `vocab` lets a reference a step's match follows say what it
 * needs (`feeds`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { flow } from '@yaks/workflow'
 *
 * let step = (eid: string, match: string, write: object[]) =>
 *   ({ entity: { eid }, step: { match, write } })
 * let read = flow({
 *   steps: [
 *     step('pack', '$o .order', [{ entity: { eid: '$t' }, task: {} }]),
 *     step('ship', '$t .task .completed', [{ entity: { eid: '$s' }, shipped: {} }]),
 *   ],
 *   cases: [{ entity: { eid: 'c1' }, workflow_case: { workflow: 'w', for: 'o1' } }],
 *   made: [{ entity: { eid: 't1' }, task: {}, made: { case: 'c1', step: 'pack' } }],
 * })
 * equal(read.stages.map((s) => s.map((p) => p.eid)), [['pack'], ['ship']])
 * equal(read.cases[0].at, ['pack'])
 * equal(read.cases[0].held.map((b) => b.entity.eid), ['t1'])
 * equal(read.counts.pack, { at: 1, made: 1, outdated: 0 })
 * ```
 */
export let flow = (rows: Rows, vocab?: Vocab): Flow => {
  let ids = rows.steps.map((b) => b.entity.eid)
  let within = new Set(ids)
  let waits = new Map(ids.map((s) => [s, [] as Eid[]]))
  for (let e of rows.requires ?? []) {
    let { from, to } = comp(e, 'edge') as { from?: Eid; to?: Eid }
    if (from && to && within.has(from) && within.has(to)) {
      waits.get(from)!.push(to)
    }
  }
  let mapped: Mapped[] = rows.steps.map((b) => ({
    eid: b.entity.eid,
    match: str(comp(b, 'step').match),
    write: (comp(b, 'step').write ?? []) as Bundle[],
    requires: waits.get(b.entity.eid),
  }))
  let fed = feeds(mapped, vocab).filter((f) => within.has(f.from))
  let into = new Map(ids.map((s) => [s, [] as Eid[]]))
  let next = new Map(ids.map((s) => [s, [] as Eid[]]))
  for (let f of fed) {
    if (!into.get(f.to)!.includes(f.from)) into.get(f.to)!.push(f.from)
    if (!next.get(f.from)!.includes(f.to)) next.get(f.from)!.push(f.to)
  }
  let titles = new Map(rows.steps.map((b) => [b.entity.eid, named(b)]))
  let stages = layer(ids, into).map((stage) =>
    stage.map((eid) => ({
      eid,
      title: titles.get(eid)!,
      after: into.get(eid)!,
    }))
  )

  let answered = new Set(
    (rows.results ?? []).map((r) => str(comp(r, 'result').call)),
  )
  let byCase = new Map<Eid, Bundle[]>()
  for (let b of rows.made ?? []) {
    let c = str(comp(b, 'made').case)
    byCase.set(c, [...byCase.get(c) ?? [], b])
  }
  let stale = new Set(rows.outdated ?? [])
  let counts: Record<Eid, Count> = Object.fromEntries(
    ids.map((s) => [s, { at: 0, made: 0, outdated: 0 }]),
  )
  for (let b of rows.made ?? []) {
    let s = str(comp(b, 'made').step)
    if (counts[s] && stale.has(b.entity.eid)) counts[s].outdated++
  }

  let cases = (rows.cases ?? []).map((b): Read => {
    let eid = b.entity.eid
    let made: Record<Eid, Bundle[]> = {}
    for (let row of byCase.get(eid) ?? []) {
      let s = str(comp(row, 'made').step)
      ;(made[s] ??= []).push(row)
    }
    let held = (byCase.get(eid) ?? []).filter((r) => open(r, answered))
    let holding = new Set(held.map((r) => str(comp(r, 'made').step)))
    let reached = ids.filter((s) => made[s])
    let at = reached.filter((s) =>
      holding.has(s) || !next.get(s)!.some((n) => made[n])
    )
    let done = !!at.length && !held.length &&
      at.every((s) => !next.get(s)!.length)
    for (let s of reached) counts[s].made++
    if (!done) { for (let s of at) counts[s].at++ }
    let old = (byCase.get(eid) ?? []).map((r) => r.entity.eid)
      .filter((r) => stale.has(r))
    let item = str(comp(b, CASE).for)
    return { eid, item, made, outdated: old, at, held, done }
  })
  return { stages, feeds: fed, cases, counts }
}

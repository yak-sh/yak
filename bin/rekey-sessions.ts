#!/usr/bin/env -S deno run -A
// One-time: every session a harness knows by a uuid moves to that uuid as its
// eid, and every subagent's session an older harness wrote under its agent id
// moves to the eid its transcript is read into now (@yaks/session who.ts
// `sessionEid`). References are rows (`entity.id`), so entries, claims, stamps,
// edges and the journal follow a move on their own. What does not follow is an
// eid derived from a moved one: an imported entry's (its session, its line and
// its place in it), an imported call's (its session and the harness's id for
// it), and an edge's (its ends and its relation). Each moves with it, where it
// is the eid that derivation gives; one an older importer named otherwise
// stays.
//
// A managed run keeps its eid: it was written before its harness knew the id.
// A move onto an eid a live entity holds is not made; a dead one (a tombstone)
// is renamed out of the way. Where the entity in the way is a session that
// moves too, the next run makes the move it held, so run it until it writes
// nothing.
//
// Hold the server down while the move runs: its importer holds sessions' eids.
// `--undo <file>` writes each row's old and new eid, tab separated.
//
//   deno run -A bin/rekey-sessions.ts <config> [--write] [--undo <file>]

import { DatabaseSync } from 'node:sqlite'
import { derivedEid, type Eid } from '@yaks/graph'
import { edgeEid, names } from '@yaks/edge'
import { sessionEid } from '@yaks/session'
import {
  among,
  and,
  col,
  eq,
  exists,
  join,
  left,
  not,
  notNull,
  render,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import { read } from '../packages/cli/config.ts'
import { words } from '../packages/cli/host.ts'
import { callOf } from '../packages/session/tail.ts'
import { claudeProjects, transcripts } from '../packages/session/service.ts'

let [path, ...flags] = Deno.args
let write = flags.includes('--write')
let undo = flags.includes('--undo') ? flags[flags.indexOf('--undo') + 1] : ''
let config = read(path)
let { vocab } = await words(config)
let db = new DatabaseSync(config.db!, { timeout: 5000 })
type Row = Record<string, unknown>
let run = (s: Stmt): Row[] => {
  let r = render(s)
  return db.prepare(r.sql).all(...r.params as (string | number)[]) as Row[]
}
let str = (v: unknown) => v == null ? '' : String(v)
let chunks = <T>(xs: T[], n = 500): T[][] =>
  Array.from(
    { length: Math.ceil(xs.length / n) },
    (_, i) => xs.slice(i * n, i * n + n),
  )
// Each chunk's rows of a query over a list of values.
let each = (xs: unknown[], q: (part: ReturnType<typeof val>[]) => Stmt) =>
  chunks(xs).flatMap((part) => run(q(part.map((x) => val(x as number)))))

// Each row's eid, as it stands.
let eids = new Map<number, Eid>()
let know = (rows: number[]) => {
  let owed = [...new Set(rows)].filter((row) => !eids.has(row))
  for (
    let r of each(owed, (part) =>
      select({
        cols: [col('id'), col('eid')],
        from: table('entity'),
        where: among(col('id'), part),
      }))
  ) eids.set(Number(r.id), str(r.eid))
}

// Planned moves, row → its new eid, less those a live entity stands in the
// way of; a dead one is renamed away. Answers how many were held.
let retired = new Map<number, Eid>()
let clear = (planned: Map<number, Eid>): number => {
  let at = new Map(
    each([...planned.values()], (part) =>
      select({
        cols: [col('id'), col('eid')],
        from: table('entity'),
        where: among(col('eid'), part),
      })).map((r) => [str(r.eid), Number(r.id)]),
  )
  let dead = new Set(
    each([...at.values()], (part) =>
      select({
        cols: [col('entity')],
        from: table('tombstone'),
        where: among(col('entity'), part),
      })).map((r) => Number(r.entity)),
  )
  let held = 0
  for (let [row, to] of planned) {
    let occupant = at.get(to)
    if (occupant == null || occupant == row) continue
    if (dead.has(occupant)) retired.set(occupant, derivedEid(`retired|${to}`))
    else {
      planned.delete(row)
      held++
    }
  }
  return held
}

// Sessions a harness knows by a uuid, but for managed runs.
let managed = new Set(
  run(select({
    distinct: true,
    cols: [col('session', 'n')],
    from: table('entry', 'n'),
    joins: [
      join(table('using', 'u'), eq(col('entity', 'u'), col('entity', 'n'))),
    ],
    where: and(
      notNull(col('provider', 'u')),
      not(exists(select({
        from: table('imported', 'i'),
        where: eq(col('entity', 'i'), col('entity', 'n')),
      }))),
    ),
  })).map((r) => Number(r.session)),
)
let sessions = new Map<number, Eid>()
let byHarness = new Map<string, number>()
for (
  let r of run(select({
    cols: [col('entity', 's'), col('eid', 'e'), col('id', 's')],
    from: table('session', 's'),
    joins: [join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 's')))],
    where: notNull(col('id', 's')),
  }))
) {
  let row = Number(r.entity)
  let [eid, id] = [str(r.eid), str(r.id)]
  eids.set(row, eid)
  byHarness.set(id, row)
  if (sessionEid(id) == id && id != eid && !managed.has(row)) {
    sessions.set(row, id)
  }
}
let uuids = sessions.size

// Subagents' sessions an older harness wrote under the agent id, whose
// transcript is on disk.
for (let f of transcripts(claudeProjects()!)) {
  let row = f.parent ? byHarness.get(f.id) : undefined
  let to = f.parent && sessionEid(f.id, f.parent)
  if (row != null && to && eids.get(row) != to) sessions.set(row, to)
}
let shells = sessions.size - uuids
let sessionsHeld = clear(sessions)

// What an imported entry or call of a moved session derives from it.
let derived = new Map<number, Eid>()
let calls = 0, entries = 0, named = 0
for (
  let r of each([...sessions.keys()], (part) =>
    select({
      cols: [
        col('entity', 'n'),
        col('session', 'n'),
        col('eid', 'e'),
        col('line', 'i'),
        col('source', 'i'),
        col('id', 'c'),
      ],
      from: table('entry', 'n'),
      joins: [
        join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'n'))),
        join(
          table('imported', 'i'),
          eq(col('entity', 'i'), col('entity', 'n')),
        ),
        left(table('call', 'c'), eq(col('entity', 'c'), col('entity', 'n'))),
      ],
      where: among(col('session', 'n'), part),
    }))
) {
  let row = Number(r.entity)
  let session = Number(r.session)
  let [from, to] = [eids.get(session)!, sessions.get(session)!]
  let eid = str(r.eid)
  eids.set(row, eid)
  if (r.id != null) {
    if (eid == callOf(from, str(r.id))) {
      derived.set(row, callOf(to, str(r.id)))
      calls++
    } else named++
    continue
  }
  let line = Number(r.line)
  let found = [[from, to], [`${from} ${r.source}`, `${to} ${r.source}`]]
    .flatMap(([a, b]) =>
      Array.from({ length: 16 }, (_, i) => i)
        .filter((i) => derivedEid(`${a} ${line} ${i}`) == eid)
        .map((i) => derivedEid(`${b} ${line} ${i}`))
    )[0]
  if (found) {
    derived.set(row, found)
    entries++
  } else named++
}
let derivedHeld = clear(derived)
let moves = new Map([...sessions, ...derived])

// Edges with a moved end.
let tags = new Map<number, string>()
for (let tag of Object.keys(names(vocab))) {
  for (let r of run(select({ cols: [col('entity')], from: table(tag) }))) {
    tags.set(Number(r.entity), tag)
  }
}
let ends = run(select({
  cols: [col('entity'), col('from'), col('to')],
  from: table('edge'),
})).map((r) => [r.entity, r.from, r.to].map(Number))
  .filter(([, from, to]) => moves.has(from) || moves.has(to))
know(ends.flat())
let now = (row: number) => moves.get(row) ?? eids.get(row)!
let linked = new Map<number, Eid>()
let loose = 0
for (let [row, from, to] of ends) {
  let tag = tags.get(row)
  if (tag && eids.get(row) == edgeEid(eids.get(from)!, tag, eids.get(to)!)) {
    linked.set(row, edgeEid(now(from), tag, now(to)))
  } else loose++
}
let edgesHeld = clear(linked)
for (let [row, to] of linked) moves.set(row, to)

// Nothing moves onto an eid another move frees.
let freed = new Set([...moves.keys()].map((row) => eids.get(row)))
let clash = [...moves.values()].filter((to) => freed.has(to))
if (clash.length) throw new Error(`moves collide: ${clash.slice(0, 5)}`)

console.log(
  `sessions: ${uuids} known by a uuid and ${shells} subagents' move, ` +
    `${sessionsHeld} of them held by a live entity\n` +
    `with them: ${entries} entries, ${calls} calls, ${linked.size} edges ` +
    `(held: ${derivedHeld} entries and calls, ${edgesHeld} edges; ` +
    `named otherwise, and staying: ${named} entries and calls, ` +
    `${loose} edges)\n` +
    `renamed away: ${retired.size} dead entities`,
)

know([...retired.keys()])
if (undo) {
  Deno.writeTextFileSync(
    undo,
    [...retired, ...moves].map(([row, to]) =>
      `${row}\t${eids.get(row)}\t${to}\n`
    )
      .join(''),
  )
}

if (write) {
  let started = performance.now()
  let set = (row: number, eid: Eid) =>
    run({
      t: 'update',
      table: 'entity',
      set: { eid: val(eid) },
      where: eq(col('id'), val(row)),
    })
  run({ t: 'begin', mode: 'immediate' })
  try {
    for (let [row, eid] of retired) set(row, eid)
    for (let [row, eid] of moves) set(row, eid)
    run({ t: 'commit' })
  } catch (e) {
    run({ t: 'rollback' })
    throw e
  }
  let ms = Math.round(performance.now() - started)
  // Read back: every row stands where it was moved to.
  eids.clear()
  know([...moves.keys(), ...retired.keys()])
  let wrong = [...retired, ...moves].filter(([row, to]) => eids.get(row) != to)
  console.log(
    `wrote ${moves.size + retired.size} eids in ${ms}ms; ${wrong.length} ` +
      'read back otherwise',
  )
}
db.close()

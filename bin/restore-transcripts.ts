#!/usr/bin/env -S deno run -A
// One-time (T-39629): the entries the transcript migration deleted by mistake
// come back under their own eids, and every session learns how far its log has
// been read.
//
// The migration (bin/reimport-transcripts.ts, run and gone) lost the session
// duty's lease partway through, and the new importer read logs in while the
// migration was still emptying their sessions; a later run of the migration
// deleted what it had read. Then the session duty's strip, whose `!content`
// read as a property of the same name until be61330e, deleted the prose of the
// quiet sessions read in since. An imported entry's eid is derived from its
// session and line, storage never writes to a deleted eid again, and an
// imported entry carries no number, so the eid is its whole identity: the
// importer has passed over those lines ever since, and restoring the eid
// restores the entry.
//
// For each session that lost entries, the log is read again and the entries it
// holds and the ones it lost are put in the log's order. The held ones' `seq`
// moves to that order beneath the graph (apply never moves a `seq`), the lost
// ones' tombstones are cleared, and they are written in again through apply at
// the positions between: dated by their line, signed where a person typed them.
// A tombstone is below every interface storage offers, so this one-time script
// clears it with a statement built by @yaks/sql, on its own connection.
//
// Every session that holds imported entries first gets `session.consumed`, the
// highest line it holds, which is where the importer now resumes. The script
// holds the session duty's lease throughout, and @yaks/spawn's while it writes
// those, so neither importer reads a log meanwhile. Start it, then restart the
// server. Each write leaves the lock free as long as it held it.
//
//   deno run -A bin/restore-transcripts.ts <config> [--write]

import { DatabaseSync } from 'node:sqlite'
import { type Bundle, type Eid, TOMBSTONE } from '@yaks/graph'
import { holding } from '@yaks/effects'
import {
  among,
  col,
  ge,
  render,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import { claude } from '@yaks/session'
import { read } from '../packages/cli/config.ts'
import { close, opened } from '../packages/cli/local.ts'
import { sessionFor } from '../packages/session/who.ts'
import { imported } from '../packages/session/tail.ts'
import {
  claudeProjects,
  type Found,
  managed,
  transcripts,
} from '../packages/session/service.ts'

// Where the deletes began: the migration's first run. Every derived eid a log
// makes that was deleted since is restored, and one whose tombstone a stopped
// run of this script cleared, which stands bare.
let FROM = '2026-09-25T23:17:00Z'
let OFFSET = 1_000_000_000

let [path, ...flags] = Deno.args
let write = flags.includes('--write')
let host = await opened(path, ['graph'], false)
let g = host.graph
let said = host.config.person
let person = said && ((await g.address([said])).get(said) ?? said) as Eid
let db = new DatabaseSync(read(path).db!, { timeout: 5000 })
let prepared = (s: Stmt) => {
  let r = render(s)
  return [db.prepare(r.sql), r.params as (string | number)[]] as const
}
let rows = (s: Stmt) => {
  let [st, params] = prepared(s)
  return st.all(...params)
}
let exec = (s: Stmt) => {
  let [st, params] = prepared(s)
  st.run(...params)
}

let nap = (ms: number) => new Promise((go) => setTimeout(go, ms))

// A write, tried again while another process holds the lock past the busy
// timeout (a server opening the file analyzes it), then the lock left free as
// long as the write held it.
let paced = async <T>(work: () => T | Promise<T>): Promise<T> => {
  for (let tries = 1;; tries++) {
    let t = performance.now()
    try {
      let out = await work()
      await nap(performance.now() - t)
      return out
    } catch (e) {
      if (tries == 10 || !String(e).includes('database is locked')) throw e
      console.log(`locked, again (${tries})`)
      await nap(2000)
    }
  }
}

// The entities among these that stand bare: an identity with no components,
// neither held nor deleted.
let bare = async (eids: Eid[]): Promise<Eid[]> =>
  eids.length
    ? (await g.get(eids))
      .filter((r) => r && r[TOMBSTONE] == null && Object.keys(r).length == 1)
      .map((r) => r!.entity.eid)
    : []

// Every eid the migration deleted.
let lost = new Set(
  rows(select({
    cols: [col('eid')],
    from: table('entity'),
    where: among(
      col('id'),
      select({
        cols: [col('entity')],
        from: table('tombstone'),
        where: ge(col('deleted_at'), val(FROM)),
      }),
    ),
  })).map((r) => String(r.eid)),
)

// One log as it stands: its complete lines, and the bundles each one makes.
type Line = { line: number; at?: string; bundles: Bundle[] }
let logOf = (session: Eid, source: string) => {
  let parts = Deno.readTextFileSync(source).split('\n').slice(0, -1)
  let lines: Line[] = parts.flatMap((text, i) => {
    let event
    try {
      event = JSON.parse(text)
    } catch {
      return []
    }
    if (!event || typeof event != 'object') return []
    let said = claude(event)
    if (!said.entries.length) return []
    let line = i + 1
    return [{
      line,
      at: said.at,
      bundles: imported(said, { session, source, line, person }),
    }]
  })
  return { count: parts.length, lines }
}

// The entries a log makes, in its order.
let orderOf = (lines: Line[]): Eid[] => [
  ...new Set(
    lines.flatMap((l) =>
      l.bundles.filter((b) => b.entry).map((b) => b.entity.eid)
    ),
  ),
]

// The held entries a log does not place: a session holding one cannot be put
// in the log's order, and is left as it stands.
let astray = (order: Eid[], held: Bundle[]) => {
  let place = new Set(order)
  return held.filter((b) => !place.has(b.entity.eid))
}

// The sessions to restore, each read from one log. A harness id can name two
// logs (a session that moved into a worktree writes on under a second project
// directory), and both feed one session whose entry ids collide line for line:
// no order of one log places them, so such a session is left as it stands.
let logs = new Map<Eid, Found[]>()
for (let f of transcripts(claudeProjects()!)) {
  let s = await sessionFor(g, f.id)
  if (!s || await managed(g, s.entity.eid)) continue
  logs.set(s.entity.eid, [...logs.get(s.entity.eid) ?? [], f])
}
let affected: (Found & { session: Eid })[] = []
let found = new Set<Eid>()
let shared = new Set<Eid>()
let t = performance.now()
for (let [session, files] of logs) {
  let orders = files.map((f) => orderOf(logOf(session, f.path).lines))
  let held = await g.read(`.entry.session=${session}&?entry`)
  let kept = new Set(held.map((b) => b.entity.eid))
  let orphans = await bare(
    orders.flat().filter((e) => !lost.has(e) && !kept.has(e)),
  )
  orphans.forEach((e) => lost.add(e))
  let here = orders.flat().filter((e) => lost.has(e))
  if (!here.length) continue
  if (files.length > 1) {
    here.forEach((e) => shared.add(e))
    console.log(`${session}: two logs, ${new Set(here).size} lost, left`)
    continue
  }
  here.forEach((e) => found.add(e))
  affected.push({ ...files[0], session })
  if (orphans.length) console.log(`${session}: ${orphans.length} bare`)
  let off = astray(orders[0], held).length
  if (off) console.log(`${session}: ${off} held entries the log does not place`)
}
console.log(
  `${found.size} lost entries in ${affected.length} sessions to restore, and ${shared.size} in sessions two logs feed; ${lost.size} eids the migration deleted; read in ${
    Math.round(performance.now() - t)
  }ms`,
)

// Where a session resumes: its highest imported line.
let backfill = async (skip: Set<Eid>) => {
  let sessions = (await g.rows('.imported&.tally=entry.session'))
    .map((r) => String(r.value)).filter((s) => s && !skip.has(s))
  for (let session of sessions) {
    let [last] = await g.read(
      `.imported&.entry.session=${session}&.order=-imported.line&.limit=1`,
    )
    let line = Number((last?.imported as { line?: number })?.line ?? 0)
    await paced(() =>
      g.apply([{ entity: { eid: session }, session: { consumed: line } }], {
        trusted: true,
      })
    )
  }
  console.log(`read positions for ${sessions.length} sessions`)
}

let restore = async (f: Found & { session: Eid }): Promise<number> => {
  let { session } = f
  let log = logOf(session, f.path)
  let order = orderOf(log.lines)
  let held = await g.read(`.entry.session=${session}&?entry`)
  if (astray(order, held).length) return 0
  let keep = new Set(held.map((b) => b.entity.eid))
  let seq = new Map(
    order.filter((e) => lost.has(e) || keep.has(e)).map((e, i) => [e, i + 1]),
  )
  // The held entries to their places in the log's order, by way of places
  // none of them holds.
  let moved = held.filter((b) =>
    (b.entry as { seq: number }).seq != seq.get(b.entity.eid)
  )
  let to = (n: number) =>
    moved.map((b) => ({
      entity: b.entity,
      entry: { session, seq: n + seq.get(b.entity.eid)! },
    }))
  await paced(() =>
    g.storage.tx((tx) => {
      tx.patch(to(OFFSET))
      tx.patch(to(0))
    })
  )
  // The lost ones' tombstones, and then the lost ones, a line at a time.
  let here = order.filter((e) => lost.has(e))
  for (let i = 0; i < here.length; i += 500) {
    await paced(() =>
      exec({
        t: 'delete',
        from: 'tombstone',
        where: among(
          col('entity'),
          select({
            cols: [col('id')],
            from: table('entity'),
            where: among(col('eid'), here.slice(i, i + 500).map(val)),
          }),
        ),
      })
    )
  }
  let tools = new Set<Eid>()
  let n = 0
  for (let l of log.lines) {
    let back = l.bundles.some((b) => b.entry && lost.has(b.entity.eid))
    let out: Bundle[] = []
    for (let b of l.bundles) {
      if (b.entry) {
        if (!lost.has(b.entity.eid)) continue
        out.push({ ...b, entry: { session, seq: seq.get(b.entity.eid) } })
        n++
      } else if (b.tool && back && !tools.has(b.entity.eid)) {
        tools.add(b.entity.eid)
        let [row] = await g.get([b.entity.eid])
        if (!row?.tool) out.push(b)
      } else if (b.execution && (back || lost.has(b.entity.eid))) {
        // An answer's state, where its call stands (held, or restored on an
        // earlier line): a patch alone would make an entity.
        let [row] = await g.get([b.entity.eid])
        if (row?.call) out.push(b)
      }
    }
    if (!out.length) continue
    await paced(() =>
      g.apply(out, { trusted: true, ...(l.at ? { now: l.at } : {}) })
    )
  }
  await paced(() =>
    g.apply([{
      entity: { eid: session },
      session: { consumed: log.count },
    }], { trusted: true })
  )
  return n
}

if (write) {
  console.log('waiting for the @yaks/session and @yaks/spawn leases')
  let o = {
    holder: host.me,
    signal: new AbortController().signal,
    poll: 100,
    gone: host.gone,
  }
  await holding(g, '@yaks/session', o, async () => {
    await holding(
      g,
      '@yaks/spawn',
      o,
      () => backfill(new Set(affected.map((f) => f.session))),
    )
    let restored = 0
    for (let f of affected) {
      restored += await restore(f)
      console.log(`${restored} of ${found.size}`)
    }
  })
}
db.close()
await close(0)

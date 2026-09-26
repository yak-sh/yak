#!/usr/bin/env -S deno run -A
// One-time: each session's read position (`session.consumed`, now undeclared)
// moves onto the log it counts (`log{session, source, consumed}`), and the
// session names that log as its first (`session.log`), whose entries keep
// their ids. The file is the one its entries name; a session whose entries are
// gone is matched to its file by its harness's own id, or its run's stdout.
//
// A harness id can name two files. Those sessions hold no entries today: their
// lines collided, and what was read in was deleted. The file the position
// counts becomes the session's first log, the other gets a log of its own, and
// both stay read to their end. Once a write to a deleted entity revives it,
// `--reread` sets every log of a session with two back to its first line, so
// the importer reads them in again: the first log's lines under the ids their
// entries had, the other's under ids naming its file.
//
// Hold the server down while the move runs: the importers read positions.
//
//   deno run -A bin/move-read-positions.ts <config> [--write]
//   deno run -A bin/move-read-positions.ts <config> --reread [--write]

import { DatabaseSync } from 'node:sqlite'
import type { Bundle, Eid } from '@yaks/graph'
import {
  among,
  col,
  notNull,
  render,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import { read } from '../packages/cli/config.ts'
import { close, opened } from '../packages/cli/local.ts'
import { logOf } from '../packages/session/tail.ts'
import { claudeProjects, transcripts } from '../packages/session/service.ts'
import { paths } from '../packages/process/run.ts'

let [path, ...flags] = Deno.args
let write = flags.includes('--write')
let host = await opened(path, ['graph'], false)
let g = host.graph
let db = new DatabaseSync(read(path).db!, { timeout: 5000 })
let run = (s: Stmt) => {
  let r = render(s)
  return db.prepare(r.sql).all(...r.params as (string | number)[])
}

let lines = (file: string) => {
  try {
    return Deno.readTextFileSync(file).split('\n').length - 1
  } catch {
    return undefined
  }
}

// The positions to move, or, to read again, every log of a session with two.
let move = async (): Promise<Bundle[]> => {
  let files = new Map<string, string[]>()
  for (let f of transcripts(claudeProjects()!)) {
    files.set(f.id, [...files.get(f.id) ?? [], f.path])
  }
  let held = run(select({
    cols: [col('entity'), col('consumed')],
    from: table('session'),
    where: notNull(col('consumed')),
  }))
  let eids = new Map(
    run(select({
      cols: [col('id'), col('eid')],
      from: table('entity'),
      where: among(col('id'), held.map((r) => val(Number(r.entity)))),
    })).map((r) => [Number(r.id), String(r.eid) as Eid]),
  )
  let out: Bundle[] = []
  let two: Eid[] = []
  let none: Eid[] = []
  for (let r of held) {
    let session = eids.get(Number(r.entity))!
    let consumed = Number(r.consumed)
    let named = (await g.rows(
      `.imported&.entry.session=${session}&.tally=imported.source`,
    )).map((x) => String(x.value)).filter((s) => s.startsWith('/'))
    let [row] = await g.get([session])
    let id = String((row?.session as { id?: string })?.id ?? session)
    let found = named.length ? named : [
      ...files.get(id) ?? files.get(session) ?? [],
      paths(session).out,
    ].filter((f) => lines(f) != null)
    if (!found.length) {
      none.push(session)
      continue
    }
    // The file the position counts is the first; any other is read on its own.
    let first = found.find((f) => lines(f) == consumed) ?? found[0]
    let rest = found.filter((f) => f != first)
    if (rest.length) two.push(session)
    out.push(
      ...[first, ...rest].map((f) => ({
        entity: { eid: logOf(f) },
        log: { session, source: f, consumed: f == first ? consumed : lines(f) },
      })),
      { entity: { eid: session }, session: { log: logOf(first) } },
    )
  }
  console.log(
    `${held.length} positions: ${
      out.filter((b) => b.log).length
    } logs, ${two.length} sessions with two, ${none.length} with no file`,
  )
  if (none.length) console.log('no file:', none.join(' '))
  if (two.length) console.log('two logs:', two.join(' '))
  return out
}

let again = async (): Promise<Bundle[]> => {
  let logs = await g.read('.log&?log')
  let count = new Map<string, number>()
  for (let b of logs) {
    let s = String((b.log as { session: string }).session)
    count.set(s, (count.get(s) ?? 0) + 1)
  }
  let back = logs.filter((b) =>
    count.get(String((b.log as { session: string }).session))! > 1
  )
  console.log(
    `${back.length} logs of ${
      [...count.values()].filter((n) => n > 1).length
    } sessions with two, read again from their first line`,
  )
  return back.map((b) => ({ entity: b.entity, log: { consumed: 0 } }))
}

let reread = flags.includes('--reread')
let out = reread ? await again() : await move()
if (write) {
  for (let i = 0; i < out.length; i += 200) {
    await g.apply(out.slice(i, i + 200), { trusted: true })
  }
  if (!reread) {
    run({
      t: 'update',
      table: 'session',
      set: { consumed: val(null) },
      where: notNull(col('consumed')),
    })
  }
  console.log('written')
}
db.close()
await close(0)

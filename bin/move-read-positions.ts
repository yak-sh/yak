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
// both stay read to their end. `--reread` then reads every log of a session
// with two in again from its first line, its prose only, as the importer reads
// an old log: the first log's lines under the ids their entries had, which a
// write brings back, and the other's under ids naming its file. It holds the
// session duty's lease meanwhile, so the importer reads none of them.
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
import { holding } from '@yaks/effects'
import { claude } from '@yaks/session'
import { logOf, pull, tail } from '../packages/session/tail.ts'
import { claudeProjects, transcripts } from '../packages/session/service.ts'
import { paths } from '../packages/process/run.ts'

if (import.meta.main) {
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

  // Each position, moved onto the log it counts.
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
          log: {
            session,
            source: f,
            consumed: f == first ? consumed : lines(f),
          },
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

  // Every log of a session with two, read in again from its first line.
  let again = async () => {
    let logs = (await g.read('.log&?log')).map((b) =>
      b.log as { session: Eid; source: string }
    )
    let count = new Map<string, number>()
    for (let l of logs) count.set(l.session, (count.get(l.session) ?? 0) + 1)
    let back = logs.filter((l) => count.get(l.session)! > 1)
    let held = async () =>
      (await g.read(
        `.entry.session=${[...new Set(back.map((l) => l.session))]}&?entry`,
      )).length
    console.log(
      `${back.length} logs of ${
        new Set(back.map((l) => l.session)).size
      } sessions with two; ${await held()} entries held`,
    )
    if (!write) return
    let said = host.config.person
    let person = said && ((await g.address([said])).get(said) ?? said) as Eid
    let o = {
      holder: host.me,
      signal: new AbortController().signal,
      poll: 100,
      gone: host.gone,
    }
    await holding(g, '@yaks/session', o, async () => {
      for (let l of back) {
        await g.apply([{
          entity: { eid: logOf(l.source) },
          log: { consumed: 0 },
        }], {
          trusted: true,
        })
        let t = await tail(g, l.source, { session: l.session })
        await pull(g, t, claude, { prose: true, person, final: true })
      }
    })
    console.log(`read in again; ${await held()} entries held`)
  }

  if (flags.includes('--reread')) await again()
  else {
    let out = await move()
    if (write) {
      for (let i = 0; i < out.length; i += 200) {
        await g.apply(out.slice(i, i + 200), { trusted: true })
      }
      run({
        t: 'update',
        table: 'session',
        set: { consumed: val(null) },
        where: notNull(col('consumed')),
      })
      console.log('written')
    }
  }
  db.close()
  await close(0)
}

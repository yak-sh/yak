#!/usr/bin/env -S deno run -A
// One-time: the prose the transcript strip deleted at 00:20Z on 2026-09-26
// comes back from the backup taken before it (~/.yak 6bd26a44), under its own
// eids and numbers. That pass read `!content` as a property of the same name
// (fixed in 8b6e1255), so it took every imported entry of the sessions it
// found stale; those were the old fleet's sessions, whose logs are not on this
// machine, so no importer can read them in again. What was not prose stays
// deleted, as the strip means it to be. Each entry comes back whole, as the
// backup holds it, with the `references` edges it had; a write to a deleted
// entity revives it. An entry written since among them (a note ending a
// session that read as still going) moves to after them first, beneath the
// graph, since apply never moves a `seq`. Which entities the pass
// deleted is below every interface storage offers, so it is read with a
// statement built by @yaks/sql.
//
//   deno run -A bin/restore-stripped-prose.ts <config> <backup config> [--write]

import { DatabaseSync } from 'node:sqlite'
import { type Bundle, type Eid, TOMBSTONE } from '@yaks/graph'
import { among, and, col, ge, le, render, select, table, val } from '@yaks/sql'
import { read } from '../packages/cli/config.ts'
import { close, opened } from '../packages/cli/local.ts'

// The strip's pass, between the migration's last delete and its own last.
let FROM = '2026-09-26T00:19:30Z'
let TO = '2026-09-26T00:25:00Z'
// What an entry that is not prose wears.
let TOOLING = [
  'call',
  'result',
  'reasoning',
  'notice',
  'stop',
  'usage',
  'error',
  'exception',
]
// Derived from what an entry says, and filled again by its own sweep.
let DERIVED = ['embedding', TOMBSTONE]

if (import.meta.main) {
  let [path, backup, ...flags] = Deno.args
  let write = flags.includes('--write')
  let live = (await opened(path, ['graph'], false)).graph
  let past = (await opened(backup, ['graph'], false)).graph

  let db = new DatabaseSync(read(path).db!, { readOnly: true })
  let r = render(select({
    cols: [col('eid')],
    from: table('entity'),
    where: among(
      col('id'),
      select({
        cols: [col('entity')],
        from: table('tombstone'),
        where: and(
          ge(col('deleted_at'), val(FROM)),
          le(col('deleted_at'), val(TO)),
        ),
      }),
    ),
  }))
  let gone = db.prepare(r.sql).all(...r.params as string[])
    .map((x) => String(x.eid) as Eid)
  db.close()

  let chunks = <T>(xs: T[], n = 400) =>
    Array.from(
      { length: Math.ceil(xs.length / n) },
      (_, i) => xs.slice(i * n, i * n + n),
    )
  let held = (await Promise.all(chunks(gone).map((c) => past.get(c)))).flat()
  let entries = held.filter((b) =>
    b?.entry && b[TOMBSTONE] == null && b.content &&
    !TOOLING.some((k) => b[k])
  )
  let back = new Set(entries.map((b) => b.entity.eid))
  let lost = new Set(gone)
  let edges = (await Promise.all(
    chunks([...back]).map((c) =>
      past.read(`.references&.edge.from=${c.join(',')}&*`)
    ),
  )).flat().filter((b) => lost.has(b.entity.eid))

  // An entity comes back as the backup holds it, but for what is derived.
  let whole = (b: Bundle): Bundle =>
    Object.fromEntries(
      Object.entries(b).filter(([k]) => !DERIVED.includes(k)),
    ) as Bundle

  // The entries written since the pass among these, moved to after the
  // session's last.
  let place = (b: Bundle) => b.entry as { session: Eid; seq: number }
  let moved: Bundle[] = []
  for (let session of new Set(entries.map((b) => place(b).session))) {
    let last = Math.max(
      ...entries.filter((b) => place(b).session == session).map((b) =>
        place(b).seq
      ),
    )
    let here = await live.read(
      `.entry.session=${session}&.order=entry.seq&?entry&?created`,
    )
    let top = Math.max(last, ...here.map((b) => place(b).seq))
    for (let b of here) {
      let at = String((b.created as { at?: string })?.at ?? '')
      if (at < FROM || place(b).seq > last) continue
      moved.push({ entity: b.entity, entry: { session, seq: ++top } })
      console.log(
        `${session} #${place(b).seq}: ${b.entity.eid} moves to #${top}`,
      )
    }
  }
  let typed = entries.filter((b) => !b.output).length
  console.log(
    `${gone.length} deleted by the pass; ${entries.length} of them prose (${typed} typed, ${
      entries.length - typed
    } said) in ${
      new Set(entries.map((b) => (b.entry as { session: string }).session)).size
    } sessions, with ${edges.length} references; ${moved.length} written since moved after them`,
  )

  if (write) {
    if (moved.length) await live.storage.tx((tx) => tx.patch(moved))
    for (let c of chunks([...entries, ...edges].map(whole), 100)) {
      await live.apply(c, { trusted: true })
    }
    let now = (await Promise.all(chunks([...back]).map((c) => live.get(c))))
      .flat()
    console.log(
      `written; ${
        now.filter((b) => b?.entry && b[TOMBSTONE] == null).length
      } of ${back.size} entries stand`,
    )
  }
  await close(0)
}

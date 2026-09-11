// The real fleet parser -> SQL compiler -> db.ts hydration/apply, never live data.
import { assertEquals } from '@std/assert'
import { location } from '../packages/sqlite/fixtures/bench.ts'
import { workload } from '../packages/sqlite/fixtures/fleet.ts'
import type { Bundle } from '@yaks/graph'
import type { Change } from './types.ts'

let loc = location()
Deno.env.set('DB_PATH', loc.path)
Deno.env.set('TASKS_SYNC', 'off')
Deno.env.set('TASKS_EMBED', '0')
let { open } = await import('./store/sqlite.ts')
let { apply, matching, rowsOf } = await import('./db.ts')
let { parseQuery } = await import('./query.ts')
let { where } = await import('./sql.ts')
let { toSql } = await import('./relation.ts')
let db = open(loc.path)
addEventListener('unload', () => {
  db.close()
  loc.cleanup()
})
db.exec('pragma journal_mode=wal; pragma synchronous=normal')
assertEquals(Number(db.prepare('pragma synchronous').get()!.synchronous), 1)
if (loc.mode == 'file') {
  assertEquals(db.prepare('pragma journal_mode').get()!.journal_mode, 'wal')
}
// Same unseeded-schema recipe as testdb.ts/bareDb. Use SQLite APIs, not file
// copying/deserialization (which would turn the file measurement into RAM).
db.exec('pragma foreign_keys=off')
for (
  let { name } of db.prepare(`select name from sqlite_master where type='table'
  and name not like 'sqlite_%' and name not like '%_fts%' and name not like '%_gram%'`)
    .all<{ name: string }>()
) {
  db.exec(`delete from "${name.replaceAll('"', '""')}"`)
}
db.exec('pragma foreign_keys=on')
let changes = (bundles: Bundle[]): Change[] =>
  bundles.flatMap((b) =>
    Object.entries(b).filter(([name]) => name != 'entity').map((
      [name, comp],
    ) => ({ eid: b.entity.eid, name, comp: comp as Record<string, unknown> }))
  )
let data = workload()
apply(db, changes(data.bundles))
for (let q of data.queries) {
  // Match the fleet query door: plan-time descriptor IDs and execution share
  // one read snapshot. Detached relations deliberately use the safe fallback.
  let read = () =>
    db.transaction(() => {
      let rel = where(db, parseQuery(q.query))
      if (!rel) throw new Error(`Fleet declined ${q.query}`)
      return matching(db, toSql(rel))
    })
  assertEquals(read().map((r) => r.eid).sort(), [...q.expected].sort(), q.name)
  Deno.bench(`fleet/${loc.mode}/${q.name}`, () => {
    read()
  })
}
let batches = data.batches.map(changes)
let phase = 0
let write = () => apply(db, batches[phase++ % 2])
for (let batch of data.batches) {
  write()
  let rows = new Map(
    rowsOf(db, batch.map((b) => b.entity.eid)).map((
      r,
    ) => [r.eid, r.comps.doc.title]),
  )
  assertEquals(
    batch.map((b) => rows.get(b.entity.eid)),
    batch.map((b) => b.doc.title),
  )
}
Deno.bench(`fleet/${loc.mode}/apply-100`, () => {
  write()
})

#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi
// One-time: take out of the journal what its vocabulary now keeps out of it
// (`journal: false`), the history of plumbing rather than of anyone's data.
//
//   deno run -A bin/migrate-journal-plumbing.ts <db> [--dry] [--batch=N]
//     [--rest=ms] [--sets=<file>] [--from=<change id>]
//
// Deleted, change by change, with each change's fields:
// - every change to a component every package's vocabulary declares
//   `journal: false`;
// - the `edge` changes of a link whose relation is such a component (a git
//   tree entry, an import, a recall), which the journal recorded beside it;
// - the deletion records (`entity` changes) of an entity whose recorded
//   history is now only that: plumbing that was deleted. An entity with no
//   recorded plumbing keeps its deletion, even with nothing else recorded.
// Then every transaction left with no change.
//
// Ids are read up to the tip when the run starts, so what commits during it is
// left alone; a second run takes what an old writer recorded since. Each batch
// is its own short write transaction with a rest after it, so the live writers
// wait at most one batch. Nothing is vacuumed: the pages go to the freelist.

import { DatabaseSync } from 'node:sqlite'

let args = Deno.args.filter((a) => !a.startsWith('--'))
let flag = (name: string, d: number) =>
  Number(
    Deno.args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? d,
  )
let dry = Deno.args.includes('--dry')
let batch = flag('batch', 20_000)
let rest = flag('rest', 50)
let root = new URL('..', import.meta.url).pathname

// What the vocabulary keeps out, read from every package's declarations.
let off: string[] = []
for (let d of Deno.readDirSync(`${root}packages`)) {
  let doc
  try {
    doc = JSON.parse(
      Deno.readTextFileSync(`${root}packages/${d.name}/vocab.json`),
    )
  } catch {
    continue
  }
  for (
    let [name, def] of Object.entries<Record<string, unknown>>(doc.$defs ?? {})
  ) {
    if (def.component && def.journal === false) off.push(name)
  }
}
let relations = off.filter((name) => {
  for (let d of Deno.readDirSync(`${root}packages`)) {
    try {
      let doc = JSON.parse(
        Deno.readTextFileSync(`${root}packages/${d.name}/vocab.json`),
      )
      if (doc.$defs?.[name]?.edge) return true
    } catch { /* no vocabulary */ }
  }
  return false
})

let db = new DatabaseSync(args[0])
db.exec('pragma busy_timeout = 30000')
// The live processes checkpoint the WAL as they commit; this run's commits
// would otherwise checkpoint it themselves, seconds of I/O inside each one.
db.exec('pragma wal_autocheckpoint = 0')
let one = (sql: string, ...p: (string | number)[]) =>
  db.prepare(sql).get(...p) as Record<string, number>
let count = () => ({
  tx: one('select count(*) n from journal_tx').n,
  change: one('select count(*) n from journal_change').n,
  field: one('select count(*) n from journal_field').n,
  free: one('pragma freelist_count').freelist_count,
  pages: one('pragma page_count').page_count,
})
let sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let say = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

say('off', off.length, 'relations', relations.join(','))
let before = count()
say('before', before)

// Links whose relation is kept out, and entities whose recorded history is
// only plumbing: read once, before anything is deleted, and kept in a file
// beside the run (`--sets=<path>`), so a run that stops resumes (`--from=<id>`)
// with the sets as they stood before it deleted anything.
let sets = Deno.args.find((a) => a.startsWith('--sets='))?.slice(7)
if (!sets) throw new Error('--sets=<file> names where the sets are kept')
db.exec(`attach '${sets}' as sets`)
if (!one(`select count(*) n from sets.sqlite_schema where name = 'plumb'`).n) {
  db.exec('create table sets.off (name text primary key)')
  db.exec('create table sets.relation (name text primary key)')
  for (let name of off) db.prepare('insert into sets.off values (?)').run(name)
  for (let name of relations) {
    db.prepare('insert into sets.relation values (?)').run(name)
  }
  db.exec(`create table sets.links (entity integer primary key)`)
  db.exec(`insert into sets.links select distinct entity from journal_change
    where component in (select name from sets.relation)`)
  db.exec(`create table sets.plumb (entity integer primary key)`)
  db.exec(`insert into sets.plumb select entity from journal_change
    group by entity
    having sum(component in (select name from sets.off)
        or (component = 'edge' and entity in (select entity from sets.links))) > 0
      and sum(component not in (select name from sets.off)
        and component != 'entity'
        and not (component = 'edge' and entity in (select entity from sets.links))) = 0`)
}
say('links', one('select count(*) n from sets.links').n)
say('plumbing entities', one('select count(*) n from sets.plumb').n)

// The unary `+` keeps the batch's id range driving the scan: left to it, the
// planner answers the OR by probing journal_change once per row of `links`
// and `plumb` (millions), every batch, under the write lock.
let doomed = `(+component in (select name from sets.off)
  or (+component = 'edge' and +entity in (select entity from sets.links))
  or (+component = 'entity' and +entity in (select entity from sets.plumb)))`
let from = flag('from', 0)
let tip = one('select max(id) n from journal_change').n ?? 0
let txTip = one('select max(id) n from journal_tx').n ?? 0

if (dry) {
  say(
    'would delete changes',
    one(
      `select count(*) n from journal_change where id <= ? and ${doomed}`,
      tip,
    ).n,
  )
  Deno.exit(0)
}

let fields = db.prepare(`delete from journal_field where change in
  (select id from journal_change where id > ? and id <= ? and ${doomed})`)
let changes = db.prepare(
  `delete from journal_change where id > ? and id <= ? and ${doomed}`,
)
let gone = { change: 0, field: 0, tx: 0 }
// The longest any batch held the write lock, in ms, from taking it.
let held = 0
// Each batch spans as many ids as keep its hold near TARGET ms, quartering after
// a long one and doubling after a short one, and the run rests at least as
// long as it held, so the live writers have the lock most of the time.
let TARGET = 250
let pass = async (
  label: string,
  start: number,
  end: number,
  work: (lo: number, hi: number) => void,
) => {
  let span = batch
  let said = 0
  for (let lo = start; lo < end;) {
    let hi = Math.min(lo + span, end)
    db.exec('begin immediate')
    let t = performance.now()
    work(lo, hi)
    db.exec('commit')
    let ms = Math.round(performance.now() - t)
    held = Math.max(held, ms)
    // A batch that held the lock this long would stall the live writers: stop.
    if (ms > 5000) throw new Error(`a batch held the write lock ${ms}ms`)
    span = ms > TARGET * 2
      ? Math.max(100, span >> 2)
      : ms < TARGET / 2
      ? Math.min(batch * 4, span * 2)
      : span
    lo = hi
    if (++said % 500 == 0) say(label, hi, gone, { held, span })
    await sleep(Math.max(rest, ms))
  }
}
await pass('changes through', from, tip, (lo, hi) => {
  gone.field += Number(fields.run(lo, hi).changes)
  gone.change += Number(changes.run(lo, hi).changes)
})
let empty = db.prepare(`delete from journal_tx where id > ? and id <= ?
  and not exists (select 1 from journal_change c where c.tx = journal_tx.id)`)
await pass('transactions through', 0, txTip, (lo, hi) => {
  gone.tx += Number(empty.run(lo, hi).changes)
})
let after = count()
say('deleted', gone, { held })
say('after', after)
let size = one('pragma page_size').page_size
let freed = after.free - before.free
say('freed pages', freed, `(${(freed * size / 2 ** 30).toFixed(2)} GiB)`)

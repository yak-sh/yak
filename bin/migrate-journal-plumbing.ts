#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-ffi
// One-time: take out of the journal what its vocabulary now keeps out of it
// (`journal: false`), the history of plumbing rather than of anyone's data.
//
//   deno run -A bin/migrate-journal-plumbing.ts <db> [--dry] [--batch=N] [--rest=ms]
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

db.exec('create temp table off (name text primary key)')
db.exec('create temp table relation (name text primary key)')
for (let name of off) db.prepare('insert into off values (?)').run(name)
for (let name of relations) {
  db.prepare('insert into relation values (?)').run(name)
}
// Links whose relation is kept out, and entities whose recorded history is
// only plumbing: read once, before anything is deleted.
db.exec(`create temp table links (entity integer primary key)`)
db.exec(`insert into links select distinct entity from journal_change
  where component in (select name from relation)`)
say('links', one('select count(*) n from temp.links').n)
db.exec(`create temp table plumb (entity integer primary key)`)
db.exec(`insert into plumb select entity from journal_change
  group by entity
  having sum(component in (select name from off)
      or (component = 'edge' and entity in (select entity from links))) > 0
    and sum(component not in (select name from off) and component != 'entity'
      and not (component = 'edge' and entity in (select entity from links))) = 0`)
say('plumbing entities', one('select count(*) n from temp.plumb').n)

// The unary `+` keeps the batch's id range driving the scan: left to it, the
// planner answers the OR by probing journal_change once per row of `links`
// and `plumb` (millions), every batch, under the write lock.
let doomed = `(+component in (select name from off)
  or (+component = 'edge' and +entity in (select entity from links))
  or (+component = 'entity' and +entity in (select entity from plumb)))`
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
// The longest any batch held the write lock, in ms.
let held = 0
let locked = (work: () => void) => {
  let t = performance.now()
  db.exec('begin immediate')
  work()
  db.exec('commit')
  held = Math.max(held, Math.round(performance.now() - t))
  // A batch that held the lock this long would stall the live writers: stop.
  if (held > 2000) throw new Error(`a batch held the write lock ${held}ms`)
}
for (let lo = 0; lo < tip; lo += batch) {
  let hi = Math.min(lo + batch, tip)
  locked(() => {
    gone.field += Number(fields.run(lo, hi).changes)
    gone.change += Number(changes.run(lo, hi).changes)
  })
  if ((lo / batch) % 100 == 0) say('changes through', hi, gone, { held })
  await sleep(rest)
}
let empty = db.prepare(`delete from journal_tx where id > ? and id <= ?
  and not exists (select 1 from journal_change c where c.tx = journal_tx.id)`)
for (let lo = 0; lo < txTip; lo += batch) {
  let hi = Math.min(lo + batch, txTip)
  locked(() => gone.tx += Number(empty.run(lo, hi).changes))
  if ((lo / batch) % 100 == 0) say('transactions through', hi, gone, { held })
  await sleep(rest)
}
let after = count()
say('deleted', gone, { held })
say('after', after)
let size = one('pragma page_size').page_size
let freed = after.free - before.free
say('freed pages', freed, `(${(freed * size / 2 ** 30).toFixed(2)} GiB)`)

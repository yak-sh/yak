// T-59066's one-time empty legacy table retirement. No host or effects run.
import { open } from '../packages/sqlite/db.ts'
import { meta, objects, storage } from '@yaks/sqlite'
import { SCHEMA } from '../packages/sqlite/meta.ts'
import { unit } from '../packages/sqlite/unit.ts'
import { read } from '../packages/cli/config.ts'
import { words } from '../packages/cli/host.ts'
import { graph } from '@yaks/graph'
import { journal, log } from '../packages/journal/mod.ts'
import { rules } from '../packages/archetype/rules.ts'
import { col, count, eq, select, table, val } from '@yaks/sql'

let path = Deno.args[0]
if (!path || !Deno.statSync(path).isFile) {
  throw new Error('Existing DB required')
}
if (path == '/home/yaks/.yak/yak.db' && !Deno.args.includes('--live')) {
  throw new Error('Live retirement needs --live')
}
let { vocab, derived } = await words(read('/home/yaks/.yak/yak.json'))
if (vocab.comp('error')) throw new Error('Legacy component still declared')
let db = open(path)
try {
  let exists = () =>
    objects(db, { type: 'table' }).some((r) => r.name == 'error')
  let before = exists()
  unit(db, () => {
    if (!before) return
    let rows = db.query(select({ cols: [count()], from: table('error') }))
    if (Number(Object.values(rows[0])[0])) throw new Error('Legacy rows remain')
    let old = db.query(
      select({
        cols: [col('entity'), col('tables')],
        from: table('archetype'),
      }),
    )
      .filter((r) => JSON.parse(String(r.tables)).includes('error'))
    let active = old.some((r) =>
      db.query(select({
        cols: [col('eid')],
        from: table('entity'),
        where: eq(col('archetype'), val(Number(r.entity))),
        limit: val(1),
      })).length
    )
    if (active) throw new Error('An entity still wears a legacy archetype')
    let store = storage(db, vocab, { derived })
    let g = graph({
      storage: store,
      vocab,
      plugins: [
        ...rules(),
        journal(log({ rows: (stmt) => db.query(stmt), derived })),
      ],
    })
    g.apply(
      old.map((r) => ({
        entity: {
          eid: String(
            db.query(select({
              cols: [col('eid')],
              from: table('entity'),
              where: eq(col('rowid'), val(Number(r.entity))),
            }))[0].eid,
          ),
        },
        retired: {},
      })),
      { trusted: true },
    )
    db.query({ t: 'drop', kind: 'table', name: 'error' })
    meta(db).del(SCHEMA)
  })
  console.log(JSON.stringify({ before, after: exists() }))
} finally {
  db.close()
}

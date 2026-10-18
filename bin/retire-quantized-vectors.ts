// One-time removal of obsolete native vector codes after every pre-cutover
// worker and web has stopped. Canonical embeddings remain untouched.
import {
  as,
  count,
  fn,
  lit,
  select,
  type Statements,
  statements,
  table,
} from '@yaks/sql'
import { BUILD, TABLE } from '@yaks/embedding'
import { untrack } from '../packages/embedding/ddl.ts'
import { install, prepare } from '../packages/embedding/native.ts'

let size = (db: Statements) =>
  Number(
    db.query(select({
      cols: [as(count(), 'n')],
      from: table(TABLE),
    }))[0].n,
  )

export let retire = (db: Statements) => {
  let [old] = db.query(select({ from: table(BUILD) }))
  let removed = !!Number(old?.rows)
  if (removed) {
    install(db)
    prepare(db)
  }
  return db.atomic(() => {
    let before = size(db)
    if (removed) {
      db.query(select({
        cols: [fn('vector_quantize_cleanup', lit(TABLE), lit('vec'))],
      }))
      let memory = db.query(select({
        cols: [
          as(fn('vector_quantize_memory', lit(TABLE), lit('vec')), 'bytes'),
        ],
      }))[0]?.bytes
      if (Number(memory) > 0) throw Error('Native vector codes remain')
    }
    // Old CLI readers reject this generation before consulting retired codes.
    db.query({
      t: 'update',
      table: BUILD,
      set: { n: lit(0), model: lit(null), dim: lit(0), rows: lit(0) },
    })
    if (db.ownership == 'shared') {
      for (let stmt of untrack()) db.query(stmt)
    }
    let after = size(db)
    if (after != before) throw Error('Canonical vector count changed')
    return { before, after, removed }
  })
}

if (import.meta.main) {
  let { read } = await import('../packages/cli/config.ts')
  let { compose } = await import('../packages/cli/host.ts')
  let host = await compose(read(Deno.args[0]), ['graph'], undefined, {
    process: false,
  })
  try {
    console.log(JSON.stringify(retire(statements(host.storage))))
  } finally {
    await host.close()
  }
}

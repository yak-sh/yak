// One-time removal of obsolete native vector codes after every pre-cutover
// worker and web has stopped. Canonical embeddings remain untouched.
import { as, count, fn, lit, select, type Statements, table } from '@yaks/sql'
import { BUILD, TABLE } from '@yaks/embedding'
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
  let before = size(db)
  if (!Number(old?.rows)) return { before, after: before, removed: false }
  install(db)
  prepare(db)
  return db.atomic(() => {
    let before = size(db)
    db.query(select({
      cols: [fn('vector_quantize_cleanup', lit(TABLE), lit('vec'))],
    }))
    db.query({
      t: 'update',
      table: BUILD,
      set: { rows: lit(0) },
    })
    let memory = db.query(select({
      cols: [as(fn('vector_quantize_memory', lit(TABLE), lit('vec')), 'bytes')],
    }))[0]?.bytes
    if (Number(memory) > 0) throw Error('Native vector codes remain')
    let after = size(db)
    if (after != before) throw Error('Canonical vector count changed')
    return { before, after, removed: true }
  })
}

if (import.meta.main) {
  let { read } = await import('../packages/cli/config.ts')
  let { compose } = await import('../packages/cli/host.ts')
  let host = await compose(read(Deno.args[0]), ['graph'], undefined, {
    process: false,
  })
  try {
    console.log(JSON.stringify(retire(host.storage.statements!)))
  } finally {
    await host.close()
  }
}

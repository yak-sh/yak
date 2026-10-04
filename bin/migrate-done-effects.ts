// Owner-invoked T-65493 cleanup: explicit config, vocabulary facets only, no
// host boot/install, effects, provider calls, restart or config edits.
import { words } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { cleanupDone } from '../packages/effects/cleanup.ts'
import { graph } from '@yaks/graph'
import { archetypes } from '@yaks/archetype'
import { journal, log } from '@yaks/journal'
import { schema, storage } from '@yaks/sqlite'
import { col, eq, tally, val } from '@yaks/sql'
import { open } from '@yaks/sqlite/db'

let path = Deno.args[0]
if (!path || Deno.args.length > 2) {
  throw Error(
    'usage: deno run -A bin/migrate-done-effects.ts /absolute/config.json [limit]',
  )
}
let limit = Deno.args[1] == null ? Infinity : Number(Deno.args[1])
if (!(limit > 0) || limit != Infinity && !Number.isInteger(limit)) {
  throw Error('positive limit required')
}
let config = read(path)
if (!config.db || config.db == ':memory:') {
  throw Error('explicit existing database required')
}
await Deno.stat(config.db)
let loaded = await words(config)
let sql = open(config.db)
try {
  // Refuse an incomplete declaration rather than refitting a standing file.
  // Vocabulary changes are landed before this owner-invoked command runs.
  for (let statement of schema(loaded.vocab, loaded.derived)) {
    if (statement.t != 'create table' || statement.name == '_meta') continue
    let columns = sql.query({
      t: 'pragma',
      name: 'table_info',
      arg: statement.name,
    })
    let held = new Set(columns.map((c) => String(c.name)))
    if (!columns.length || statement.cols.some((c) => !held.has(c.name))) {
      throw Error(
        `database lacks declared table ${statement.name}; no cleanup performed`,
      )
    }
  }
  // No schema installation. This connection alone holds each transaction;
  // only the existing graph shape is used, and writes keep the journal/index.
  let driver = { ...sql, file: false }
  let db = storage(driver, loaded.vocab, {
    derived: loaded.derived,
    backed: loaded.backed,
    schemaReady: () => true,
    number: config.numbers,
  })
  let g = graph({
    storage: db,
    vocab: loaded.vocab,
    plugins: [
      archetypes(),
      journal(log({ rows: (s) => sql.query(s), derived: loaded.derived })),
    ],
  })
  let before = tally(sql, 'effect', eq(col('state'), val('done')))
  let failedBefore = await g.read('.effect.state=failed&*')
  let pendingBefore = tally(sql, 'effect', eq(col('state'), val('pending')))
  let removed = await cleanupDone(g, 100, limit)
  let after = tally(sql, 'effect', eq(col('state'), val('done')))
  let failedAfter = await g.read('.effect.state=failed&*')
  if (
    before - after != removed ||
    JSON.stringify(failedBefore) != JSON.stringify(failedAfter)
  ) throw Error('cleanup count/failure verification failed')
  console.log(
    JSON.stringify({
      before,
      removed,
      after,
      failed: failedAfter.length,
      pendingBefore,
      pendingAfter: tally(sql, 'effect', eq(col('state'), val('pending'))),
    }),
  )
} finally {
  sql.close()
}

// The SAME deterministic corpus and prepare-per-call driver as throughput_bench.
// Backfill measures a fresh migration (including descriptor creation), not a
// warmed no-op. Reset/rollback are outside the timed interval.
import { assertEquals } from '@std/assert'
import { archetypeDoc, archetypes, eidOf } from '@yaks/archetype'
import { edgeKeywords } from '@yaks/edge'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { Database } from './db.ts'
import { backfill, type Driver, storage } from './mod.ts'
import { location } from './fixtures/bench.ts'
import { vocab as corpus, workload } from './fixtures/fleet.ts'

let loc = location()
let db = new Database(loc.path)
addEventListener('unload', () => {
  db.close()
  loc.cleanup()
})
db.exec(
  'pragma foreign_keys=on; pragma journal_mode=wal; pragma synchronous=normal',
)
let driver: Driver = {
  query: (sql, params) => {
    let stmt = db.prepare(sql)
    try {
      return stmt.all(...params)
    } finally {
      stmt.finalize()
    }
  },
  exec: (sql) => db.exec(sql),
}
let vocab = loadVocab([...corpus.docs, archetypeDoc], [edgeKeywords])
let store = storage(driver, vocab)
store.install()
let data = workload()
store.tx((tx) => tx.patch(data.bundles))
let size = driver.query('select count(*) as n from entity', [])[0].n
Deno.bench(`archetype/${loc.mode}/backfill`, (b) => {
  driver.exec('savepoint sample')
  let descriptors = driver.query('select entity from archetype', []).map((r) =>
    r.entity
  )
  driver.exec('update entity set archetype = null; delete from archetype')
  driver.query(
    'delete from entity where id in (select value from json_each(?))',
    [JSON.stringify(descriptors)],
  )
  b.start()
  let result = backfill(driver)
  b.end()
  assertEquals(result.entities, size)
  driver.exec('rollback to sample; release sample')
})
backfill(driver)
assertEquals(backfill(driver), { entities: 0, archetypes: 0, retired: 0 })
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
let phase = 0
let moves = [true, false].map((add) =>
  data.batches[0].map((b) => ({ entity: b.entity, retired: add ? {} : null }))
)
// Warm both directions, verifying the move instead of timing a silent no-op.
for (let batch of moves) {
  g.apply(batch)
  let first = store.tx((tx) => tx.get([batch[0].entity.eid]))[0]
  let tables = Object.keys(first).filter((n) => n != 'entity')
  assertEquals(first.entity.archetype, eidOf(tables))
}
Deno.bench(`archetype/${loc.mode}/move-100`, () => {
  g.apply(moves[phase++ % 2])
})

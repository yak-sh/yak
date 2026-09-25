// The same deterministic corpus and prepare-per-call driver as throughput_bench.
// Backfill measures a fresh migration (including descriptor creation), not a
// warmed no-op. Reset/rollback are outside the timed interval.
import { assertEquals } from '@std/assert'
import { archetypeDoc, archetypes, eidOf } from '@yaks/archetype'
import { edgeKeywords } from '@yaks/edge'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { among, col, each, lit, scan, tally } from '@yaks/sql'
import { backfill, storage } from './mod.ts'
import { location, tuned } from './fixtures/bench.ts'
import { vocab as corpus, workload } from './fixtures/fleet.ts'

let loc = location()
let db = new Database(loc.path)
addEventListener('unload', () => {
  db.close()
  loc.cleanup()
})
let driver = tuned(db)
let vocab = loadVocab([...corpus.docs, archetypeDoc], [edgeKeywords])
let store = storage(driver, vocab)
store.install()
let data = workload()
store.tx((tx) => tx.patch(data.bundles))
let size = tally(driver, 'entity')
Deno.bench(`archetype/${loc.mode}/backfill`, (b) => {
  driver.query({ t: 'savepoint', name: 'sample' })
  let descriptors = scan(driver, 'archetype', undefined, ['entity'])
    .map((r) => Number(r.entity))
  driver.query({ t: 'update', table: 'entity', set: { archetype: lit(null) } })
  driver.query({ t: 'delete', from: 'archetype' })
  driver.query({
    t: 'delete',
    from: 'entity',
    where: among(col('id'), each(descriptors)),
  })
  b.start()
  let result = backfill(driver)
  b.end()
  assertEquals(result.entities, size)
  driver.query({ t: 'rollback', to: 'sample' })
  driver.query({ t: 'release', name: 'sample' })
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

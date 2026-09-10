// Explicit A/B probe, not a new throughput-ratchet metric:
// deno bench -A packages/sqlite/fixtures/read-bench.ts
// Same file, driver, data and graph pipeline; only the read implementation
// changes. The frozen old gather is also the golden-test oracle.
import { assertEquals } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { Database } from '../db.ts'
import { shop } from '../harness.ts'
import { backfill, type Driver, get, storage, type Store } from '../mod.ts'
import { get as census } from './census.ts'
import { keyed as oldKeyed } from './keyed-before.ts'
import { location } from './bench.ts'

let loc = location()
let db = new Database(loc.path)
// Match the hot-path host: prepared SQL cached, never component data.
let statements = new Map<string, ReturnType<Database['prepare']>>()
let driver: Driver = {
  query: (sql, params) => {
    let stmt = statements.get(sql)
    if (!stmt) statements.set(sql, stmt = db.prepare(sql))
    return stmt.all(...params)
  },
  exec: (sql) => db.exec(sql),
}
driver.exec('pragma journal_mode=wal; pragma synchronous=normal')
addEventListener('unload', () => {
  for (let stmt of statements.values()) stmt.finalize()
  db.close()
  loc.cleanup()
})
let vocab = loadVocab([...shop.docs, archetypeDoc, {
  $defs: Object.fromEntries(Array.from({ length: 145 }, (_, i) => [
    `facet${i}`,
    { type: 'object', properties: { value: { type: 'string' } } },
  ])),
}])
let s = storage(driver, vocab)
s.install()
let ids = Array.from({ length: 2000 }, (_, i) => `owner-${i}`)
let mixed = Array.from({ length: 2000 }, (_, i) => `mixed-${i}`)
s.tx((tx) =>
  tx.patch([
    ...ids.map((eid) => ({
      entity: { eid },
      doc: { title: eid },
      product: { price: 1 },
    })),
    ...mixed.map((eid, i) => ({
      entity: { eid },
      doc: { title: eid },
      [`facet${i % 32}`]: { value: eid },
    })),
  ])
)
backfill(driver)
let legacy = oldKeyed(driver, vocab, {})
let old: Store = {
  ...s,
  tx: (body) => s.tx((tx) => body({ ...tx, get: legacy, pick: legacy })),
}
let clock = () => '2026-09-10T00:00:00.000Z'
let before = graph({ storage: old, vocab, plugins: [archetypes()], clock })
let after = graph({ storage: s, vocab, plugins: [archetypes()], clock })
let noop = [{ entity: { eid: ids[0] }, product: { price: 1 } }]
assertEquals(get(driver, vocab, ids), census(driver, vocab, ids))
assertEquals(get(driver, vocab, mixed), census(driver, vocab, mixed))
assertEquals(s.tx((tx) => tx.get([ids[0]])), legacy([ids[0]]))
// Settle created/updated provenance before comparing the no-op answers.
before.apply(noop)
after.apply(noop)
assertEquals(before.apply(noop), after.apply(noop))
for (
  let [name, old, fresh] of [
    [
      'snapshot-2000',
      () => census(driver, vocab, ids),
      () => get(driver, vocab, ids),
    ],
    [
      'snapshot-mixed-2000',
      () => census(driver, vocab, mixed),
      () => get(driver, vocab, mixed),
    ],
    [
      'singleton',
      () => s.tx(() => legacy([ids[0]])),
      () => s.tx((tx) => tx.get([ids[0]])),
    ],
    ['patch-one-cell-noop', () => before.apply(noop), () => after.apply(noop)],
  ] as const
) {
  Deno.bench({
    name: `${name}/before`,
    group: name,
    baseline: true,
    fn: () => {
      old()
    },
  })
  Deno.bench({
    name: `${name}/after`,
    group: name,
    fn: () => {
      fresh()
    },
  })
}

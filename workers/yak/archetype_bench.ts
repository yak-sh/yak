/** Isolated sparse app-store read/backfill benchmark. No network or live data. */
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { driver } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { backfill, storage } from '@yaks/sqlite'
import type { Driver } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'

for (let indexed of [false, true]) {
  const data = durable()
  const base = driver(data)
  let statements: unknown[] = []
  const sql: Driver = {
    ...base,
    query: (s, p) => {
      statements.push(s)
      return base.query(s, p)
    },
  }
  const defs = Object.fromEntries(
    Array.from(
      { length: 40 },
      (
        _,
        i,
      ) => [
        'field' + String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26),
        { type: 'object', properties: { value: { type: 'number' } } },
      ],
    ),
  )
  const vocab = loadVocab([{ $defs: defs }, ...indexed ? [archetypeDoc] : []])
  const store = storage(sql, vocab)
  store.install()
  const g = graph({
    storage: store,
    vocab,
    plugins: indexed ? [archetypes()] : [],
  })
  const begin = performance.now()
  for (let i = 0; i < 2000; i += 50) {
    await g.apply(
      Array.from(
        { length: 50 },
        (_, j) => ({
          entity: { eid: 'row-' + (i + j) },
          [
            'field' +
            String.fromCharCode(
              97 + Math.floor(((i + j) % 40) / 26),
              97 + (i + j) % 40 % 26,
            )
          ]: { value: i + j },
        }),
      ),
    )
  }
  const writeMs = performance.now() - begin
  let migrationMs: number | null = null
  if (indexed) {
    base.exec('update entity set archetype=null')
    const at = performance.now()
    backfill(base, false)
    migrationMs = performance.now() - at
  }
  const at = performance.now()
  let count = 0, perRead = 0
  for (let i = 0; i < 50; i++) {
    statements = []
    count = (await g.read('.fieldaa&.limit=25')).length
    perRead = statements.length
  }
  console.log(
    JSON.stringify({
      indexed,
      rows: 2000,
      tables: 40,
      returned: count,
      writeMs,
      migrationMs,
      reads: 50,
      readMs: performance.now() - at,
      statementsPerRead: perRead,
    }),
  )
  data[Symbol.dispose]()
}

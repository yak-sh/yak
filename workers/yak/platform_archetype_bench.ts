/** Isolated classification costs for directory and Git workloads. */
import { archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { driver } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { backfill, storage } from '@yaks/sqlite'
import { type Driver, lit } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { gitDocs, platformDocs } from './vocab.ts'

const rows = Number(Deno.env.get('BENCH_ROWS') ?? 2000)

for (
  const [kind, docs] of [['platform', platformDocs], ['git', gitDocs]] as const
) {
  for (const tracked of [false, true]) {
    const data = durable()
    const base = driver(data)
    let statements = 0
    const sql: Driver = {
      ...base,
      query: (s) => {
        statements++
        return base.query(s)
      },
    }
    const vocab = loadVocab(
      tracked ? docs : docs.filter((d) => d.title != 'archetype'),
    )
    const store = storage(sql, vocab)
    store.install()
    const g = graph({
      storage: store,
      vocab,
      plugins: tracked ? [archetypes()] : [],
    })
    const started = performance.now()
    for (let i = 0; i < rows; i += 10) {
      await g.apply(Array.from({ length: 10 }, (_, j) => {
        const n = i + j
        return {
          entity: { eid: 'bench-' + n },
          ...(kind == 'git'
            ? {
              gitobj: { type: 'blob', size: n },
              blob: { sha: 'b'.repeat(64) },
            }
            : n % 3 == 0
            ? { person: {}, doc: { title: 'Person ' + n } }
            : n % 3 == 1
            ? { space: { slug: 'space' + n }, doc: { title: 'Space ' + n } }
            : { app: { slug: 'app' + n }, doc: { title: 'App ' + n } }),
        }
      }))
    }
    const writeMs = performance.now() - started
    let backfillMs: number | null = null
    if (tracked) {
      base.query({
        t: 'update',
        table: 'entity',
        set: { archetype: lit(null) },
      })
      const t = performance.now()
      backfill(base, false)
      backfillMs = performance.now() - t
    }
    const t = performance.now()
    let count = 0
    for (let i = 0; i < 50; i++) {
      statements = 0
      count =
        (await g.read((kind == 'git' ? '.gitobj' : '.person') + '&.limit=25'))
          .length
    }
    console.log(
      JSON.stringify({
        kind,
        tracked,
        rows,
        returned: count,
        writeMs,
        backfillMs,
        reads: 50,
        readMs: performance.now() - t,
        statementsPerRead: statements,
      }),
    )
    data[Symbol.dispose]()
  }
}

// Shared benchmark plumbing; importing fleet.ts alone never registers a bench.
import type { Comp } from '@yaks/graph'
import { assertEquals } from '@std/assert'
import '../sqlitepath.ts'
import { Database } from '@db/sqlite'
import { compile, type Driver, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { schema as ftsSchema } from '@yaks/fts'
import { get, storage } from '@yaks/sqlite'
import { options, textFields, vocab, workload } from './fleet.ts'

export function location() {
  let mode = Deno.env.get('BENCH_STORAGE') ?? 'memory'
  if (mode != 'memory' && mode != 'file') {
    throw new Error(`Unknown storage: ${mode}`)
  }
  let dir = mode == 'file'
    ? Deno.makeTempDirSync({ prefix: 'yaks-bench-' })
    : undefined
  return {
    mode,
    path: dir ? `${dir}/graph.sqlite` : ':memory:',
    cleanup: () => {
      if (dir) Deno.removeSync(dir, { recursive: true })
    },
  }
}

/** A driver that prepares every statement afresh: no layer gets a private
 * cache. */
export let perCall = (db: Database): Driver => ({
  query: (s, bound) => {
    let { sql, params } = typeof s == 'string'
      ? { sql: s, params: bound ?? [] }
      : render(s)
    let stmt = db.prepare(sql)
    try {
      return stmt.all(...params)
    } finally {
      stmt.finalize()
    }
  },
  exec: (s) => db.exec(typeof s == 'string' ? s : render(s).sql),
})

export function packageBenches(layer: 'sqlite' | 'sql' | 'query') {
  let loc = location()
  let db = new Database(loc.path)
  addEventListener('unload', () => {
    db.close()
    loc.cleanup()
  })
  db.exec(
    'pragma foreign_keys=on; pragma journal_mode=wal; pragma synchronous=normal',
  )
  let driver = perCall(db)
  let store = storage(driver, vocab, options)
  store.install()
  for (let sql of ftsSchema(textFields)) driver.exec(sql)
  assertEquals(db.prepare('pragma synchronous').get(), { synchronous: 1 })
  if (loc.mode == 'file') {
    assertEquals(db.prepare('pragma journal_mode').get(), {
      journal_mode: 'wal',
    })
  }
  let data = workload()
  store.tx((tx) => tx.patch(data.bundles))
  for (let q of data.queries) {
    let ast = parse(q.query)
    let compiled = compile(ast, vocab, options)
    let read = () => {
      if (layer == 'query') return store.read(q.query)
      let { sql, params } = layer == 'sql'
        ? compile(ast, vocab, options)
        : compiled
      let ids = driver.query(sql, params).map((r) => String(r.eid))
      return get(driver, vocab, ids, options)
    }
    assertEquals(
      read().map((b) => b.entity.eid).sort(),
      [...q.expected].sort(),
      `${layer}: ${q.name}`,
    )
    Deno.bench(`${layer}/${loc.mode}/${q.name}`, () => {
      read()
    })
  }
  let phase = 0
  let write = () => store.tx((tx) => tx.patch(data.batches[phase++ % 2]))
  for (let batch of data.batches) {
    write()
    let rows = store.tx((tx) => tx.get(batch.map((b) => b.entity.eid)))
    assertEquals(
      rows.map((b) => (b.doc as Comp).title),
      batch.map((b) => b.doc.title),
    )
  }
  Deno.bench(`${layer}/${loc.mode}/apply-100`, () => {
    write()
  })
}

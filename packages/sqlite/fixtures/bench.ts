// Shared benchmark plumbing; importing fleet.ts alone never registers a bench.
import type { Comp } from '@yaks/graph'
import { assertEquals } from '@std/assert'
import '../sqlitepath.ts'
import { Database } from '@db/sqlite'
import { compile, type Driver, render, type Stmt } from '@yaks/sql'
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
  query: (s) => {
    let { sql, params } = render(s)
    let stmt = db.prepare(sql)
    try {
      return stmt.all(...params)
    } finally {
      stmt.finalize()
    }
  },
})

/** A file as every bench opens it: keys enforced, WAL, normal sync. */
export let tuned = (db: Database): Driver => {
  let driver = perCall(db)
  let pragmas: Stmt[] = [
    { t: 'pragma', name: 'foreign_keys', value: 'on' },
    { t: 'pragma', name: 'journal_mode', value: 'wal' },
    { t: 'pragma', name: 'synchronous', value: 'normal' },
  ]
  for (let p of pragmas) driver.query(p)
  return driver
}

export function packageBenches(layer: 'sqlite' | 'sql' | 'query') {
  let loc = location()
  let db = new Database(loc.path)
  addEventListener('unload', () => {
    db.close()
    loc.cleanup()
  })
  let driver = tuned(db)
  let store = storage(driver, vocab, options)
  store.install()
  for (let s of ftsSchema(textFields)) driver.query(s)
  let pragma = (name: string) => driver.query({ t: 'pragma', name })[0]
  assertEquals(pragma('synchronous'), { synchronous: 1 })
  if (loc.mode == 'file') {
    assertEquals(pragma('journal_mode'), { journal_mode: 'wal' })
  }
  let data = workload()
  store.tx((tx) => tx.patch(data.bundles))
  for (let q of data.queries) {
    let ast = parse(q.query)
    let compiled = compile(ast, vocab, options)
    let read = () => {
      if (layer == 'query') return store.read(q.query)
      let ids = driver.query(
        layer == 'sql' ? compile(ast, vocab, options) : compiled,
      ).map((r) => String(r.eid))
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

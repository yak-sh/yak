// A worker's bounded eligible read must seek past blocked work, including a
// large ready set. Counting VM work detects scans hidden behind LIMIT 1.
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assert, assertEquals } from '@std/assert'
import { and, limit } from '@yaks/query'
import { compile, insert } from '@yaks/sql'
import { storage } from './mod.ts'
import { test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { effectDoc } from '../effects/docs.ts'
import { ready } from '../effects/ready.ts'
import { driver } from './driver.ts'
import { sqlitePath } from './sqlitepath.ts'

let vocab = loadVocab(effectDoc)
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let future = new Date(2000).toISOString()

let fixture = (n: number, mode: string) => {
  let db = new Database(':memory:')
  let sql = driver((text, params) => {
    let s = db.prepare(text)
    try {
      return s.all(...params)
    } finally {
      s.finalize()
    }
  }, { file: false })
  let old = structuredClone(effectDoc)
  old.$defs!.effect.index = [['handler', 'state']]
  delete old.$defs!.effect.properties!.lease_owner.index
  storage(sql, loadVocab(old)).install()
  for (let first = 1; first <= n; first += 256) {
    let ids = Array.from(
      { length: Math.min(256, n - first + 1) },
      (_, i) => first + i,
    )
    sql.query(insert('entity', ...ids.map((id) => ({ id, eid: `run-${id}` }))))
    sql.query(insert(
      'effect',
      ...ids.map((entity) => ({
        entity,
        handler: 'target',
        state: 'pending',
        next: mode == 'many ready' || entity % 2 ? null : future,
        lease_owner: mode == 'many ready' || !(entity % 2) ? null : 'peer',
        lease_expiry: mode == 'many ready' || !(entity % 2) ? null : future,
      })),
    ))
  }
  if (mode == 'one ready') {
    sql.query(insert('entity', { id: n + 1, eid: 'ready' }))
    sql.query(
      insert('effect', { entity: n + 1, handler: 'target', state: 'pending' }),
    )
  }
  // The first lookup follows installation over a graph with the old index
  // declaration and a populated backlog, as an existing host upgrades.
  storage(sql, vocab).install()
  let q = and(...ready(['target']).clauses, limit(1))
  let query = compile(q, vocab, { now: 1000, unordered: true })
  let plan = sql.query({ t: 'explain query plan', of: query })
    .map((r) => String(r.detail)).join('\n')
  return { db, stmt: db.prepare(query.sql), query, plan }
}

let observed = (f: ReturnType<typeof fixture>) => {
  let stmt = f.stmt
  try {
    let found = stmt.all(...f.query.params)
    let scans = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0)
    let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
    return { found, scans, steps, plan: f.plan }
  } finally {
    stmt.finalize()
    f.db.close()
  }
}

for (let mode of ['idle blocked', 'one ready', 'many ready']) {
  for (let n of [64, 4096]) {
    let { found, scans, steps, plan } = observed(fixture(n, mode))
    test(`${mode}: an effects lookup stays bounded across ${n} pending rows`, () => {
      assertEquals(found.length, mode == 'idle blocked' ? 0 : 1)
      if (mode == 'one ready') assertEquals(found[0].eid, 'ready')
      assert(scans < 20, `${scans} scan advances\n${plan}`)
      assert(steps < 2000, `${steps} VM steps\n${plan}`)
    })
  }
}

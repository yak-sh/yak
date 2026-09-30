// The check: an index nobody is building, one that was just written, and hosts
// where every search reads every vector.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { col, type Driver, eq, val } from '@yaks/sql'
import { mem, none, shelf, stocked } from './testing.ts'
import { TABLE } from './ddl.ts'
import { build, install } from './native.ts'
import { type Options, runs } from './tools.ts'

// The offline embedder stands in for a host whose config is complete: what
// these cases are about is the index, not what is missing.
let checkup = async (
  sql: Driver,
  options: Options = {},
) => {
  let [said] = await runs({ sql, graph: none }, {
    embedder: { provider: 'hash' },
    ...options,
  }).vector_check(
    { entity: { eid: 'c1' }, call: { args: {} } },
    {} as Graph,
  ) as Bundle[]
  return {
    body: String((said.content as Comp).body),
    level: (said.error as Comp | undefined)?.code,
  }
}

// Move every vector's timestamp back, the way vectors nobody has touched for
// hours look.
let aged = (sql: Driver, hours: number) => {
  sql.query({
    t: 'update',
    table: TABLE,
    set: { at: val(new Date(Date.now() - hours * 3_600_000).toISOString()) },
  })
  return sql
}

let installed = async () => {
  let db = await stocked()
  install(db)
  return db
}

test('an index the sweep built is nothing to report', async () => {
  let db = await installed()
  build(db)
  assertEquals((await checkup(aged(db, 3))).level, undefined)
})

test('an index behind for longer than the sweep takes is a fail', async () => {
  let said = await checkup(aged(await installed(), 3))
  assertEquals(said.level, 'fail')
  assert(said.body.includes('owed a build since'), said.body)
  assert(said.body.includes('nothing building it'), said.body)
})

test('a build owed moments ago is the sweep having its turn', async () => {
  assertEquals((await checkup(await installed())).level, undefined)
})

test('an empty table is not a stalled index', async () => {
  assertEquals((await checkup(shelf())).level, undefined)
})

// The same database as a file other processes may have open.
let shared = (db: Driver): Driver => ({ ...db, file: true })

test('where every search reads every vector, it says why', async () => {
  let bare = await checkup(shared(await stocked()))
  assertEquals(bare.level, 'warn')
  assert(bare.body.includes('not installed'), bare.body)
  let db = await installed()
  db.query({
    t: 'update',
    table: TABLE,
    set: { model: val('next') },
    where: eq(col('owner'), val(4)),
  })
  let two = await checkup(shared(db))
  assertEquals(two.level, 'warn')
  assert(two.body.includes('two models'), two.body)
})

test('a database this process alone has open draws no warning', async () => {
  assertEquals((await checkup(await stocked())).level, undefined)
})

test('a host still waiting for its config says what it is waiting for', async () => {
  let said = await checkup(shelf(), { embedder: undefined })
  assertEquals(said.level, 'warn')
  assert(said.body.includes('no `embedder` is named'), said.body)
  let key = await checkup(shelf(), {
    embedder: { provider: 'gpu', model: 'qwen3', key: undefined },
  })
  assertEquals(key.level, 'warn')
  assert(key.body.includes('waiting for a key'), key.body)
})

test('a host with no vector table says so rather than passing', async () => {
  let said = await checkup(mem())
  assertEquals(said.level, 'warn')
  assert(said.body.includes('keeps no vector table'), said.body)
})

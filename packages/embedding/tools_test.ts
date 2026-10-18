// The check: an index nobody is building, one that was just written, and hosts
// where every search reads every vector.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { col, eq, type Statements, val } from '@yaks/sql'
import { mem, none, shelf, stocked } from './testing.ts'
import { schema, TABLE } from './ddl.ts'
import { install, prepare } from './native.ts'
import { type Options, runs } from './tools.ts'

// The offline embedder stands in for a host whose config is complete: what
// these cases are about is the index, not what is missing.
// Scenarios perform their reads and writes while fixtures load; a failed
// assertion is kept for the runner to report with the case that produced it.
let scene = async (run: () => void | Promise<void>) => {
  try {
    await run()
    return () => {}
  } catch (error) {
    return () => {
      throw error
    }
  }
}

let checkup = async (
  sql: Statements,
  options: Options = {},
) => {
  let [said] = await runs({ storage: { statements: sql }, graph: none }, {
    embedder: { provider: 'hash' },
    ...options,
  }).vector_check(
    { entity: { eid: 'c1' }, call: { args: {} } },
    {} as Graph,
  ) as Bundle[]
  return {
    body: String((said.content as Comp).body),
    level: (said.finding as Comp | undefined)?.level,
  }
}

// Move every vector's timestamp back, the way vectors nobody has touched for
// hours look.
let aged = (sql: Statements, hours: number) => {
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

test(
  'old vectors need no index rebuild',
  await scene(async () => {
    let db = await installed()
    prepare(db)
    assertEquals((await checkup(aged(db, 3))).level, undefined)
  }),
)

// The check needs an empty vector table, not books waiting to be embedded.
let empty = mem()
for (let stmt of schema()) empty.query(stmt)
test(
  'an empty table is not a stalled index',
  await scene(async () => {
    assertEquals((await checkup(empty)).level, undefined)
  }),
)

// The same database as a file other processes may have open.
let shared = (db: Statements): Statements => ({ ...db, ownership: 'shared' })

test(
  'where every search reads every vector, it says why',
  await scene(async () => {
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
  }),
)

test(
  'a database this process alone has open draws no warning',
  await scene(async () => {
    assertEquals((await checkup(await stocked())).level, undefined)
  }),
)

test(
  'a host still waiting for its config says what it is waiting for',
  await scene(async () => {
    let said = await checkup(shelf(), { embedder: undefined })
    assertEquals(said.level, 'warn')
    assert(said.body.includes('no `embedder` is named'), said.body)
    let key = await checkup(shelf(), {
      embedder: { provider: 'gpu', model: 'qwen3', key: undefined },
    })
    assertEquals(key.level, 'warn')
    assert(key.body.includes('waiting for a key'), key.body)
  }),
)

test(
  'a host with no vector table says so rather than passing',
  await scene(async () => {
    let said = await checkup(mem())
    assertEquals(said.level, 'warn')
    assert(said.body.includes('keeps no vector table'), said.body)
  }),
)

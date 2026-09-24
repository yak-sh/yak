// The check: an index nobody is rebuilding, one that was just written, and a
// host with no index at all.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Driver } from './driver.ts'
import { mem, shelf, stocked } from './harness.ts'
import { TABLE } from './ddl.ts'
import { clean } from './mark.ts'
import { type Options, runs } from './tools.ts'

// The offline embedder stands in for a host whose config is complete: what
// these cases are about is the mark, not what is missing.
let checkup = async (
  sql: Driver,
  options: Options = {},
) => {
  let [said] = await runs({ sql }, {
    embedder: { via: 'hash' },
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

// Move every vector's timestamp back, the way an index nobody has touched for
// an hour looks.
let aged = (sql: Driver, hours: number) => {
  sql.query(`update "${TABLE}" set at = ?`, [
    new Date(Date.now() - hours * 3_600_000).toISOString(),
  ])
  return sql
}

Deno.test('an index the sweep cleaned is nothing to report', async () => {
  let sql = aged(await stocked(), 3)
  clean(sql)
  assertEquals((await checkup(sql)).level, undefined)
})

Deno.test('a mark that outlived the sweep is a fail', async () => {
  let said = await checkup(aged(await stocked(), 3))
  assertEquals(said.level, 'fail')
  assert(said.body.includes('owed a rebuild since'), said.body)
  assert(said.body.includes('nothing '), said.body)
})

Deno.test('a mark set moments ago is the sweep having its turn', async () => {
  assertEquals((await checkup(await stocked())).level, undefined)
})

Deno.test('an empty index is not a stalled one', async () => {
  assertEquals((await checkup(shelf())).level, undefined)
})

Deno.test('a host still waiting for its config says what it is waiting for', async () => {
  let said = await checkup(shelf(), { embedder: undefined })
  assertEquals(said.level, 'warn')
  assert(said.body.includes('no `embedder` is named'), said.body)
  let key = await checkup(shelf(), {
    embedder: {
      via: 'ollama',
      model: 'qwen3',
      base: 'https://box',
      key: undefined,
    },
  })
  assertEquals(key.level, 'warn')
  assert(key.body.includes('waiting for a key'), key.body)
})

Deno.test('a host with no vector table says so rather than passing', async () => {
  let said = await checkup(mem())
  assertEquals(said.level, 'warn')
  assert(said.body.includes('keeps no vector table'), said.body)
})

// Schema-dependent embedding decisions stay valid only until DDL or rollback;
// data writes do not require inspecting the catalog again.
import { assertEquals, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { type Driver, insert, render } from '@yaks/sql'
import { open } from '@yaks/sqlite/db'
import { unit } from '../sqlite/unit.ts'
import { BOOKSHOP } from '../sqlite/testing.ts'
import { fields } from './fields.ts'
import { schema } from './ddl.ts'
import { watch } from './owed.ts'
import { installed } from './native.ts'
import { shelf, shop } from './testing.ts'

let text = fields(shop)
let metadata = () => ({
  t: 'create table' as const,
  name: '_sqliteai_vector',
  cols: [{ name: 'x' }],
})
let dropMetadata = () => ({
  t: 'drop' as const,
  kind: 'table' as const,
  name: '_sqliteai_vector',
})
let dropTrigger = () => ({
  t: 'drop' as const,
  kind: 'trigger' as const,
  name: 'embedding_owed_book_insert',
})

let exercise = (d: Driver, mutate: Driver = d) => {
  watch(d, text)
  assertEquals(installed(d), false)
  mutate.query(metadata())
  assertEquals(installed(d), true)
  mutate.query(dropMetadata())
  assertEquals(installed(d), false)
  mutate.query(dropTrigger())
  assertEquals(watch(d, text), true)
  assertEquals(watch(d, text), false)
}

test('embedding schema inspection stops across unchanged fields and data writes', () => {
  let d = shelf()
  watch(d, text)
  installed(d)
  let query = d.query, calls = 0
  d.query = (s) => {
    calls++
    return query(s)
  }
  for (let i = 0; i < 20; i++) {
    // A caller may reconstruct the same fields for every pass.
    assertEquals(watch(d, fields(shop)), false)
    assertEquals(installed(d), false)
  }
  assertEquals(calls, 0)
  d.query(insert('review', { entity: 1, prose: 'More words' }))
  calls = 0
  assertEquals(watch(d, text), false)
  assertEquals(installed(d), false)
  assertEquals(calls, 0)
})

test('embedding schema decisions observe DDL through query and run', () => {
  let d = shelf()
  d.run = (s) => {
    d.query(s)
    return 0
  }
  let throughRun: Driver = {
    query: (s) => {
      d.run!(s)
      return []
    },
  }
  exercise(d, throughRun)
})

test('embedding schema decisions observe rendered and unannotated SQL changes', () => {
  for (let annotated of [true, false]) {
    let d = shelf()
    let raw: Driver = {
      query: (s) => {
        let stmt = render(s)
        if (!annotated) delete stmt.origin
        return d.query(stmt)
      },
    }
    exercise(d, raw)
  }
})

test('embedding snapshots taken in a rolled back transaction are discarded', () => {
  let d = shelf()
  watch(d, text)
  installed(d)
  assertThrows(() =>
    unit(d, () => {
      d.query(metadata())
      assertEquals(installed(d), true)
      d.query(dropTrigger())
      assertEquals(watch(d, fields(shop, (p) => p.prop == 'title')), true)
      throw new Error('undo')
    })
  )
  assertEquals(installed(d), false)
  // The original triggers returned on rollback: no requeue or DDL is needed.
  assertEquals(watch(d, text), false)
  d.query(dropTrigger())
  assertEquals(watch(d, text), true)
})

test('embedding snapshots taken inside driver-owned rollback are discarded', () => {
  let d = shelf()
  d.tx = (body) => {
    d.query({ t: 'begin' })
    try {
      let out = body()
      d.query({ t: 'commit' })
      return out
    } catch (error) {
      d.query({ t: 'rollback' })
      throw error
    }
  }
  watch(d, text)
  assertEquals(installed(d), false)
  assertThrows(() =>
    d.tx!(() => {
      d.query(metadata())
      assertEquals(installed(d), true)
      throw new Error('undo')
    })
  )
  assertEquals(installed(d), false)
  assertEquals(watch(d, text), false)
})

test('embedding schema decisions observe file peer changes', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'T-65847-schema-' })
  let a = open(`${dir}/test.db`), b = open(`${dir}/test.db`)
  try {
    for (let stmt of [...BOOKSHOP, ...schema()]) a.query(stmt)
    exercise(a, b)
  } finally {
    a.close()
    b.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

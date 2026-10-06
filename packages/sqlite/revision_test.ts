import { assert, assertEquals, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { insert } from '@yaks/sql'
import { open } from './db.ts'
import { mem } from './testing.ts'
import { revision } from '@yaks/sql'
import { unit } from './unit.ts'

let table = (name: string) => ({
  t: 'create table' as const,
  name,
  cols: [{ name: 'entity', type: 'integer', pk: true }],
})

test('snapshot revisions read no SQL on a single-owner connection', () => {
  let d = mem()
  let schema = revision(d, 'schema'), catalog = revision(d, 'catalog')
  let query = d.query, calls = 0
  d.query = (s) => {
    calls++
    return query(s)
  }
  for (let i = 0; i < 100; i++) {
    assertEquals(revision(d, 'schema'), schema)
    assertEquals(revision(d, 'catalog'), catalog)
  }
  assertEquals(calls, 0)
  d.query(table('entity'))
  assert(revision(d, 'schema') > schema)
  schema = revision(d, 'schema')
  catalog = revision(d, 'catalog')
  d.query(insert('entity', { entity: 1 }))
  assertEquals(revision(d, 'schema'), schema)
  assert(revision(d, 'catalog') > catalog)
})

test('snapshot revisions invalidate snapshots made inside a rolled back savepoint', () => {
  let d = mem(), inside = 0
  revision(d, 'schema')
  assertThrows(() =>
    unit(d, () => {
      d.query(table('temporary'))
      inside = revision(d, 'schema')
      throw new Error('undo')
    })
  )
  assert(revision(d, 'schema') > inside)
})

test('snapshot revisions observe other file connections without catalog scans', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'T-65691-revision-' })
  let a = open(`${dir}/test.db`), b = open(`${dir}/test.db`)
  try {
    let schema = revision(a, 'schema')
    b.query(table('entity'))
    assert(revision(a, 'schema') > schema)
    schema = revision(a, 'schema')
    let catalog = revision(a, 'catalog')
    b.query(insert('entity', { entity: 1 }))
    assertEquals(revision(a, 'schema'), schema)
    assert(revision(a, 'catalog') > catalog)
  } finally {
    a.close()
    b.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

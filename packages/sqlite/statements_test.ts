// Storage capabilities share graph transactions and observe other hosts.
import { equal, ok, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { insert, select, table } from '@yaks/sql'
import { open } from './db.ts'
import { storage } from './mod.ts'
import { statements } from './statements.ts'

test('statement writes roll back with the graph transaction and nested units', () => {
  let driver = open(':memory:')
  try {
    let store = storage(driver, loadVocab(docDoc))
    store.install()
    let sql = store.statements
    equal(statements(driver), sql)
    sql.query({
      t: 'create table',
      name: 'index_rows',
      cols: [{ name: 'value', type: 'text' }],
    })
    let before = sql.revision('data')
    assertThrows(
      () =>
        store.tx(() => {
          sql.atomic(() =>
            sql.query(insert('index_rows', { value: 'discard' }))
          )
          throw new Error('rollback')
        }),
      Error,
      'rollback',
    )
    equal(sql.query(select({ from: table('index_rows') })), [])
    ok(sql.revision('data') > before)
    assertThrows(
      () => sql.query({ t: 'begin' }),
      Error,
      'storage owns transactions',
    )
  } finally {
    driver.close()
  }
})

test('shared statement revisions observe another host committing', () => {
  let dir = Deno.makeTempDirSync()
  let a = open(`${dir}/graph.db`)
  let b = open(`${dir}/graph.db`)
  try {
    let first = statements(a)
    let second = statements(b)
    first.query({
      t: 'create table',
      name: 'index_rows',
      cols: [{ name: 'value', type: 'text' }],
    })
    equal(first.ownership, 'shared')
    let before = first.revision('data')
    second.atomic(() =>
      second.query(insert('index_rows', { value: 'committed' }))
    )
    ok(first.revision('data') > before)
    equal(first.query(select({ from: table('index_rows') })), [{
      value: 'committed',
    }])
  } finally {
    a.close()
    b.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

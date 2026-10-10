import { equal, test } from '@yaks/testing'
import { as, col, eq, lit, render, select, table, val, when } from './mod.ts'

test('vacuum binds its destination as a value', () => {
  let into = "/tmp/copy's database.db"
  let { sql, params } = render({ t: 'vacuum', into })
  equal({ sql, params }, { sql: 'vacuum into ?', params: [into] })
  let bare = render({ t: 'vacuum' })
  equal({ sql: bare.sql, params: bare.params }, { sql: 'vacuum', params: [] })
})

test('a kept tree renders again around the values bound this time', () => {
  let label = as(
    when([[eq(col('kind'), lit('task')), lit('work')]], lit('other')),
    'label',
  )
  let asked = (v: string) => {
    let { sql, params } = render(
      select({ cols: [label], from: table('t'), where: eq(col('id'), val(v)) }),
    )
    return { sql, params }
  }
  let sql = `select case when "kind" = 'task' then 'work' else 'other' end ` +
    `as "label" from "t" where "id" = ?`
  equal(asked('a'), { sql, params: ['a'] })
  equal(asked('b'), { sql, params: ['b'] })
})

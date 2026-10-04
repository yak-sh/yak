// Count physical settlement writes and verify successful runs disappear.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { as, type Driver, fn, select } from '@yaks/sql'
import { effects } from './registry.ts'
import { pooledBlog } from './testing.ts'

let changes = (sql: Driver) =>
  Number(sql.query(select({ cols: [as(fn('total_changes'), 'n')] }))[0].n)

test('success removes a run without writing a done effect row; failures remain readable', async () => {
  let sql = open(':memory:')
  let writes = 0
  let counted: Driver = {
    ...sql,
    query: (s) => {
      let before = changes(sql), rows = sql.query(s)
      if (s.t == 'update' && s.table == 'effect' && s.set.state) {
        writes += changes(sql) - before
      }
      return rows
    },
  }
  let db = storage(counted, pooledBlog)
  db.install()
  let fx = effects(pooledBlog, {
    singleOwner: true,
    backoff: () => 0,
    report: () => {},
    write: (b) => g.apply(b, { trusted: true }),
  })
  let g = graph({ storage: db, vocab: pooledBlog, plugins: [fx] })
  fx.handle({ post_note: () => {} })
  try {
    await g.apply([{ entity: { eid: 'post' }, post: { title: 'First' } }])
    writes = 0
    await fx.work(g)
    equal(writes, 0)
    equal(await g.read('.effect'), [])
    fx.handle({
      post_note: () => {
        throw Error('keep this failure')
      },
    })
    await g.apply([{ entity: { eid: 'post' }, post: { published: true } }])
    await fx.work(g)
    await fx.work(g)
    let [failure] = await g.read('.effect')
    equal((failure.effect as { error: string }).error, 'keep this failure')
  } finally {
    await fx.idle()
    sql.close()
  }
})

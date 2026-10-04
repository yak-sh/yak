// Count physical effect writes, not just the runs left after a worker drains.
import { equal, test } from '@yaks/testing'
import { type Comp, graph } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { effects } from '@yaks/effects'
import { effectDoc } from '@yaks/effects/vocab'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { as, type Driver, fn, select } from '@yaks/sql'
import { durable } from '../durable-object/testing.ts'
import { driver } from '../durable-object/sql.ts'
import { isPromise } from '@yaks/fp'
import { workshop } from './testing.ts'
import { plugins } from './graph.ts'
import { watches } from './effects.ts'
import { reconcile } from './build.ts'

let changes = (sql: Driver): number =>
  Number(
    sql.query(select({
      cols: [as(fn('total_changes'), 'n')],
    }))[0].n,
  )

test('ordinary player writes with an immediate builder write zero effect rows', async () => {
  let vocab = workshop([effectDoc])
  let sql = open(':memory:')
  let effectWrites = 0
  let counted: Driver = {
    ...sql,
    query: (s) => {
      let before = changes(sql)
      let rows = sql.query(s)
      if (
        s.t == 'insert' && s.into == 'effect' ||
        s.t == 'update' && s.table == 'effect'
      ) effectWrites += changes(sql) - before
      return rows
    },
  }
  let db = storage(counted, vocab)
  db.install()
  let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({ storage: db, vocab, plugins: [...plugins(), fx] })
  fx.handle(watches({ vocab }))
  try {
    await g.apply([
      { entity: { eid: toolEid('code') }, tool: { name: 'code' } },
      {
        entity: { eid: 'builder' },
        builder: {
          query: '.doc.title=Source',
          to: toolEid('code'),
          immediate: true,
        },
      },
    ])
    // Establish dependencies without starting a worker; all future owed runs stay
    // visible, and there are no asynchronous settling writes to hide the cost.
    let [builder] = await g.get(['builder'])
    let planned = await db.tx((tx) => reconcile(tx, builder, { vocab }))
    await g.apply(planned.writes, { trusted: true })
    effectWrites = 0
    for (let i = 0; i < 20; i++) {
      await g.apply([{
        entity: { eid: 'player' },
        doc: { title: 'Player', body: `step ${i}` },
      }])
    }
    equal(effectWrites, 0)
  } finally {
    sql.close()
  }
})

// Workerd commits transactionSync as soon as its callback returns. An async
// plan would commit the player write before the builder's owed call.
test('matching input changes reconcile inside transactionSync', () => {
  let vocab = workshop([effectDoc])
  let held = durable()
  let db = storage(driver(held), vocab)
  db.install()
  let g = graph({ storage: db, vocab, plugins: plugins() })
  g.apply([
    { entity: { eid: toolEid('code') }, tool: { name: 'code' } },
    {
      entity: { eid: 'builder' },
      builder: {
        query: '.doc.title=Source',
        to: toolEid('code'),
        immediate: true,
      },
    },
  ])
  let [builder] = g.get(['builder']) as import('@yaks/graph').Bundle[]
  let plan = db.tx((tx) => reconcile(tx, builder, { vocab }))
  equal(isPromise(plan), false)
  g.apply((plan as { writes: import('@yaks/graph').Bundle[] }).writes, {
    trusted: true,
  })
  let wrote = g.apply([{
    entity: { eid: 'source' },
    doc: { title: 'Source', body: 'first' },
  }])
  equal(isPromise(wrote), false)
  let calls = g.read('.call') as import('@yaks/graph').Bundle[]
  equal(calls.length, 1)
  g.apply([{ entity: { eid: 'source' }, doc: { body: 'second' } }])
  equal((g.read('.call') as import('@yaks/graph').Bundle[]).length, 2)
  g.apply([{ entity: { eid: 'source' }, $delete: true }])
  equal(
    ((g.read('.build') as import('@yaks/graph').Bundle[])[0].build as Comp)
      .stale,
    true,
  )
})

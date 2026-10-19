// Count physical effect writes, not just the runs left after a worker drains.
import { equal, test } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
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
import { code } from './code.ts'
import { changing } from './change.ts'
import type { And } from '@yaks/query'

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
// plan would commit the player write before the builder's owed call, or
// before the output a code tool answers in place.
test('matching input changes reconcile inside transactionSync', () => {
  let vocab = workshop([effectDoc])
  let held = durable()
  let db = storage(driver(held), vocab)
  db.install()
  let echo = code({
    name: 'echo',
    description: 'Say the body back',
    answer: ({ binding }) => ({
      outputs: [{
        slot: 'main',
        inputs: [binding.entities[0]],
        components: { doc: { body: binding.vars.body } },
      }],
    }),
  })
  let here = { vocab, tools: [echo] }
  let g = graph({ storage: db, vocab, plugins: plugins(null, here) })
  let builder = (eid: string, tool: string): Bundle => ({
    entity: { eid },
    builder: {
      query: '.doc.title=Source, doc.body=$body',
      to: toolEid(tool),
      immediate: true,
    },
  })
  g.apply([
    { entity: { eid: toolEid('code') }, tool: { name: 'code' } },
    builder('builder', 'code'),
    builder('placed', 'echo'),
  ])
  for (let b of g.get(['builder', 'placed']) as Bundle[]) {
    let plan = db.tx((tx) => reconcile(tx, b, here))
    equal(isPromise(plan), false)
    g.apply((plan as { writes: Bundle[] }).writes, { trusted: true })
  }
  let read = (q: string) => g.read(`${q}&*`) as Bundle[]
  let said = () => read('.built&.chosen').map((b) => (b.doc as Comp).body)
  let wrote = g.apply([{
    entity: { eid: 'source' },
    doc: { title: 'Source', body: 'first' },
  }])
  equal(isPromise(wrote), false)
  // No runner holds either tool: the call waits for one, and the code
  // answered in place left no output or result record beside its take.
  equal([read('.call&!execution').length, said()], [1, ['first']])
  equal(read('.output').length + read('.result').length, 0)
  g.apply([{ entity: { eid: 'source' }, doc: { body: 'second' } }])
  equal([read('.call&!execution').length, said()], [2, ['second']])
  g.apply([{ entity: { eid: 'source' }, $delete: true }])
  equal(read('.build&.build.stale=true').length, 2)
})

let sourceQueries: And[] = []
let sourceTx = {
  read: (q: And) => {
    sourceQueries.push(q)
    return []
  },
} as unknown as Parameters<ReturnType<typeof changing>>[1]
let sourceHook = changing(workshop())

test('an unrelated batch probes each dependency source without reading an arbitrary owner', () => {
  sourceQueries = []
  let writes = [
    { entity: { eid: 'one' }, doc: { title: 'One' } },
    { entity: { eid: 'two' }, doc: { title: 'Two' } },
    { entity: { eid: 'one' }, doc: { body: 'Again' } },
  ]
  equal(sourceHook(writes, sourceTx), writes)
  equal(
    sourceQueries.flatMap((q) =>
      q.clauses.map((c) =>
        c.kind == 'pred' && c.path.join('.') == 'builder_dep.source' &&
          c.value?.kind == 'scalar'
          ? c.value.raw
          : null
      )
    ),
    ['entity:one', 'component:*', 'component:doc', 'entity:two'],
  )
})

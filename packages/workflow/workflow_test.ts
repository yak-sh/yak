// Steps through the graph's doors: a store with a journal, steps written as
// rows, and what writing to it makes. A call is answered the way any runner
// answers one, by writing its `result`; a person's step is a task they
// complete.

import { equal, test } from '@yaks/testing'
import { whole } from '@yaks/query'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { backed, ddl, journal, log } from '@yaks/journal'
import { journalDoc } from '@yaks/journal/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { tick, wakeDoc, wakes } from '@yaks/wake'
import { loadVocab, metaDoc } from '@yaks/vocab'
import { feeds, outdated, rerun, steps, workflowDoc, workflows } from './mod.ts'

let shop = {
  $defs: {
    order: { component: true, properties: { item: { type: 'string' } } },
    shipment: {
      component: true,
      properties: { order: { type: 'string', ref: 'order', death: 'keep' } },
    },
    task: { component: true },
    filed: {
      component: true,
      properties: { assignee: { type: 'string', ref: 'entity' } },
    },
    completed: {
      component: true,
      properties: { at: { type: 'string', format: 'date-time' } },
    },
    note: { component: true, properties: { text: { type: 'string' } } },
    person: { component: true },
    contains: { component: true, edge: true },
    requires: { component: true, edge: true },
  },
}
let vocab = loadVocab(
  [workflowDoc, docDoc, edgeDoc, toolsDoc, wakeDoc, journalDoc, metaDoc, shop],
  [edgeKeywords],
)

let fixture = () => {
  let db = open(':memory:')
  let store = storage(db, vocab, { backed: backed(vocab) })
  store.install()
  for (let s of ddl()) db.query(s)
  // ada writes and bea is assigned work, people the store knows; and the
  // store describes the components the journal's changes name, as a host
  // does at start.
  graph({ storage: store, vocab }).apply([
    { entity: { eid: 'ada' }, person: {} },
    { entity: { eid: 'bea' }, person: {} },
    ...['step', 'made', 'call'].map((name) => ({
      entity: { eid: '$' + name },
      _comp: { name },
    })),
  ], { trusted: true })
  let g = graph({
    storage: store,
    vocab,
    actor: { by: 'ada' },
    plugins: [
      journal(log({ rows: (s) => db.query(s) }), vocab),
      edges(vocab),
      wakes(),
      workflows(),
    ],
  })
  let apply = async (b: Bundle[]) => await g.apply(b)
  let read = async (q: string) => await g.read(whole(q))
  // A workflow holding these steps, each `{eid, ...step}`.
  let flow = (w: string, ...list: (Comp & { eid: string })[]) =>
    apply([
      { entity: { eid: w }, workflow: {}, doc: { title: w } },
      ...list.map(({ eid, ...step }) => ({ entity: { eid }, step })),
      ...list.map((s) => link(w, 'contains', s.eid)),
    ])
  return { g, apply, read, flow }
}

// Step 1 calls a tool for each order; step 2 ships once the call is answered.
let ask = {
  eid: 'ask',
  match: '$o .order',
  write: [{
    entity: { eid: '$c' },
    call: { name: 'pack', args: { order: '$o' } },
  }],
}
let ship = {
  eid: 'ship',
  match:
    '$r .result, result.call=$c; $c .call, made.case=$k; $k .case, case.for=$o',
  write: [{ entity: { eid: '$s' }, shipment: { order: '$o' } }],
  when: 'write',
}

test('a step calls out, and the next matches its answer', async () => {
  let { g, apply, read, flow } = fixture()
  await flow('orders', ask, ship)
  await apply([{
    entity: { eid: 'o1' },
    order: { item: 'kettle' },
    $actor: { by: 'bea' },
  }])
  let [call] = await read('.call&?made')
  equal(call.call, { name: 'pack', args: { order: 'o1' } })
  // Written after the order's write committed, as the order's writer (not the
  // graph's own actor), so a runner gives the call her authority.
  let [change] = await read(
    `._change.component=call, _change.target=${call.entity.eid}`,
  )
  let [tx] = await g.get([(change._change as Comp).tx as string])
  equal((tx._tx as Comp).by, 'bea')
  let [kase] = await read('.case')
  equal(kase.case, { workflow: 'orders', for: 'o1' })
  equal(call.made, { case: kase.entity.eid, step: 'ask' })
  equal(await read('.shipment'), [])

  // Whoever answers the call writes its result; the shipment is made in that
  // same write, for the same case.
  await apply([{ entity: { eid: 'r1' }, result: { call: call.entity.eid } }])
  let [shipped] = await read('.shipment&?made')
  equal(shipped.shipment, { order: 'o1' })
  equal(shipped.made, { case: kase.entity.eid, step: 'ship' })

  // Touching the order again starts nothing: the case has its call.
  await apply([{ entity: { eid: 'o1' }, order: { item: 'teapot' } }])
  equal((await read('.call')).length, 1)
  equal((await read('.case')).length, 1)
})

test('a person’s step is a task, and the next step matches its completion', async () => {
  let { apply, read, flow } = fixture()
  await flow('orders', {
    eid: 'pack',
    match: '$o .order',
    write: [{
      entity: { eid: '$t' },
      task: {},
      doc: { title: 'Pack the order' },
      filed: { assignee: 'bea' },
    }],
    when: 'write',
  }, {
    eid: 'send',
    match: '$t .task, .completed, made.case=$k; $k .case, case.for=$o',
    write: [{ entity: { eid: '$s' }, shipment: { order: '$o' } }],
  })
  await apply([{ entity: { eid: 'o1' }, order: {} }])
  let [task] = await read('.task&?filed')
  equal(task.filed, { assignee: 'bea' })
  equal(await read('.shipment'), [])
  await apply([{
    entity: task.entity,
    completed: { at: '2026-11-27T00:00:00Z' },
  }])
  let [shipped] = await read('.shipment&?made')
  equal(shipped.shipment, { order: 'o1' })
  equal((shipped.made as Comp).step, 'send')
})

test('a bare step writes no case and no made', async () => {
  let { apply, read } = fixture()
  await apply([{
    entity: { eid: 'label' },
    step: {
      match: '$o .order, !order.item',
      write: [{ entity: { eid: '$o' }, order: { item: 'unnamed' } }],
      when: 'write',
    },
  }])
  await apply([{ entity: { eid: 'o1' }, order: {} }])
  equal((await read('.order'))[0].order, { item: 'unnamed' })
  equal(await read('.case'), [])
  equal(await read('.made'), [])
})

test('editing a step leaves what it made, which reads as outdated', async () => {
  let { g, apply, read, flow } = fixture()
  await flow('orders', ask)
  await apply([{ entity: { eid: 'o1' }, order: {} }])
  equal(await outdated(g, 'ask'), [])
  let [old] = await read('.call&?made')

  await apply([{
    entity: { eid: 'ask' },
    step: {
      write: [{
        entity: { eid: '$c' },
        call: { name: 'wrap', args: { order: '$o' } },
      }],
    },
  }])
  equal((await read('.call')).map((c) => c.call), [old.call])
  equal(await outdated(g, 'ask'), [old.entity.eid])

  // A new order gets the new call; the old one stays as it was until rerun.
  await apply([{ entity: { eid: 'o2' }, order: {} }])
  let names = async () =>
    (await read('.call')).map((c) => (c.call as Comp).name).sort()
  equal(await names(), ['pack', 'wrap'])
  equal(await outdated(g, 'ask'), [old.entity.eid])

  let kase = (old.made as Comp).case as string
  await rerun(g, 'ask', [kase])
  equal(await names(), ['pack', 'wrap', 'wrap'])
  equal((await read(`.made.case=${kase}`)).length, 2)
})

test('a step with a wake runs when it fires, over the whole graph', async () => {
  let { g, apply, read } = fixture()
  await apply([
    { entity: { eid: 'o1' }, order: {} },
    { entity: { eid: 'o2' }, order: {} },
  ])
  await apply([{
    entity: { eid: 'remind' },
    step: {
      match: '$o .order, !order.item',
      write: [{ entity: { eid: '$n' }, note: { text: '$o' } }],
    },
    wake: { at: '2026-11-27T00:00:00Z' },
  }])
  equal(await read('.note'), [])
  await tick(g, Date.parse('2026-11-27T01:00:00Z'))
  equal((await read('.note')).map((n) => (n.note as Comp).text).sort(), [
    'o1',
    'o2',
  ])
})

test('the map follows matches and writes, and requires edges', async () => {
  let { g, apply, flow } = fixture()
  let bill = { eid: 'bill', match: '$s .shipment', write: [] }
  await flow('orders', ask, ship, bill)
  await apply([link('bill', 'requires', 'ask')])
  let held = await steps(g.outside)
  let requires = (await g.read(whole('.requires&?edge'))).map((e) =>
    e.edge as Comp
  )
  let mapped = held.map((s) => ({
    ...s,
    requires: requires.filter((r) => r.from == s.eid).map((r) =>
      r.to as string
    ),
  }))
  equal(feeds(mapped, vocab), [
    { from: 'ask', to: 'ship', by: 'data' },
    { from: 'ship', to: 'bill', by: 'data' },
    { from: 'ask', to: 'bill', by: 'requires' },
  ])
})

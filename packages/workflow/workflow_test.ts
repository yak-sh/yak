// Steps through the graph's doors (./testing.ts): a store with a journal,
// steps written as rows, and what writing to it makes.

import { equal, test } from '@yaks/testing'
import { whole } from '@yaks/query'
import type { Comp } from '@yaks/graph'
import { link } from '@yaks/edge'
import { tick } from '@yaks/wake'
import { bindingKey, feeds, outdated, rerun, steps } from './mod.ts'
import { ask, fixture, process, ship, vocab } from './testing.ts'

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
  let [kase] = await read('.workflow_case')
  equal(kase.workflow_case, { workflow: 'orders', for: 'o1' })
  let { binding: _b, ...made } = call.made as Comp
  equal(made, { case: kase.entity.eid, step: 'ask' })
  equal(await read('.shipment'), [])

  // Whoever answers the call writes its result; the shipment is made in that
  // same write, for the same case.
  await apply([{ entity: { eid: 'r1' }, result: { call: call.entity.eid } }])
  let [shipped] = await read('.shipment&?made')
  equal(shipped.shipment, { order: 'o1' })
  let { binding: _s, ...shipMade } = shipped.made as Comp
  equal(shipMade, { case: kase.entity.eid, step: 'ship' })

  // Touching the order again starts nothing: the case has its call.
  await apply([{ entity: { eid: 'o1' }, order: { item: 'teapot' } }])
  equal((await read('.call')).length, 1)
  equal((await read('.workflow_case')).length, 1)
})

test('a step runs again for its case when a value it bound changes', async () => {
  let { apply, read, flow } = fixture()
  await flow('orders', {
    ...ask,
    match: '$o .order, order.item=$item',
    write: [{
      entity: { eid: '$c' },
      call: { name: 'pack', args: { order: '$o', item: '$item' } },
    }],
  })
  let items = async () =>
    (await read('.call')).map((c) => (c.call as Comp).args).map((a) =>
      (a as Comp).item
    ).sort()
  await apply([{ entity: { eid: 'o1' }, order: { item: 'kettle' } }])
  await apply([{ entity: { eid: 'o1' }, order: { item: 'kettle' }, note: {} }])
  equal(await items(), ['kettle'])
  await apply([{ entity: { eid: 'o1' }, order: { item: 'teapot' } }])
  equal(await items(), ['kettle', 'teapot'])
  equal((await read('.workflow_case')).length, 1)
})

test('a row in a step’s bracket anchors it: a new member runs it again', async () => {
  let { apply, read, flow } = fixture()
  await flow('orders', { ...ask, match: '$o .order; [$s .shipment.order=$o]' })
  await apply([{ entity: { eid: 'o1' }, order: {} }])
  equal((await read('.call')).length, 1)
  // The shipment's write touches only the shipment, which the bracket reads.
  await apply([{ entity: { eid: 's1' }, shipment: { order: 'o1' } }])
  equal((await read('.call')).length, 2)
  await apply([{ entity: { eid: 's1' }, shipment: { order: 'o1' } }])
  equal((await read('.call')).length, 2)
})

test('a step naming a word the store lacks refuses no write, its own fix included', async () => {
  let { apply, read, flow } = fixture()
  await flow('orders', { ...ask, match: '$o .order, crates>=1' })
  await apply([{ entity: { eid: 'o1' }, order: {} }])
  equal(await read('.call'), [])
  await apply([{ entity: { eid: 'ask' }, step: { match: '$o .order' } }])
  await apply([{ entity: { eid: 'o2' }, order: {} }])
  equal((await read('.call')).length, 1)
})

test('a binding’s key holds its bracket’s members as a set', () => {
  let member = (e: string, film: string) => ({ entities: [e], vars: { film } })
  let bound = (...members: ReturnType<typeof member>[]) => ({
    entities: ['v'],
    vars: {},
    collections: [{ vars: ['film'], entityVars: ['k'], members }],
  })
  let a = bindingKey(bound(member('k1', 'f1'), member('k2', 'f2')))
  equal(bindingKey(bound(member('k2', 'f2'), member('k1', 'f1'))), a)
  equal(bindingKey(bound(member('k1', 'f1'), member('k2', 'f3'))) == a, false)
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
    match:
      '$t .task, .completed, made.case=$k; $k .workflow_case, workflow_case.for=$o',
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
  equal(await read('.workflow_case'), [])
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
  let { g, apply, read, settle } = fixture()
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
  await settle()
  equal((await read('.note')).map((n) => (n.note as Comp).text).sort(), [
    'o1',
    'o2',
  ])
})

test('an owed step survives a stop, and a fresh process runs it once', async () => {
  let { db, read, flow } = fixture()
  await flow('orders', ask)
  // The order commits, owing its step, and the process stops before working
  // the pool.
  await process(db, true).g.apply([{ entity: { eid: 'o1' }, order: {} }])
  equal(await read('.call'), [])
  equal((await read('.step_due')).length, 1)

  let fresh = process(db)
  await fresh.settle()
  await fresh.settle()
  let [call, ...more] = await read('.call&?made')
  equal(more, [])
  equal(call.call, { name: 'pack', args: { order: 'o1' } })
  equal(await read('.step_due'), [])
  equal(await read('.effect'), [])
})

test('a value only checked runs no step and owes none', async () => {
  let { g, read, flow } = fixture()
  await flow('orders', ask, { ...ship, eid: 'label', match: '$o .order' })
  await g.admit([{ entity: { eid: 'o1' }, order: {} }])
  equal(await read('.step_due'), [])
  equal(await read('.order'), [])
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

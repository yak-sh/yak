import { equal, test, throws } from '@yaks/testing'
import { type Runner, settle } from './run.ts'
import { pages, transcriptGraph } from './testing.ts'

let defect = new TypeError('checkout failed')
let full = new Error('database or disk is full')

let fixture = (fail = false) => {
  let g = transcriptGraph(pages)
  g.apply([
    { entity: { eid: 'worker' }, session: {} },
    { entity: { eid: 'root' }, session: {} },
    {
      entity: { eid: 'child' },
      session: {},
      spawned: { parent: 'root' },
      dispatch: { state: 'active', args: '{}' },
    },
    {
      entity: { eid: 'child:input' },
      entry: { session: 'child' },
      content: { body: 'start' },
      using: {},
    },
  ], { trusted: true })
  let told: unknown[] = []
  let r: Runner = {
    holder: 'worker',
    tools: [],
    model: () => {
      throw new Error('preparation must stop before a model ask')
    },
    prepareChild: () => {
      throw defect
    },
    report: (e) => told.push(e),
  }
  let apply = g.apply
  g.apply = (bundles, opts) => {
    if (fail && bundles.some((b) => b.exception)) throw full
    return apply(bundles, opts)
  }
  return { g, r, told }
}

let recorded = fixture()
let rejected = fixture(true)

test('a preparation defect records its original exception without a direct report', async () => {
  let { g, r, told } = recorded
  await settle(g, 'child', r)
  let [row] = await g.get(['child:preparation-error'])
  equal(row.exception, {
    type: defect.name,
    value: defect.message,
    stack: defect.stack,
  })
  equal(told, [])
})

test('a rejected preparation exception write reports the original defect once', async () => {
  let { g, r, told } = rejected
  equal(await throws(() => settle(g, 'child', r)), full)
  equal(told.length, 1)
  equal(told[0] === defect, true)
  equal(await g.read('.exception&*'), [])
})

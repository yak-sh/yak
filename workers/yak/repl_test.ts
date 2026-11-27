import { equal, test, throws } from '@yaks/testing'
import { mint } from '@yaks/graph'
import { whole } from '@yaks/query'
import { LASTS, opened, type Operator, ran } from './repl.ts'
import { operatorMemory } from './operator-testing.ts'

let store = () => {
  let { g } = operatorMemory()
  let operator: Operator = {
    read: async (q) => await g.read(whole(q)),
    apply: async (bundles, by) =>
      await g.apply(bundles.map((b) => ({ ...b, $actor: { by } }))),
  }
  return { g, operator }
}
let person = mint()

test("a REPL is a row of its space's Operator store, and each cell another", async () => {
  let { g, operator } = store()
  let app = mint()
  let repl = await opened(operator, 'new', { person, app, now: 0 })
  equal((await g.read(whole(`.entity.eid=${repl}`)))[0].repl, {
    app,
    until: new Date(LASTS).toISOString(),
  })
  equal(await opened(operator, repl, { person, now: 1000 }), repl)
  await ran(operator, repl, 'return 1', { value: 1, calls: [], repl }, {
    person,
    now: 1000,
  })
  let [cell] = await g.read(whole(`.cell.repl=${repl}`))
  equal(cell.cell, {
    repl,
    script: 'return 1',
    answer: { value: 1, calls: [], repl },
  })
  equal(
    (await g.read(whole(`.entity.eid=${repl}`)))[0].repl,
    { app, until: new Date(1000 + LASTS).toISOString() },
  )
})

test('a REPL past its hour, or one never started, is refused with the way to start one', async () => {
  let { operator } = store()
  let repl = await opened(operator, 'new', { person, now: 0 })
  await throws(
    () => opened(operator, repl, { person, now: LASTS }),
    'start another with repl: "new"',
  )
  await throws(
    () => opened(operator, mint(), { person, now: 0 }),
    'start one with repl: "new"',
  )
})

test("a cell keeps a large answer's receipts and error, not its value", async () => {
  let { g, operator } = store()
  let repl = await opened(operator, 'new', { person, now: 0 })
  let value = 'x'.repeat(70_000)
  let answer = { value, calls: [], repl }
  await ran(operator, repl, 'return big', answer, {
    person,
    now: 0,
  })
  let [cell] = await g.read(whole(`.cell.repl=${repl}`))
  equal((cell.cell as { answer: unknown }).answer, {
    value: null,
    calls: [],
    repl,
    unkept: JSON.stringify(answer).length,
  })
})

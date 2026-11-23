// Who a workflow's question is asked of in the Operator store (D-467): the
// person named, or, when the Operator wrote the step as its space, the
// person whose Operator session wrote it.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { line } from '@yaks/query'
import { askAppDecision } from '@yaks/platform/app-decision'
import { operatorStore } from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'

let space = crypto.randomUUID(), ada = crypto.randomUUID()
let session = crypto.randomUUID()
let { g } = await operatorStore(durable())
await g.apply([
  { entity: { eid: ada }, person: {} },
  {
    entity: { eid: session },
    session: {},
    operator_session: { space, person: ada },
  },
])

let asked = async (to: string, via?: string) => {
  let row = crypto.randomUUID()
  await askAppDecision(g, {
    to,
    ...(via ? { via } : {}),
    app: crypto.randomUUID(),
    row,
    title: 'Which voice?',
    decision: { question: 'Which voice?', choices: [] },
  })
  let [copy] = await g.read(line`.app_decision.row=${row}&.filed`)
  return (copy.filed as Comp).assignee
}

test('a question is asked of the person its step names or its Operator session served', async () => {
  let bo = crypto.randomUUID()
  assertEquals(await asked(ada), ada)
  assertEquals(await asked(space, session), ada)
  assertEquals(await asked(bo, crypto.randomUUID()), bo)
  assertEquals(await asked(space), space)
})

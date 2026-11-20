// What a conversation's page reads of its lines (operator-host.ts `drawnOf`):
// a call's answer without its value, and what each ask's model was told.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { toolEid } from '@yaks/tools/result'
import { operatorStore } from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { conversationOf } from './operator-host.ts'
import { rootOf } from './operator-root.ts'

let store = await operatorStore(durable())
let root = rootOf(crypto.randomUUID(), crypto.randomUUID())
let helper = crypto.randomUUID()
let line = (session: string, row: Omit<Bundle, 'entity'>, eid?: string) => ({
  entity: { eid: eid ?? crypto.randomUUID() },
  entry: { session },
  ...row,
})
let ask = (instructions: string) =>
  line(helper, { ask: {}, sending: { instructions } })
let preview = crypto.randomUUID(), spawn = crypto.randomUUID()
await store.g.apply([
  { entity: { eid: root }, session: {} },
  line(root, { content: { body: 'Show me the page.' } }),
  line(root, { call: { to: toolEid('app_preview'), args: {} } }, preview),
  line(root, {
    result: { call: preview, value: { image: 'SCREENSHOT' } },
    content: { body: 'Shown.' },
  }),
  line(root, { call: { to: toolEid('session_spawn'), args: {} } }, spawn),
  {
    entity: { eid: helper },
    session: {},
    spawned: { parent: root, call: spawn },
  },
  ask('Roll the dice.'),
  ask('Roll the dice.'),
  ask('Roll them again.'),
], { trusted: true })
let read = await conversationOf(store, '/operator', root)

test('a conversation draws a call’s answer without reading its value', () => {
  equal(read.html.includes('Shown.'), true)
  equal(JSON.stringify(read.lines()).includes('SCREENSHOT'), false)
})

test('a conversation draws what its helper was told, where it changes', () => {
  equal(
    ['Roll the dice.', 'Roll them again.'].map((s) => read.html.includes(s)),
    [true, true],
  )
})

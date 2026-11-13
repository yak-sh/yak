// What an Operator ask carries before the person's words: its instructions
// and the schemas of the tools it is sent. The tools most turns use go whole
// and the rest by a line each until a turn loads them (@yaks/session
// `tool_load`), so a tool the platform gains costs every ask a line, not a
// schema. The ceiling is the estimate compaction uses: four characters a
// token.
import { equal, ok, test } from '@yaks/testing'
import type { Item, Request as Ask } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { owned } from './directory-fixture.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { handleChannels, receive } from './operator-channels.ts'
import type { Ctx } from './tools.ts'

let CEILING = 20_000

let store = operatorMemory()
let { env } = platform('operator-request')
let person = crypto.randomUUID()
let ctx: Ctx = { env, dir: directoryOf(env.STORE), person }
let space = await owned(ctx, 'request-home')

let asked: Ask[] = []
let call = (name: string, args: object): Item[] => [
  { kind: 'call', id: crypto.randomUUID(), name, args: JSON.stringify(args) },
]
let operator = operating(
  store,
  env,
  operatorModel((req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: asked.length == 1
        ? call('tool_load', { names: ['number_find'] })
        : [{ kind: 'assistant', text: 'Found one.' }],
      cost: 0.001,
    })
  }),
)
handleChannels(operator, env, { text: () => Promise.resolve({}) })
await receive(store, {
  space,
  person,
  channel: 'text',
  address: '+12695550143',
}, 'Find me a phone number.')
await drain(store)

let tokens = (req: Ask) =>
  Math.ceil(
    (JSON.stringify(req.tools).length + String(req.instructions).length) / 4,
  )
let names = (req: Ask) => req.tools.map((t) => t.name)

test(`an Operator ask carries under ${CEILING} tokens before the person's words`, () => {
  let [first] = asked
  ok(tokens(first) < CEILING, `${tokens(first)} tokens`)
})

test('the Operator is sent a tool it loads with the next ask, and lists the rest', () => {
  let [first, next] = asked
  ok(!names(first).includes('number_find'))
  ok(names(next).includes('number_find'))
  let load = first.tools.find((t) => t.name == 'tool_load')!
  ok(load.description.includes('- number_find: Find a phone number'))
  equal(
    names(next).filter((n) => !names(first).includes(n)),
    ['number_find'],
  )
})

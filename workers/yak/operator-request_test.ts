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
import { connected } from './located.ts'
import { BROWSER_ZONE } from '@yaks/platform/local-time'
import type { Ctx } from './tools.ts'

let CEILING = 10_000

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
        ? call('tool_load', { names: ['number_find', 'app_files'] })
        : [{ kind: 'assistant', text: 'Found one.' }],
      cost: 0.001,
    })
  }),
)
handleChannels(operator, env, { chat: () => Promise.resolve({}) })
await receive(store, {
  space,
  person,
  channel: 'chat',
}, 'Find me a phone number and add it to my app.')
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

test('the Operator is sent tools it loads with the next ask, and lists the rest', () => {
  let [first, next] = asked
  for (let name of ['number_find', 'app_files']) {
    ok(!names(first).includes(name))
    ok(names(next).includes(name))
  }
  ok(
    first.turnContext?.some((item) =>
      item.kind == 'instruction' &&
      item.text.includes('- number_find: Find a phone number')
    ),
  )
  equal(
    names(next).filter((n) => !names(first).includes(n)),
    ['app_files', 'number_find'],
  )
})

test('a new turn gets the person’s latest browser clock and relevant-zone guidance', async () => {
  let { env, dir } = platform('operator-local-time')
  let person = crypto.randomUUID()
  await dir.stamp({ entities: [{ entity: { eid: person }, person: {} }] })
  let space = await owned({ dir, person }, 'clock-home')
  let store = operatorMemory()
  let turns: Ask[] = []
  let operator = operating(
    store,
    env,
    operatorModel((req) => {
      turns.push(req)
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: [{ kind: 'assistant', text: 'Here is the time.' }],
      })
    }),
  )
  handleChannels(operator, env, { chat: () => Promise.resolve({}) })
  for (let zone of ['Asia/Kathmandu', 'Pacific/Auckland']) {
    let req = new Request('https://yaks.app', {
      headers: { [BROWSER_ZONE]: zone },
    })
    await connected(env, person, req)
    await receive(
      store,
      { space, person, channel: 'chat' },
      'What time is it for me?',
    )
    await drain(store)
    let context = turns.at(-1)?.turnContext?.flatMap((item) =>
      item.kind == 'instruction' && item.text.includes('current local time')
        ? [item.text]
        : []
    ).join('\n') ?? ''
    ok(context.includes(`(${zone})`))
    ok(context.includes('For an event or place with its own time zone'))
  }
})

test('the first private reply asks once, and the name they give follows them', async () => {
  let { env, dir } = platform('operator-person-name')
  let person = crypto.randomUUID()
  let store = operatorMemory()
  await dir.stamp({
    entities: [{
      entity: { eid: person },
      person: {},
      email: { address: 'seedling@example.com' },
      doc: { title: 'seedling' },
    }],
  })
  let space = await dir.own(person)
  let turns: Ask[] = []
  let operator = operating(
    store,
    env,
    operatorModel((req) => {
      turns.push(req)
      let names = req.tools.map((t) => t.name)
      let saved = req.items.some((item) =>
        item.kind == 'call' && item.name == 'name_set'
      )
      let items: Item[] =
        saved || !JSON.stringify(req.items).includes('I go by Dana')
          ? [{ kind: 'assistant', text: 'I can help with that.' }]
          : names.includes('name_set')
          ? call('name_set', { name: 'Dana' })
          : call('tool_load', { names: ['name_set'] })
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items,
      })
    }),
  )
  handleChannels(operator, env, { chat: () => Promise.resolve({}) })
  let say = async (text: string) => {
    let start = turns.length
    await receive(store, { space: space.eid, person, channel: 'chat' }, text)
    await drain(store)
    return JSON.stringify(
      turns.slice(start).flatMap((r) => r.turnContext ?? []),
    )
  }
  ok(
    (await say('Can you help with my garden?')).includes('ask once, naturally'),
  )
  ok(!(await say('I want to grow peas.')).includes('ask once, naturally'))
  await say('I go by Dana')
  equal(await dir.nameAt(person), 'Dana')
  ok((await say('When do I sow?')).includes('Their saved display name is'))
})

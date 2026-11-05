import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import {
  handleChannels,
  receive,
  type Request as Intake,
} from './operator-channels.ts'

// Whatever a person's own agent can do through the yaks.app connector, their
// Operator can do: the conversation and its forks are offered every tool the
// connector lists, and a fork does the work with one (T-137801).
let owner = crypto.randomUUID()
let { env } = platform('operator-connector')
let dir = directoryOf(env.STORE)
let id = await dir.mint(owner, 'home', 'Home', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let asked: Request[] = []
let call = (name: string, args: object): Item[] => [
  { kind: 'call', id: crypto.randomUUID(), name, args: JSON.stringify(args) },
]
let say = (text: string): Item[] => [{ kind: 'assistant', text }]
// The conversation forks; the fork renames the space with space_set.
let script = (req: Request): Item[] => {
  let last = req.items.at(-1)!
  let fork = JSON.stringify(req.items).includes('fork of the')
  if (last.kind == 'result') {
    return say(fork ? 'Renamed it The Alvarez Home.' : 'On it.')
  }
  if (last.kind == 'user' && /Renamed it/.test(last.text)) {
    return say('Your space is now The Alvarez Home.')
  }
  return fork
    ? call('space_set', { title: 'The Alvarez Home' })
    : call('fork', { prompt: 'Rename their space The Alvarez Home.' })
}
let store = operatorMemory()
let operator = operating(
  store,
  env,
  operatorModel((req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: script(req),
      cost: 0.001,
    })
  }),
)
let sent: string[] = []
handleChannels(operator, env, {
  text: (_: Intake, answer: { text: string }) => {
    sent.push(answer.text)
    return Promise.resolve({})
  },
})
await receive(store, {
  space: id,
  person: owner,
  channel: 'text',
  address: '+12695550142',
}, 'Call my space The Alvarez Home.')
await drain(store)
let names = (r: Request) => r.tools.map((t) => t.name)
let atRoot = names(asked[0])
let atFork = names(
  asked.find((r) => JSON.stringify(r.items).includes('fork of the'))!,
)

test('a fork does what the connector does, with a tool the old workbench lacked', async () => {
  assertEquals((await dir.at(id))!.title, 'The Alvarez Home')
  assertEquals(sent, ['On it.', 'Your space is now The Alvarez Home.'])
})

test('the conversation and its forks are offered every tool the connector lists, but those the Operator holds itself', () => {
  assertEquals(atFork, atRoot)
  assertEquals(new Set(atRoot).size, atRoot.length)
  let has = (name: string) => atRoot.includes(name)
  assertEquals(
    ['space_set', 'member_add', 'app_publish', 'mail_send', 'store_memory_save']
      .map(has),
    [true, true, true, true, true],
  )
  assertEquals(['operator_run', 'operator_read'].map(has), [false, false])
})

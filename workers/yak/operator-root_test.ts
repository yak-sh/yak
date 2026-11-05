import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
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
  rootOf,
} from './operator-channels.ts'
import { conversationOf, workOf } from './operator-host.ts'

// A person's messages reach their one conversation with the Operator, which
// forks for the work: a word back at once, and the outcome when the fork
// comes back, each on the channel the message came by (D-137704).
let owner = crypto.randomUUID()
let { env } = platform('operator-root')
let dir = directoryOf(env.STORE)
let id = await dir.mint(owner, 'home', 'Home', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let space = (await dir.at(id))!
let store = operatorMemory()
let asked: Request[] = []
let reply = (text: string): Item[] => [{ kind: 'assistant', text }]
let forked = (r: Request) => JSON.stringify(r.items).includes('fork of the')
let operator = operating(
  store,
  env,
  operatorModel((req) => {
    asked.push(req)
    let last = req.items.at(-1)
    let items = forked(req)
      ? reply('Added: dentist, Tuesday at 3.')
      : last?.kind == 'user' && /Added: dentist/.test(last.text)
      ? reply('Your dentist reminder is in, Tuesday at 3.')
      : last?.kind == 'user' && /Wednesday/.test(last.text)
      ? reply('Moving the dentist to Wednesday.')
      : last?.kind == 'result'
      ? reply('On it: adding a dentist reminder.')
      : [{
        kind: 'call' as const,
        id: crypto.randomUUID(),
        name: 'fork',
        args: JSON.stringify({ prompt: 'Add a dentist reminder, Tuesday 3pm' }),
      }]
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items,
      cost: 0.001,
    })
  }),
)
let sent: { channel: string; text: string; to?: string }[] = []
let channel = (name: string) => (request: Intake, answer: { text: string }) => {
  sent.push({ channel: name, text: answer.text, to: request.address })
  return Promise.resolve({})
}
handleChannels(operator, env, { text: channel('text'), chat: channel('chat') })

let first = await receive(store, {
  space: space.eid,
  person: owner,
  channel: 'text',
  address: '+12695550142',
}, 'Remind me about the dentist Tuesday at 3')
await drain(store)
let root = rootOf(space.eid, owner)
let [fork] = await store.g.read(`.spawned.parent=${root}`)
let atFork = asked.find(forked)!
let atRoot = asked.find((r) => !forked(r))!
let texted = sent.splice(0)

await receive(
  store,
  { space: space.eid, person: owner, channel: 'chat' },
  'Make it Wednesday',
)
await drain(store)
let later = asked.at(-1)!
let sessions = await store.g.read('.session')
let tasks = await store.g.read('.task')
let listed = await workOf(store, space.eid, owner)
let byRequest = await conversationOf(store, '/at', first)
let ofFork = await conversationOf(store, '/at', fork.entity.eid)

test("a person's text forks, and is answered at once and again when the fork comes back, by text", () => {
  assertEquals(texted, [
    {
      channel: 'text',
      text: 'On it: adding a dentist reminder.',
      to: '+12695550142',
    },
    {
      channel: 'text',
      text: 'Your dentist reminder is in, Tuesday at 3.',
      to: '+12695550142',
    },
  ])
  assertEquals(
    String(atRoot.instructions).includes('introduce yourself'),
    false,
  )
})

test('the fork reads the conversation with the same instructions and tools, so it starts from its cached prefix', () => {
  assertEquals(atFork.instructions, atRoot.instructions)
  assertEquals(
    atFork.tools.map((t) => t.name),
    atRoot.tools.map((t) => t.name),
  )
  assertStringIncludes(JSON.stringify(atFork.items), 'dentist Tuesday at 3')
})

test('the next message, by any channel, is the same conversation, and files no task', () => {
  assertEquals(
    sessions.map((s) => s.entity.eid).sort(),
    [root, fork.entity.eid].sort(),
  )
  assertEquals(tasks.length, 0)
  assertStringIncludes(JSON.stringify(later.items), 'dentist reminder is in')
  assertEquals(sent, [{
    channel: 'chat',
    text: 'Moving the dentist to Wednesday.',
    to: undefined,
  }])
})

test('the chat app lists the conversation first and the work it started, and opens either', () => {
  assertEquals(listed.map((w) => w.open), [root, fork.entity.eid])
  assertEquals(listed[1].title, 'Add a dentist reminder, Tuesday 3pm')
  assertEquals(listed[1].state, 'Done')
  assertEquals(byRequest.task, root)
  assertStringIncludes(byRequest.html, 'By text: Remind me about the dentist')
  assertEquals(ofFork.task, fork.entity.eid)
  // A piece of work shows what it did, not the conversation it came from.
  assertEquals(ofFork.html.includes('Remind me about the dentist'), false)
  assertStringIncludes(ofFork.html, 'Added: dentist, Tuesday at 3.')
})

// A text's sender number is all that says who sent it, and anyone can show a
// member's number (T-1398). So a member's turn on a text holds their reads
// and its answer to that number, and what changes the space or sends
// elsewhere waits for their chat, where the same words hold every tool.
import { equal, test } from '@yaks/testing'
import type { Request as Ask } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { owned } from './directory-fixture.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { handleChannels, receive } from './operator-channels.ts'
import type { Ctx } from './tools.ts'

let store = operatorMemory()
let { env } = platform('operator-texted')
let person = crypto.randomUUID()
let ctx: Ctx = { env, dir: directoryOf(env.STORE), person }
let space = await owned(ctx, 'texted-home')

// The tools each turn held, deferred ones by their line in tool_load's list,
// and what loading mail_send answered, by the turn's channel.
let held = new Map<string, string[]>()
let loaded = new Map<string, string>()
let operator = operating(
  store,
  env,
  operatorModel((req: Ask) => {
    let said = req.items.findLast((i) => i.kind == 'user')
    let channel = said?.kind == 'user'
      ? said.text.match(/someone, by (\w+)/)?.[1] ?? ''
      : ''
    let last = req.items.at(-1)
    if (last?.kind == 'result') loaded.set(channel, last.output)
    else {
      held.set(
        channel,
        req.tools.flatMap((t) => [
          t.name,
          ...[...t.description.matchAll(/^- (\w+):/gm)].map((m) => m[1]),
        ]),
      )
    }
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: last?.kind == 'result'
        ? [{ kind: 'assistant', text: 'Done.' }]
        : [{
          kind: 'call',
          id: crypto.randomUUID(),
          name: 'tool_load',
          args: JSON.stringify({ names: ['mail_send'] }),
        }],
      cost: 0.001,
    })
  }),
)
let answered = () => Promise.resolve({})
handleChannels(operator, env, {
  chat: answered,
  text: answered,
  rcs: answered,
  texted: answered,
})
for (let channel of ['chat', 'text', 'rcs', 'texted']) {
  await receive(store, {
    space,
    person,
    channel,
    address: '+12695550143',
    reply_to: '+18445550100',
  }, `Mail the directory to someone, by ${channel}`)
  await drain(store)
}

let DOORS = ['mail_send', 'phone_send', 'graph_apply', 'code_mode', 'fork']

test('a member asking in chat holds every tool', () => {
  for (let door of DOORS) equal(held.get('chat')!.includes(door), true, door)
  equal(loaded.get('chat')!.includes('can be faked'), false)
})

for (let channel of ['text', 'rcs', 'texted']) {
  test(`a member's ${channel} holds reads and their own alerts, never a door that sends or writes`, () => {
    let tools = held.get(channel)!
    for (let door of DOORS) equal(tools.includes(door), false, door)
    for (let kept of ['graph_query', 'notification_send', 'text_send']) {
      equal(tools.includes(kept), true, kept)
    }
    equal(loaded.get(channel)!.includes('sender number can be faked'), true)
  })
}

// The conversation tools, as a space's Builder answers them: words begun and
// carried on as the person, and read back by them.
import { equal, test } from '@yaks/testing'
import { mint } from '@yaks/graph'
import { platform } from './directory-rows-probe.ts'
import { operatorModel, operatorService } from './operator-testing.ts'

let p = platform('operator-conversations')
let person = mint()
let space = await p.dir.mint(person, 'talk', 'Talk', {
  'x-yak-person': person,
  'x-yak-role': 'owner',
})
let service = operatorService(p.env, { person, space, role: 'owner' }, {
  directory: () => p.dir,
  ...operatorModel((req) =>
    Promise.resolve({
      id: mint(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Heard.' }],
      cost: 0.001,
    })
  ),
})
let talk = async (tool: string, args: object) =>
  await (await service.binding.get(space).fetch(
    new Request('https://builder/operator/talk', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-space-eid': space,
        'x-yak-person': person,
      },
      body: JSON.stringify({ tool, args }),
    }),
  )).json()

let started = await talk('conversation_start', { prompt: 'Hi.', request: 'r1' })
let again = await talk('conversation_start', { prompt: 'Hi.', request: 'r1' })
await service.drain()
await talk('conversation_send', { session: started.session, text: 'More.' })
await service.drain()
let read = await talk('conversation_read', { session: started.session })
let lines = await talk('conversation_read', {
  session: started.session,
  lines: true,
})
let recent = await talk('conversation_recent', {})

test('words begun once and carried on are read back as their messages and every line', () => {
  equal(again.session, started.session)
  equal(
    read.messages.map((m: { role: string }) => m.role),
    ['user', 'assistant', 'user', 'assistant'],
  )
  equal(lines.entries.some((b: { prompt?: unknown }) => b.prompt), true)
  equal(recent.conversations[0].session, started.session)
})

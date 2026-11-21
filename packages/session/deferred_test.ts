// tool_load loads deferred tools by name, takes a name already sent as held,
// and refuses one no tool has with the names nearest it, loading the rest.
import { equal, test, throws } from '@yaks/testing'
import { loading } from './deferred.ts'
import type { Tool } from './react.ts'

let tool = (name: string, deferred = false): Tool => ({
  name,
  description: `${name}.`,
  parameters: {},
  deferred,
  run: () => name,
})
let load = loading([
  tool('notification_send'),
  tool('mail_send', true),
  tool('search', true),
]).find((t) => t.name == 'tool_load')!
let run = (names: string[]) => load.run({ names })

test('a deferred name loads, and a name already sent is held', async () => {
  equal(await run(['mail_send']), 'Loaded mail_send. Call them directly.')
  equal(
    await run(['notification_send']),
    'notification_send you hold already. Call them directly.',
  )
})

test('a name no tool has is refused with the tools sharing a word with it', async () => {
  await throws(
    async () => await run(['text_send']),
    'There is no tool called text_send; nearest: mail_send, notification_send',
  )
})

test('a withheld tool is neither offered nor listed, and loading it says why', async () => {
  let tools = loading([
    tool('search'),
    tool('mail_send', true),
    { ...tool('code_mode'), withheld: 'a break holds its reads' },
  ])
  equal(tools.map((t) => t.name), ['search', 'mail_send', 'tool_load'])
  await throws(
    async () => await tools.at(-1)!.run({ names: ['tasks__code_mode'] }),
    'tasks__code_mode is not held in this turn: a break holds its reads. Load one',
  )
})

test('a call naming one it cannot load loads the rest and names the refused one', async () => {
  equal(
    await run(['mail_send', 'app_list', 'search']),
    'Loaded mail_send, search. Call them directly. There is no tool called app_list. Load one by a name tool_load lists.',
  )
})

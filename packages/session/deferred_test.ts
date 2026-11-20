// tool_load loads deferred tools by name, takes a name already sent as held,
// and refuses one no tool has with the names nearest it.
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

import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { ModelError } from '@yaks/model'
import { claude, input, items, listing } from './mod.ts'
let tool = {
  name: 'graph_query',
  description: 'Read graph',
  parameters: { type: 'object', properties: { q: { type: 'string' } } },
}
let req = {
  model: 'haiku',
  items: [{ kind: 'user' as const, text: 'hello' }],
  tools: [tool],
}
test('assistant frames expose text and offered harness calls', () => {
  assertEquals(
    items({
      id: 'message-1',
      content: [
        { type: 'thinking', thinking: 'private' },
        { type: 'text', text: 'checking' },
        {
          type: 'tool_use',
          name: 'mcp__harness__graph_query',
          id: 'call-1',
          input: { q: 'hello' },
        },
      ],
    }, req),
    [{
      kind: 'assistant',
      text: 'checking',
      id: 'message-1',
    }, {
      kind: 'call',
      id: 'call-1',
      name: 'graph_query',
      args: '{"q":"hello"}',
    }],
  )
})

test('input replays the complete transcript including tool results', () => {
  let transcript = [...req.items, {
    kind: 'result' as const,
    id: 'call-1',
    output: 'found',
  }]
  let message = JSON.parse(input({ ...req, items: transcript }))
  assertEquals(message.type, 'user')
  assertEquals(message.message.role, 'user')
  assertEquals(JSON.parse(message.message.content), { transcript })
})

test('unknown built-ins fail closed and unsupported requests never submit', async () => {
  assertThrows(
    () =>
      items({
        content: [{ type: 'tool_use', name: 'Bash', id: 'x', input: {} }],
      }, req),
    ModelError,
  )
  let submitted = false
  await assertRejects(
    () =>
      claude()({
        ...req,
        questions: {},
        onSubmit: () => {
          submitted = true
          return Promise.resolve()
        },
      }),
    ModelError,
  )
  assertEquals(submitted, false)
  assertEquals(JSON.parse(input(req)).message.role, 'user')
  assertEquals(listing().map((m) => m.name), ['haiku', 'sonnet', 'opus'])
})

test('an already cancelled request never submits', async () => {
  let submitted = false
  await assertRejects(
    () =>
      claude()({
        ...req,
        signal: AbortSignal.abort(),
        onSubmit: () => {
          submitted = true
          return Promise.resolve()
        },
      }),
    DOMException,
  )
  assertEquals(submitted, false)
})

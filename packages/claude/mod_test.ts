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
// Subprocess startup and stream delivery prepare the transcript; each check
// below observes the provider's public turn/result contract without timing OS
// process scheduling as the assertion's own work.
let turns = await (async () => {
  let model = claude({
    command: Deno.execPath(),
    args: ['run', '-A', new URL('./fake_cli.ts', import.meta.url).pathname],
  })
  let submitted = 0, marks: unknown[] = []
  let first = await model({
    ...req,
    onSubmit: () => {
      submitted++
      return Promise.resolve()
    },
    onAck: (m) => {
      marks.push(m)
      return Promise.resolve()
    },
  })
  let second = await model({
    ...req,
    items: [...req.items, ...first.items, {
      kind: 'result',
      id: 'call-1',
      output: 'found',
    }],
  })
  return { model, first, second, submitted, marks }
})()

test('Claude CLI turn yields only harness calls, then replays results', () => {
  let { model, first, second, submitted, marks } = turns
  assertEquals(first.items, [{
    kind: 'assistant',
    text: 'checking',
    id: 'message-1',
  }, {
    kind: 'call',
    id: 'call-1',
    name: 'graph_query',
    args: '{"q":"hello"}',
  }])
  assertEquals(second.items, [{
    kind: 'assistant',
    text: 'done',
    id: 'message-2',
  }])
  assertEquals(submitted, 1)
  assertEquals(marks, [{ claude: { session_id: 'fake-session' } }])
  assertEquals(model.anchor, undefined)
  assertEquals(model.mark!(first), {
    claude: { response_id: 'message-1', session_id: 'fake-session' },
  })
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

test('cancellation during submission never starts a CLI', async () => {
  let abort = new AbortController()
  await assertRejects(
    () =>
      claude({ command: '/no-such-claude-command' })({
        ...req,
        signal: abort.signal,
        onSubmit: () => {
          abort.abort()
          return Promise.resolve()
        },
      }),
    DOMException,
  )
})

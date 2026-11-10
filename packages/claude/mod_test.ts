import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { ModelError } from '@yaks/model'
import type { TextDelta } from '@yaks/model'
import { claude, type Frame, input, items, listing, read } from './mod.ts'
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

let event = (event: Frame): Frame => ({ type: 'stream_event', event })
let piece = (index: number, text: string) =>
  event({
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  })
let begin = (index: number, type: string) =>
  event({ type: 'content_block_start', index, content_block: { type } })
let said = (...content: Frame[]): Frame => ({
  type: 'assistant',
  message: { id: 'm', content },
})
/** The text told while reading the frames, and the text the reply holds. */
let heard = async (frames: Frame[]) => {
  let deltas: TextDelta[] = []
  let { reply } = await read(
    { ...req, onText: (d) => deltas.push(d) },
    frames,
  )
  return {
    deltas: deltas.map((d) => [d.index, d.text]),
    texts: reply!.items.flatMap((i) => i.kind == 'assistant' ? [i.text] : []),
  }
}

test('text arriving in pieces is told piece by piece, and the reply holds the whole', async () => {
  let got = await heard([
    event({ type: 'message_start', message: { id: 'm' } }),
    begin(0, 'thinking'),
    event({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'private' },
    }),
    said({ type: 'thinking', thinking: 'private' }),
    begin(1, 'text'),
    piece(1, 'Hel'),
    piece(1, 'lo '),
    piece(1, 'there'),
    said({ type: 'text', text: 'Hello there' }),
    begin(2, 'text'),
    piece(2, 'Bye'),
    said({ type: 'text', text: 'Bye' }),
  ])
  assertEquals(got.deltas, [[0, 'Hel'], [0, 'lo '], [0, 'there'], [1, 'Bye']])
  assertEquals(got.texts, ['Hello there', 'Bye'])
})

test('text no piece carried is told when its message completes', async () => {
  assertEquals(
    (await heard([said({ type: 'text', text: 'Hello' })])).deltas,
    [[0, 'Hello']],
  )
  let cut = await heard([
    begin(0, 'text'),
    piece(0, 'Hel'),
    said({ type: 'text', text: 'Hello' }),
  ])
  assertEquals(cut.deltas, [[0, 'Hel'], [0, 'lo']])
})

test('the first block of a reply is its first output, and a call ends the reading', async () => {
  let first = 0
  let frames = [
    begin(0, 'text'),
    said({ type: 'text', text: 'checking' }),
    said({
      type: 'tool_use',
      name: 'mcp__harness__graph_query',
      id: 'call-1',
      input: {},
    }),
    said({ type: 'text', text: 'never read' }),
  ]
  let seen = 0
  let { reply } = await read({ ...req, onFirst: () => first = seen }, {
    *[Symbol.iterator]() {
      for (let f of frames) (seen++, yield f)
    },
  })
  assertEquals(first, 1)
  assertEquals(seen, 3)
  assertEquals(reply!.items.map((i) => i.kind), ['assistant', 'call'])
})

import { assertEquals, assertRejects } from '@std/assert'
import { type Item, ModelError, type Request } from '@yaks/model'
import { workersAi } from './mod.ts'

// A binding that answers `answer` (or throws it) and keeps what it was asked.
let binding = (answer: unknown) => {
  let asked: { model: string; input: unknown }[] = []
  let model = workersAi({
    run: (model, input) => {
      asked.push({ model, input })
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer)
    },
  })
  return { asked, model }
}

let ask = (items: Item[], more: Partial<Request> = {}): Request => ({
  model: '@cf/x/y',
  items,
  tools: [],
  ...more,
})

let calls = (items: Item[]) => items.flatMap((i) => i.kind == 'call' ? [i] : [])

Deno.test('a conversation is sent as chat messages', async () => {
  let { asked, model } = binding({ response: 'ok' })
  let tool = { name: 'look', description: 'Look', parameters: {} }
  await model(ask([
    { kind: 'instruction', text: 'be brief' },
    { kind: 'user', text: 'hi' },
    { kind: 'assistant', text: 'looking' },
    { kind: 'call', id: 'a', name: 'look', args: '{"q":1}' },
    { kind: 'call', id: 'b', name: 'find', args: '{}' },
    { kind: 'result', id: 'a', output: 'seen' },
    { kind: 'call', id: 'c', name: 'look', args: '{}' },
  ], { instructions: 'you build', tools: [tool], tokens: 99 }))
  assertEquals(asked[0].model, '@cf/x/y')
  assertEquals(asked[0].input, {
    messages: [
      { role: 'system', content: 'you build' },
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'looking',
        tool_calls: [
          { id: 'a', name: 'look', arguments: '{"q":1}' },
          { id: 'b', name: 'find', arguments: '{}' },
        ],
      },
      { role: 'tool', name: 'look', tool_call_id: 'a', content: 'seen' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c', name: 'look', arguments: '{}' }],
      },
    ],
    tools: [{ type: 'function', function: tool }],
    max_tokens: 99,
  })
})

Deno.test("the binding's own answer: words, calls given ids, usage", async () => {
  let texts: string[] = []
  let { model } = binding({
    response: 'on it',
    tool_calls: [
      { name: 'look', arguments: { q: 1 } },
      { name: 'find', arguments: '{}' },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  })
  let reply = await model(ask([{ kind: 'user', text: 'hi' }], {
    onText: (d) => texts.push(d.text),
  }))
  assertEquals(reply.items[0], { kind: 'assistant', text: 'on it' })
  assertEquals(texts, ['on it'])
  let [a, b] = calls(reply.items)
  assertEquals([a.name, a.args, b.name, b.args], [
    'look',
    '{"q":1}',
    'find',
    '{}',
  ])
  let [c] = calls((await model(ask([]))).items)
  assertEquals(new Set([a.id, b.id, c.id]).size, 3)
  assertEquals(reply.usage, {
    input_tokens: 10,
    output_tokens: 3,
    total_tokens: 13,
  })
})

Deno.test("OpenAI's answer shape is read the same", async () => {
  let { model } = binding({
    id: 'r1',
    choices: [{
      message: {
        content: null,
        tool_calls: [{ id: 'k', function: { name: 'look', arguments: '{}' } }],
      },
    }],
  })
  let reply = await model(ask([{ kind: 'user', text: 'hi' }]))
  assertEquals(reply, {
    id: 'r1',
    model: '@cf/x/y',
    items: [{ kind: 'call', id: 'k', name: 'look', args: '{}' }],
  })
})

Deno.test('a rate limit is expected; any other failure is not', async () => {
  let busy = binding(new Error('3040: Capacity temporarily exceeded'))
  let e = await assertRejects(() => busy.model(ask([])), ModelError)
  assertEquals(e.code, 'busy')
  let broken = new Error('boom')
  let other = await assertRejects(() => binding(broken).model(ask([])))
  assertEquals(other, broken)
})

Deno.test('images and cancelled requests are never sent', async () => {
  let { asked, model } = binding({ response: 'ok' })
  let image: Item = {
    kind: 'image',
    bytes: new Uint8Array([1]),
    mediaType: 'image/png',
    label: 'x',
  }
  await assertRejects(() => model(ask([image])), ModelError)
  await assertRejects(() => model(ask([], { signal: AbortSignal.abort() })))
  assertEquals(asked, [])
})

Deno.test('typed questions go as state and come back answered by name', async () => {
  let questions = {
    plan: {
      type: 'choice' as const,
      instructions: 'Where next?',
      criteria: { forge: 'to work', well: 'to rest' },
    },
    greet: { type: 'noul' as const, instructions: 'Greet them?' },
  }
  let plan = {
    type: 'choice' as const,
    choice: 'forge',
    confidence: 0.82,
    probabilities: { forge: 0.82, well: 0.18 },
  }
  let { asked, model } = binding({
    model: 'jev-1.13.0',
    answers: { plan, greet: { type: 'noul', noul: 0 } },
    usage: { input_tokens: 380, output_tokens: 45 },
  })
  let reply = await model(ask([{ kind: 'user', text: 'a stranger arrives' }], {
    instructions: 'you are the smith',
    questions,
  }))
  assertEquals(asked[0].input, {
    state: [
      { role: 'system', content: 'you are the smith' },
      { role: 'user', content: 'a stranger arrives' },
    ],
    questions,
  })
  assertEquals(reply.items, [])
  assertEquals(reply.answers, { plan, greet: { type: 'noul', noul: 0 } })
  assertEquals(reply.usage, { input_tokens: 380, output_tokens: 45 })
})

Deno.test('a model that answers no questions refuses them', async () => {
  let { model } = binding({ response: 'the forge, I think' })
  let questions = { plan: { type: 'noul' as const, instructions: '?' } }
  let e = await assertRejects(() => model(ask([], { questions })), ModelError)
  assertEquals(e.code, 'questions')
})

Deno.test("a binding's own ModelError is passed on as it is", async () => {
  let refused = new ModelError('limit', 'This space has used its allowance')
  let e = await assertRejects(() => binding(refused).model(ask([])))
  assertEquals(e, refused)
})

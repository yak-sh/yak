import { equal, test, throws } from '@yaks/testing'
import { append, cut, loaded, merge, read, rebuild, swap } from './replay.ts'

let j = (x: unknown) => JSON.stringify(x)
let blob = (hash: string, message: unknown) =>
  j({ type: 'api-request-blob', hash, message })
let user = (text: string) => ({ role: 'user', content: text })
let transcript = [
  j({
    type: 'api-request-shape',
    shapeHash: 's',
    shape: { system: [{ type: 'text', text: 'sys' }], tools: [] },
  }),
  blob('a', user('one')),
  j({
    type: 'api-request',
    id: 'r1',
    querySource: 'repl_main_thread',
    shapeHash: 's',
    params: { model: 'm', betas: ['b'] },
    tail: ['a', 'x'],
  }),
  j({ type: 'assistant', sessionId: 'old', message: { content: [] } }),
  j({
    type: 'api-request',
    id: 'r2',
    querySource: 'repl_main_thread',
    shapeHash: 's',
    params: { model: 'm', betas: ['b'] },
    base: 'r1',
    keep: 2,
    tail: ['c'],
    cacheControl: [{ path: ['system', 0], value: { type: 'ephemeral' } }],
  }),
  blob('c', user('three')),
]

test('rebuild takes the last request before the line, base and tail, a missing blob a hole', () => {
  let { request, betas, body } = rebuild(transcript, 6)
  equal(request.id, 'r2')
  equal(betas, ['b'])
  equal(body.messages, [user('one'), undefined, user('three')])
  equal(body.system[0].cache_control, { type: 'ephemeral' })
  equal(rebuild(transcript, 4).body.messages.length, 2)
  throws(() => rebuild(transcript, 1))
})

test('swap replaces text as written and inside a JSON string, never a signature', () => {
  let [x, n] = swap(
    {
      a: 'say "hi"\nnow',
      b: j({ body: 'say "hi"\nnow' }),
      signature: 'say "hi"\nnow',
    },
    'say "hi"\nnow',
    'bye',
  )
  equal(n, 2)
  equal(x, { a: 'bye', b: j({ body: 'bye' }), signature: 'say "hi"\nnow' })
  equal(swap('a b a', 'a', 'a!'), ['a! b a!', 2])
})

test('merge fills holes from the CLI, keeps only tool results in the last, restores loaded tools', () => {
  let result = {
    type: 'tool_result',
    tool_use_id: 't',
    content: [{ type: 'text', text: '[Tool references]' }],
  }
  let cli = [user('one'), { role: 'assistant', content: 'two' }, {
    role: 'user',
    content: [result, { type: 'text', text: 'Continue.' }],
  }]
  let tools = new Map([['t', [{ type: 'tool_reference', tool_name: 'x' }]]])
  let { messages, check } = merge([user('one'), undefined, undefined], cli, [{
    in: 'messages',
    from: 'two',
    to: '2',
  }], tools)
  equal(messages[1], { role: 'assistant', content: '2' })
  equal(messages[2].content, [{ ...result, content: tools.get('t') }, {
    type: 'text',
    text: 'Tool loaded.',
  }])
  equal([check.filled, check.compared, check.swapped], [2, 1, 1])
  throws(() =>
    merge([user('one'), undefined], [{ role: 'assistant', content: '' }])
  )
  throws(() =>
    merge([{ role: 'system', content: 'x' }, undefined, user('z')], [
      user('y'),
      user('w'),
      user('v'),
      user('u'),
    ])
  )
})

test('loaded finds each call whose result loaded tools', () => {
  let line = j({
    type: 'user',
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: 't',
        content: [{ type: 'tool_reference', tool_name: 'x' }],
      }],
    },
  })
  equal([...loaded([line, '{}']).keys()], ['t'])
})

test('read assembles text, tool calls and usage from a stream', () => {
  let e = (x: unknown) => 'data: ' + j(x)
  let { reply, usage } = read([
    'HTTP 200',
    e({ type: 'message_start', message: { usage: { input_tokens: 5 } } }),
    e({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text' },
    }),
    e({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hi ' },
    }),
    e({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'there' },
    }),
    e({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', name: 'go' },
    }),
    e({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"a":' },
    }),
    e({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '1}' },
    }),
    e({
      type: 'message_delta',
      usage: { output_tokens: 3 },
      delta: { stop_reason: 'end_turn' },
    }),
  ].join('\n'))
  equal(reply, [{ type: 'text', text: 'hi there' }, {
    type: 'tool_use',
    name: 'go',
    input: { a: 1 },
  }])
  equal(usage, { input_tokens: 5, output_tokens: 3, stop: 'end_turn' })
})

test('cut keeps the lines before the response, without request records, under a new id', () => {
  equal(
    cut(transcript, 5, 'old', 'new'),
    [
      transcript[0],
      transcript[1],
      j({ type: 'assistant', sessionId: 'new', message: { content: [] } }),
    ].join('\n') + '\n',
  )
})

test('append adds a block to a closing system message, else a system message of its own', () => {
  let hook = { role: 'system', content: [{ type: 'text', text: 'hook' }] }
  let add = { type: 'text', text: 'added' }
  equal(append([user('jeff'), hook], 'added'), [user('jeff'), {
    ...hook,
    content: [...hook.content, add],
  }])
  equal(
    append([user('jeff'), { role: 'system', content: 'hook' }], 'added')[1]
      .content,
    [hook.content[0], add],
  )
  equal(append([user('jeff')], 'added'), [user('jeff'), {
    role: 'system',
    content: [add],
  }])
})

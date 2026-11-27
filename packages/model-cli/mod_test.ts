import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { type Request, spent } from '@yaks/model'
import { test } from '@yaks/testing'
import { cliModel, type Vendor } from './mod.ts'

let req: Request = {
  model: 'test-model',
  instructions: 'Use the graph.',
  items: [
    { kind: 'user', text: 'Read my task.' },
    { kind: 'call', id: 'old', name: 'task_read', args: '{"id":1}' },
    { kind: 'result', id: 'old', output: 'Old answer' },
  ],
  turnContext: [{ kind: 'instruction', text: 'Now read the next task.' }],
  tools: [{
    name: 'task_read',
    description: 'Read a task.',
    parameters: { type: 'object' },
  }],
}

let stdout = (vendor: Vendor, turn: unknown) =>
  vendor == 'grok'
    ? JSON.stringify({
      requestId: 'ask',
      stopReason: 'end_turn',
      structuredOutput: turn,
      usage: { input_tokens: 10, cache_read_input_tokens: 2, output_tokens: 3 },
    })
    : [
      { event: 'init', init: { model: 'test-model' } },
      { event: 'step_update', step_update: { text_delta: '{' } },
      {
        event: 'result',
        result: {
          conversation_id: 'ask',
          status: 'SUCCESS',
          structured_output: turn,
          usage: { input_tokens: 10, cache_read_tokens: 2, output_tokens: 3 },
        },
      },
    ].map((frame) => JSON.stringify(frame)).join('\n')

for (let vendor of ['grok', 'antigravity'] as const) {
  test(`${vendor} replays graph history and returns calls for the harness`, async () => {
    let seen: string[] = []
    let model = cliModel(vendor, {}, (name) =>
      ({
        HOME: '/home/test',
        PATH: '/bin',
        XAI_API_KEY: 'key',
        GEMINI_API_KEY: 'key',
        GROK_DEPLOYMENT_KEY: 'key',
        AGY_ADC_AUTH: '1',
      })[name as 'HOME'], (job) => {
      seen.push('launch')
      assertEquals(job.command, vendor == 'grok' ? 'grok' : 'agy')
      assertEquals(job.env.HOME, '/home/test')
      assertEquals(job.env.PATH, '/bin')
      for (
        let name of [
          'XAI_API_KEY',
          'GEMINI_API_KEY',
          'GROK_DEPLOYMENT_KEY',
          'AGY_ADC_AUTH',
        ]
      ) {
        assertEquals(job.env[name], undefined)
      }
      let sent = vendor == 'grok'
        ? job.files?.['request.txt']
        : JSON.parse(job.stdin!).message.content
      assertEquals(JSON.parse(sent), {
        instructions: req.instructions,
        items: [...req.items, ...req.turnContext!],
        tools: req.tools,
      })
      assertEquals(job.args.includes('Read my task.'), false)
      assertEquals(job.args.includes(req.model), true)
      return Promise.resolve({
        code: 0,
        stderr: '',
        stdout: stdout(vendor, {
          text: 'Looking it up.',
          calls: [{ name: 'task_read', args: '{"id":2}' }],
        }),
      })
    })
    let reply = await model({
      ...req,
      onSubmit: () => {
        seen.push('submit')
        return Promise.resolve()
      },
      onFirst: () => {
        seen.push('first')
      },
      onText: ({ text }) => {
        seen.push(text)
      },
    })
    assertEquals(seen, ['submit', 'launch', 'first', 'Looking it up.'])
    assertEquals(reply.items, [
      { kind: 'assistant', id: 'ask', text: 'Looking it up.' },
      { kind: 'call', id: 'ask:0', name: 'task_read', args: '{"id":2}' },
    ])
    assertEquals(reply.usage, {
      input_tokens: 12,
      output_tokens: 3,
      total_tokens: 15,
      cached_tokens: 2,
    })
  })
}

test('only CLI plan exhaustion is routed away as spent', async () => {
  let grok = JSON.stringify({
    type: 'error',
    message:
      'You’ve hit the rate limit for your plan. Upgrade your account or try again later.',
  })
  let antigravity = JSON.stringify({
    event: 'result',
    result: {
      status: 'ERROR',
      error: 'You have exhausted your quota',
    },
  })
  for (
    let [vendor, payload] of [['grok', grok], [
      'antigravity',
      antigravity,
    ]] as const
  ) {
    for (
      let [output, wanted] of [
        [{ stdout: payload, stderr: '', code: 1 }, 'usage_limit_reached'],
        [
          { stdout: '', stderr: 'authentication required: private', code: 1 },
          'cli_auth',
        ],
        [{ stdout: '', stderr: '429 capacity rate limit', code: 1 }, 'busy'],
      ] as const
    ) {
      let model = cliModel(
        vendor,
        {},
        () => undefined,
        () => Promise.resolve(output),
      )
      let error = await assertRejects(() => model(req))
      assertEquals((error as { code: string }).code, wanted)
      assertEquals(
        spent(error as { code: string }),
        wanted == 'usage_limit_reached',
      )
      assertEquals(String(error).includes('private'), false)
    }
  }
})

test('malformed turns and unsupported inputs never emit partial text or calls', async () => {
  let launched = 0
  let model = cliModel('grok', {}, () => undefined, () => {
    launched++
    return Promise.resolve({
      code: 0,
      stderr: '',
      stdout: stdout('grok', {
        text: 'This is incomplete.',
        calls: [{ name: 'task_read', args: 'null' }],
      }),
    })
  })
  let ask = {
    ...req,
    onText: () => {
      throw new Error('unexpected output')
    },
  }
  let invalid = await assertRejects(() => model(ask))
  assertStringIncludes(String(invalid), 'invalid model turn')
  await assertRejects(() => model({ ...ask, modalities: ['image'] }))
  await assertRejects(() => model({ ...ask, signal: AbortSignal.abort() }))
  assertEquals(launched, 1)
})

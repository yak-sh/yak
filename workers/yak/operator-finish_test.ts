// An Operator conversation on Claude, faked at the Messages API: every tool
// it is offered is one the API takes, and one that cannot finish reaches the
// tracker while the person reads plain words.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { messages } from '@yaks/anthropic'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory } from './operator-testing.ts'
import { operating } from './operator.ts'
import { within } from './defects.ts'

type Event = Record<string, unknown>
let sse = (events: Event[]) =>
  new Response(
    events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )
// One reply: its content blocks, then why it stopped, having read `input`
// tokens.
let counted = (input: number, stop: string, ...blocks: Event[]) =>
  sse([
    {
      type: 'message_start',
      message: {
        id: 'msg_' + crypto.randomUUID(),
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [],
        stop_reason: null,
        usage: { input_tokens: input, output_tokens: 1 },
      },
    },
    ...blocks.flatMap((block, index) => [
      { type: 'content_block_start', index, content_block: block },
      { type: 'content_block_stop', index },
    ]),
    {
      type: 'message_delta',
      delta: { stop_reason: stop },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ])
let reply = (stop: string, ...blocks: Event[]) => counted(1, stop, ...blocks)
let TOLD = ' The people who run yaks.app have been told.'
let text = (t: string, input = 1) =>
  counted(input, 'end_turn', { type: 'text', text: t })

// The API refuses a tool whose schema has a combinator at its root, as it
// refused the Operator's first request on Claude in Jeff's space.
let rooted = (tools: { input_schema: Event }[] = []) =>
  tools.findIndex((t) =>
    ['oneOf', 'anyOf', 'allOf'].some((k) => k in t.input_schema)
  )
// deno-lint-ignore no-explicit-any
let answer: (body: any) => Response = () => text('Done.')
let fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  let url = String(input instanceof Request ? input.url : input)
  let name = url.match(/\/v1\/models\/(.+)$/)?.[1]
  if (name) {
    return Promise.resolve(Response.json({
      type: 'model',
      id: name,
      display_name: name,
      created_at: '2026-01-01T00:00:00Z',
      max_input_tokens: 200_000,
    }))
  }
  let body = JSON.parse(String(init?.body))
  // As the API refuses a request with nothing in its conversation.
  if (!body.messages?.length) {
    return Promise.resolve(Response.json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'messages: at least one message is required',
      },
    }, { status: 400 }))
  }
  let at = rooted(body.tools)
  return Promise.resolve(
    at < 0 ? answer(body) : Response.json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          `tools.${at}.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level`,
      },
    }, { status: 400 }),
  )
}

let owner = crypto.randomUUID()
let reports: Bundle[] = []
let { env } = platform('operator-finish')
env.ERRORS = { send: (rows) => (reports.push(...rows), Promise.resolve()) }
let dir = directoryOf(env.STORE)
let asked = 0
let operator = operating(operatorMemory(), env, {
  model: messages({ key: () => 'k', fetch }),
  name: 'claude-sonnet-5-5',
  tools: () => [{
    name: 'zap',
    description: 'Zap',
    parameters: { type: 'object', properties: {} },
    run: () => Promise.reject(new Error('zap broke')),
  }, {
    name: 'leaflet',
    description: 'A guide longer than a turn keeps',
    parameters: { type: 'object', properties: {} },
    run: () => Promise.resolve('Mail is sent with mail_send. '.repeat(16_000)),
  }],
})
// A conversation in a space of its own, each with its month's budget, and
// the tracker's reports while it ran.
let ask = async (say: string) => {
  let from = reports.length
  let slug = `finish${++asked}`
  let id = await dir.mint(owner, slug, 'Finish', {
    'x-yak-person': owner,
    'x-yak-role': 'owner',
  })
  let space = (await dir.at(id))!
  let out = await within(
    env,
    {},
    () => operator.run({ person: owner }, space, { say }),
  )
  return { ...out, reports: JSON.stringify(reports.slice(from)) }
}

test('on Claude every tool the Operator is offered is one the API takes, so a conversation finishes', async () => {
  let out = await ask('Any app errors recently?')
  assertEquals([out.status, out.text, out.reports], ['settled', 'Done.', '[]'])
})

test("a model's refusal reaches the tracker, and the person reads plain words", async () => {
  answer = () => reply('refusal')
  let out = await ask('Do the thing')
  assertEquals(out.status, 'failed')
  assertEquals(
    out.text,
    "I couldn't finish this: the model declined to do this." + TOLD,
  )
  assertStringIncludes(out.reports, 'Operator could not finish: refusal')
})

test('a request the API refuses reaches the tracker, never shown as its error', async () => {
  answer = () =>
    Response.json({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'messages: bad' },
    }, { status: 400 })
  let out = await ask('Do another thing')
  assertEquals(
    out.text,
    "I couldn't finish this: the model refused the request." + TOLD,
  )
  assertStringIncludes(out.reports, 'Operator could not finish: request')
  assertStringIncludes(out.reports, 'messages: bad')
})

test("yaks.app's credit with Anthropic running out reaches the tracker, and the person reads that the Operator is unavailable", async () => {
  answer = () =>
    Response.json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      },
    }, { status: 400 })
  let out = await ask('Do a third thing')
  assertEquals(
    out.text,
    "I couldn't finish this: the Operator is unavailable for now." + TOLD,
  )
  assertStringIncludes(out.reports, 'Operator could not finish: credit')
})

test('a run that ends without an answer reaches the tracker', async () => {
  answer = () => reply('end_turn')
  let out = await ask('Say nothing')
  assertEquals(out.text, 'This ended without an answer.' + TOLD)
  assertStringIncludes(out.reports, 'Operator could not finish: ended without')
})

test('a step that throws reaches the tracker, and the conversation goes on to its answer', async () => {
  answer = (body) =>
    body.messages.at(-1).content.some((c: Event) => c.type == 'tool_result')
      ? text('Zap failed; nothing changed.')
      : reply('tool_use', {
        type: 'tool_use',
        id: 'tu_' + crypto.randomUUID().slice(0, 8),
        name: 'zap',
        input: {},
      })
  let out = await ask('Zap it')
  assertEquals(out.text, 'Zap failed; nothing changed.')
  assertStringIncludes(out.reports, 'zap broke')
})

test("a conversation long enough to compact is summarized at its space's cost, and goes on to its answer", async () => {
  let summaries = 0
  answer = (body) => {
    let system = JSON.stringify(body.system ?? '')
    if (system.includes('Summarize this transcript')) {
      summaries++
      return text('Earlier, the person described their garden.')
    }
    return text('Noted.', JSON.stringify(body).length / 4)
  }
  let id = await dir.mint(owner, 'finishlong', 'Long', {
    'x-yak-person': owner,
    'x-yak-role': 'owner',
  })
  let space = (await dir.at(id))!
  let from = reports.length
  let task = crypto.randomUUID()
  let out
  for (let i = 0; i < 6; i++) {
    out = await within(
      env,
      {},
      () =>
        operator.run({ person: owner }, space, {
          say: `Part ${i} of my garden: ` + 'tomatoes and beans. '.repeat(4000),
        }, { task }),
    )
  }
  assertEquals([out!.text, JSON.stringify(reports.slice(from))], [
    'Noted.',
    '[]',
  ])
  assertEquals(summaries > 0, true)
})

test('a read so long that compacting summarizes every line still leaves the model a message, and the work goes on to its answer', async () => {
  let summaries = 0
  answer = (body) => {
    if (
      JSON.stringify(body.system ?? '').includes('Summarize this transcript')
    ) {
      summaries++
      return text('The mail guide says mail is sent with mail_send.')
    }
    let read = JSON.stringify(body.messages).includes('mail_send')
    return read
      ? text('Mail goes out with mail_send.')
      : counted(120_000, 'tool_use', {
        type: 'tool_use',
        id: 'tu_' + crypto.randomUUID().slice(0, 8),
        name: 'leaflet',
        input: {},
      })
  }
  let out = await ask('How is mail sent?')
  assertEquals([out.text, out.reports, summaries > 0], [
    'Mail goes out with mail_send.',
    '[]',
    true,
  ])
})

test('a fork that cannot finish reaches the tracker', async () => {
  answer = (body) => {
    let said = JSON.stringify(body.messages)
    return said.includes('fork of the parent')
      ? Response.json({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'messages: forked' },
      }, { status: 400 })
      : said.includes('tool_result') || said.includes('failed')
      ? text('The work could not be done.')
      : reply('tool_use', {
        type: 'tool_use',
        id: 'tu_' + crypto.randomUUID().slice(0, 8),
        name: 'fork',
        input: { prompt: 'Read the mail guide' },
      })
  }
  let out = await ask('Read the mail guide')
  assertStringIncludes(out.reports, '"request":"operator fork"')
  assertStringIncludes(
    out.reports,
    'Operator could not finish: request: 400 messages: forked',
  )
})

// An app's own tools, from the manifest to the act: what tools.json may say,
// how one refusal names every problem in it, and what a call's arguments do
// to a template. The workerd half — the same file through app_deploy and a
// call at the MCP door — is in workers/yak/mcp_test.ts.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { filled, parseTools, schemaOf } from './tools.ts'

let runs = { jog: { who: 'text', miles: 'number' } } as const

let club = {
  log_run: {
    description: 'Log a run',
    input: { who: 'text', miles: 'number' },
    apply: {
      entity: { eid: '$run' },
      jog: { who: '{{who}}', miles: '{{miles}}' },
    },
  },
  leaderboard: {
    description: "This month's runs",
    input: { since: 'time' },
    query: '.jog!&.created.at>={{since}}',
  },
}

Deno.test('tools.json: a sentence, an input, and one act', () => {
  let tools = parseTools(club, runs)
  assertEquals(Object.keys(tools), ['log_run', 'leaderboard'])
  assertEquals(tools.log_run.input, { who: 'text', miles: 'number' })
  assertEquals(tools.leaderboard.query, '.jog!&.created.at>={{since}}')
  // A tool with no arguments is a tool.
  assertEquals(
    parseTools({ all: { description: 'Everything', query: '.jog!' } }).all
      .input,
    {},
  )
})

Deno.test('tools.json: one refusal names every problem', () => {
  let why = (source: unknown, vocab = {}) =>
    assertThrows(() => parseTools(source, vocab), Error).message
  assertStringIncludes(why('not json'), 'tools.json is not JSON')
  assertStringIncludes(why([1]), 'tools.json is an object')
  assertStringIncludes(why({ Log: { description: 'x' } }), 'not a tool name')
  // Every problem at once, so a manifest is fixed in one deploy.
  let all = why({
    log_run: {
      description: 'Log a run',
      input: { miles: 'number' },
      apply: { jog: { who: '{{who}}', miles: '{{miles}}' } },
      view: 'index.html',
    },
    nothing: { description: 'Neither act' },
  })
  assertStringIncludes(all, 'log_run: view — a tool says')
  assertStringIncludes(all, 'log_run: {{who}} names no input')
  assertStringIncludes(all, 'log_run.apply: jog is not a component')
  assertStringIncludes(all, 'nothing does one thing')
  // A word the app declared in its vocab.json is a word its tools may write.
  assertEquals(
    Object.keys(parseTools({ log_run: club.log_run }, runs)),
    ['log_run'],
  )
  assertStringIncludes(
    why({ x: { description: 'x', input: { n: 'int' }, query: '.doc!' } }),
    'x.input.n is "int" — one of text',
  )
  assertStringIncludes(
    why({ x: { input: {}, query: '.doc!' } }),
    'x.description says what the tool does',
  )
  assertStringIncludes(
    why({ x: { description: 'x', apply: {}, query: '.doc!' } }),
    'x does one thing',
  )
})

Deno.test('a tool asks for what it declared', () => {
  let tools = parseTools(club, runs)
  assertEquals(schemaOf(tools.log_run).properties.miles, { type: 'number' })
  assertEquals(schemaOf(tools.log_run).required, ['who', 'miles'])
  assertEquals(
    (schemaOf(tools.leaderboard).properties.since as { type: string }).type,
    'string',
  )
})

Deno.test('the call fills the template, typed by the input', () => {
  let tools = parseTools(club, runs)
  // A string that is nothing but a hole keeps the value's own type: `miles`
  // is a number column, and "5" would be text in it.
  assertEquals(filled(tools.log_run, { who: 'Ada', miles: '5' }), {
    apply: {
      entity: { eid: '$run' },
      jog: { who: 'Ada', miles: 5 },
    },
  })
  // A filter line's value is percent-encoded: the line is a query string, and
  // an `&` in a value would read as the next filter.
  assertEquals(
    filled(tools.leaderboard, { since: '2026-09-01 10:00' }).query,
    '.jog!&.created.at>=2026-09-01%2010%3A00',
  )
  // A hole inside a sentence is spliced in as text.
  let hello = parseTools({
    hi: {
      description: 'Say hi',
      input: { name: 'text' },
      apply: { doc: { title: 'hi {{name}}' } },
    },
  })
  assertEquals(filled(hello.hi, { name: 'Ada' }), {
    apply: { doc: { title: 'hi Ada' } },
  })
  assertEquals(
    assertThrows(() => filled(tools.log_run, { who: 'Ada' }), Error).message,
    'miles is required',
  )
  assertEquals(
    assertThrows(
      () => filled(tools.log_run, { who: 'Ada', miles: 'far' }),
      Error,
    ).message,
    'miles is a number',
  )
})

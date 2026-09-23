// An app's own tools, from the manifest to the act: what tools.json may say,
// how one refusal names every problem in it, and what a call's arguments do
// to a template. The workerd half — the same file through app_deploy and a
// call at the MCP door — is in workers/yak/mcp_test.ts.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { filled, modern, parseTools, schemaOf, viewsOf } from './tools.ts'

let runs = { jog: { who: 'text', miles: 'number' } } as const

let club = {
  log_run: {
    description: 'Log a run',
    input: { who: 'text', miles: 'number' },
    apply: {
      entity: { eid: '$run' },
      jog: { who: '$who', miles: '$miles' },
    },
  },
  leaderboard: {
    description: "This month's runs",
    input: { since: 'time' },
    query: '.jog!&.created.at>=$since',
  },
}

Deno.test('tools.json: a sentence, an input, and one act', () => {
  let tools = parseTools(club, runs)
  assertEquals(Object.keys(tools), ['log_run', 'leaderboard'])
  assertEquals(tools.log_run.input, { who: 'text', miles: 'number' })
  assertEquals(tools.leaderboard.query, '.jog!&.created.at>=$since')
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
      apply: { jog: { who: '$who', miles: '$miles' } },
      screen: 'index.html',
    },
    nothing: { description: 'Neither act' },
  })
  assertStringIncludes(all, 'log_run: screen — a tool says')
  assertStringIncludes(all, 'log_run: $who names no input')
  assertStringIncludes(all, 'log_run.apply: jog is not a component')
  assertStringIncludes(all, 'nothing does one thing')
  // A word the app declared in its vocab.json is a word its tools may write.
  assertEquals(
    Object.keys(parseTools({ log_run: club.log_run }, runs)),
    ['log_run'],
  )
  // A view is a page in the app's own files, and a path that climbs out of
  // them is not one (T-32687).
  for (
    let bad of ['/leaderboard.html', '../other/index.html', 'board', 5]
  ) {
    assertStringIncludes(
      why({ x: { description: 'x', input: {}, query: '.doc!', view: bad } }),
      "x.view is a page in this app's files",
    )
  }
  assertEquals(
    parseTools({
      x: { description: 'x', input: {}, query: '.doc!', view: 'board.html' },
    }).x.view,
    'board.html',
  )
  // The pages a deploy checks against the app's files, each named once; a
  // manifest that will not parse names none and the store says why.
  assertEquals(
    viewsOf('{"a":{"view":"board.html"},"b":{"view":"board.html"}}'),
    ['board.html'],
  )
  assertEquals(viewsOf('not json'), [])
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
  // A string that is nothing but a variable keeps the value's own type:
  // `miles` is a number column, and "5" would be text in it.
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
  // A variable inside a sentence is spliced in as text.
  let hello = parseTools({
    hi: {
      description: 'Say hi',
      input: { name: 'text' },
      apply: { doc: { title: 'hi $name' } },
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

Deno.test('a variable nobody bound is the alias it looks like', () => {
  // `$run` is what the store mints the entity at, and the second bundle points
  // at the same one — the join `$alias` has always meant, now said in the one
  // language a bound variable is said in too.
  let tools = parseTools({
    log_run: {
      description: 'Log a run and note it',
      input: { miles: 'number' },
      apply: [
        { entity: { eid: '$run' }, jog: { miles: '$miles' } },
        { entity: { eid: '$note' }, comment: { about: '$run' } },
      ],
    },
  }, { jog: { miles: 'number' }, comment: { about: 'text' } })
  assertEquals(filled(tools.log_run, { miles: 3 }).apply, [
    { entity: { eid: '$run' }, jog: { miles: 3 } },
    { entity: { eid: '$note' }, comment: { about: '$run' } },
  ])
  // A `$name` that is neither an argument nor an entity here is a typo.
  assertStringIncludes(
    assertThrows(() =>
      parseTools({
        x: {
          description: 'x',
          input: { miles: 'number' },
          apply: { entity: { eid: '$run' }, jog: { miles: '$mile' } },
        },
      }, { jog: { miles: 'number' } }), Error).message,
    'x: $mile names no input and no entity here',
  )
  // `$$` is a dollar sign, not a variable.
  let money = parseTools({
    price: {
      description: 'Price it',
      input: { n: 'number' },
      apply: { doc: { title: '$$$n' } },
    },
  })
  assertEquals(filled(money.price, { n: 5 }).apply, {
    doc: { title: '$5' },
  })
})

Deno.test('a manifest written when {{arg}} was the hole still reads, and no longer deploys', () => {
  // What is already in a store is upgraded on the way out (declared.ts
  // `toolsOf`); what a deploy hands in is refused, in the sentence that says
  // what to write instead.
  assertEquals(
    modern({ apply: { doc: { title: 'hi {{name}}', body: '{{body}}' } } }),
    { apply: { doc: { title: 'hi $name', body: '$body' } } },
  )
  assertStringIncludes(
    assertThrows(() =>
      parseTools({
        x: {
          description: 'x',
          input: { name: 'text' },
          apply: { doc: { title: '{{name}}' } },
        },
      }), Error).message,
    'x: {{arg}} is not a hole any more — write $arg',
  )
})

// An app's own tools, from the manifest to the act: what a `"tool": true`
// entry may say, how one refusal names every problem in it, and what a call's
// arguments do to a template. The kernel half — the same file through
// app_deploy and a call at the MCP door — is in workers/yak/mcp_test.ts.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { filled, parseTools, schemaOf, viewsOf } from './tools.ts'

// The components the app's store knows, which a template may write.
let runs = ['jog']

let NUMBER = { type: 'number' }
let TEXT = { type: 'string' }

// A manifest of these tools, beside a component that is not one.
let doc = (tools: Record<string, object>) => ({
  $defs: {
    jog: { properties: { miles: NUMBER } },
    ...Object.fromEntries(
      Object.entries(tools).map(([name, t]) => [name, { tool: true, ...t }]),
    ),
  },
})

let club = {
  log_run: {
    description: 'Log a run',
    input: { who: TEXT, miles: NUMBER },
    required: ['who', 'miles'],
    apply: {
      entity: { eid: '$run' },
      jog: { who: '$who', miles: '$miles' },
    },
  },
  leaderboard: {
    description: "This month's runs",
    input: { since: TEXT },
    required: ['since'],
    query: '.jog&.created.at>=$since',
  },
}

let parsed = (tools: Record<string, object>, words: string[] = runs) =>
  parseTools(doc(tools), words)

Deno.test('a tool entry: a sentence, its arguments, and one act', () => {
  let tools = parsed(club)
  assertEquals(Object.keys(tools), ['log_run', 'leaderboard'])
  assertEquals(tools.log_run.input, { who: TEXT, miles: NUMBER })
  assertEquals(tools.leaderboard.query, '.jog&.created.at>=$since')
  // A tool with no arguments is a tool, and a component is not one.
  assertEquals(
    parsed({ all: { description: 'Everything', query: '.jog' } }).all.input,
    {},
  )
  assertEquals(parseTools({ $defs: { jog: {} } }), {})
  assertEquals(parseTools('{}'), {})
})

Deno.test('a manifest: one refusal names every problem', () => {
  let why = (tools: unknown, words: string[] = []) =>
    assertThrows(
      () =>
        parseTools(
          typeof tools == 'string' ? tools : doc(tools as never),
          words,
        ),
      Error,
    ).message
  assertStringIncludes(why('not json'), 'vocab.json is not JSON')
  assertStringIncludes(why({ Log: { description: 'x' } }), 'not a tool name')
  // Every problem at once, so a manifest is fixed in one deploy.
  let all = why({
    log_run: {
      description: 'Log a run',
      input: { miles: NUMBER },
      apply: { jog: { who: '$who', miles: '$miles' } },
      screen: 'index.html',
    },
    nothing: { description: 'Neither act' },
  })
  assertStringIncludes(all, 'vocab.json: log_run: screen — a tool says')
  assertStringIncludes(all, 'log_run: $who names no input')
  assertStringIncludes(all, 'log_run.apply: jog is not a component')
  assertStringIncludes(all, 'nothing does one thing')
  // A component the store knows is one its tools may write.
  assertEquals(
    Object.keys(parsed({ log_run: club.log_run })),
    ['log_run'],
  )
  // A view is a page in the app's own files, and a path that climbs out of
  // them is not one (T-32687).
  for (
    let bad of ['/leaderboard.html', '../other/index.html', 'board', 5]
  ) {
    assertStringIncludes(
      why({ x: { description: 'x', query: '.doc', view: bad } }),
      "x.view is a page in this app's files",
    )
  }
  assertEquals(
    parsed({ x: { description: 'x', query: '.doc', view: 'board.html' } }).x
      .view,
    'board.html',
  )
  // The pages a deploy checks against the app's files, each named once; a
  // manifest that will not parse names none and parseTools says why.
  assertEquals(
    viewsOf(doc({ a: { view: 'board.html' }, b: { view: 'board.html' } })),
    ['board.html'],
  )
  assertEquals(viewsOf('not json'), [])
  // An argument is a JSON Schema; the word it once was is refused by name.
  assertStringIncludes(
    why({ x: { description: 'x', input: { n: 'number' }, query: '.doc' } }),
    'x.input.n is "number" — an argument is a JSON Schema',
  )
  assertStringIncludes(
    why({
      x: {
        description: 'x',
        input: { n: NUMBER },
        required: ['m'],
        query: '.doc',
      },
    }),
    'x.required: m is no input of x',
  )
  assertStringIncludes(
    why({ x: { query: '.doc' } }),
    'x.description says what the tool does',
  )
  assertStringIncludes(
    why({ x: { description: 'x', apply: {}, query: '.doc' } }),
    'x does one thing',
  )
})

Deno.test('a tool asks for what it declared', () => {
  let tools = parsed(club)
  assertEquals(schemaOf(tools.log_run).properties.miles, NUMBER)
  assertEquals(schemaOf(tools.log_run).required, ['who', 'miles'])
  assertEquals(schemaOf(tools.leaderboard).properties.since, TEXT)
})

Deno.test('the call fills the template, typed by the input', () => {
  let tools = parsed(club)
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
    '.jog&.created.at>=2026-09-01%2010%3A00',
  )
  // A variable inside a sentence is spliced in as text.
  let hello = parsed({
    hi: {
      description: 'Say hi',
      input: { name: TEXT },
      apply: { doc: { title: 'hi $name' } },
    },
  }, ['doc'])
  assertEquals(filled(hello.hi, { name: 'Ada' }), {
    apply: { doc: { title: 'hi Ada' } },
  })
  // An argument nobody required, left out, takes its key with it.
  assertEquals(filled(hello.hi, {}), { apply: { doc: {} } })
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
  let tools = parsed({
    log_run: {
      description: 'Log a run and note it',
      input: { miles: NUMBER },
      apply: [
        { entity: { eid: '$run' }, jog: { miles: '$miles' } },
        { entity: { eid: '$note' }, comment: { about: '$run' } },
      ],
    },
  }, ['jog', 'comment'])
  assertEquals(filled(tools.log_run, { miles: 3 }).apply, [
    { entity: { eid: '$run' }, jog: { miles: 3 } },
    { entity: { eid: '$note' }, comment: { about: '$run' } },
  ])
  // A `$name` that is neither an argument nor an entity here is a typo.
  assertStringIncludes(
    assertThrows(() =>
      parsed({
        x: {
          description: 'x',
          input: { miles: NUMBER },
          apply: { entity: { eid: '$run' }, jog: { miles: '$mile' } },
        },
      }), Error).message,
    'x: $mile names no input and no entity here',
  )
  // `$$` is a dollar sign, not a variable.
  let money = parsed({
    price: {
      description: 'Price it',
      input: { n: NUMBER },
      apply: { doc: { title: '$$$n' } },
    },
  }, ['doc'])
  assertEquals(filled(money.price, { n: 5 }).apply, {
    doc: { title: '$5' },
  })
})

Deno.test('a manifest written with the {{arg}} hole no longer deploys', () => {
  // Refused in the sentence that says what to write instead.
  assertStringIncludes(
    assertThrows(() =>
      parsed({
        x: {
          description: 'x',
          input: { name: TEXT },
          apply: { doc: { title: '{{name}}' } },
        },
      }), Error).message,
    'x: {{arg}} is not a hole any more — write $arg',
  )
})

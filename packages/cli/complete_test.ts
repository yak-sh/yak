/// <reference lib="deno.ns" />
// Completion, derived from the same schema the line is run through. The two
// answers a graph owns arrive as two functions; everything else is the
// declaration reading itself.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { complete, type Lookup } from './complete.ts'
import { argsFor, commandFor, type Grammar, tokensIn } from './args.ts'

let tools: Grammar[] = [
  {
    noun: 'session',
    verb: 'list',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', examples: ['root', 'fleet'] },
        status: { type: 'string', enum: ['open', 'done'] },
        all: { type: 'boolean' },
        task: { type: 'string', ref: 'task' },
        words: { type: 'string', search: true },
      },
    },
    positional: ['scope'],
  },
  { noun: 'session', verb: 'show' },
  { name: 'apply' },
]

let look: Lookup = {
  ids: (comp, prefix) =>
    [`${comp}-1`, `${comp}-2`].filter((i) => i.includes(prefix)),
  hits: (prefix) => [`${prefix}ing water`, 'unrelated'],
}

let said = (line: string, l: Lookup = {}) => complete(tools, line, l)

test('the first word is every word a tool answers to, either half', async () => {
  assertEquals(await said(''), ['apply', 'list', 'session', 'show'])
  assertEquals(await said('s'), ['session', 'show'])
  // One word in, the other half of the pair — both orders, same list.
  assertEquals(await said('session '), ['list', 'show'])
  assertEquals(await said('list '), ['session'])
  assertEquals(await said('list s'), ['session'])
  assertEquals(await said('nonsense '), [])
})

test('options are the schema’s properties, minus the ones already said', async () => {
  assertEquals(await said('session list --'), [
    '--all',
    '--scope',
    '--status',
    '--task',
    '--words',
  ])
  assertEquals(await said('session list --status=open --a'), ['--all'])
  assertEquals(await said('list session --sc'), ['--scope'])
})

test('a value is what its property says it may be', async () => {
  // An enum offers its members; a boolean offers both; examples offer
  // themselves. Either word order, because the tool is the same tool.
  assertEquals(await said('session list --status '), ['done', 'open'])
  assertEquals(await said('session list --status d'), ['done'])
  assertEquals(await said('list session --all '), ['false', 'true'])
  assertEquals(await said('session list '), ['fleet', 'root'])
  assertEquals(await said('session list r'), ['root'])
  // `--name=` is the form that takes a word beginning with a dash.
  assertEquals(await said('session list --status=o'), ['--status=open'])
})

test('a ref and a searched text are the graph’s to answer, or nobody’s', async () => {
  assertEquals(await said('session list --task '), [])
  assertEquals(await said('session list --task ', look), ['task-1', 'task-2'])
  assertEquals(await said('session list --task task-1', look), ['task-1'])
  assertEquals(await said('session list --words wat', look), ['"wating water"'])
})

test('a shell hook’s words are the same question as a line', async () => {
  assertEquals(await complete(tools, ['session', 'li']), ['list'])
  assertEquals(await complete(tools, ['session', 'list', '']), [
    'fleet',
    'root',
  ])
})

// A name may hold a space, a quote or a backslash: whatever completion offers
// for it, put back on the line, is read by the grammar as the name itself.
let names = ['Bristleboar', 'Big boar', 'Boar "king"', 'Boar\\den']
let beast: Grammar = {
  name: 'spawn',
  inputSchema: {
    type: 'object',
    properties: {
      beast: { type: 'string', ref: 'beast' },
      on: { type: 'boolean' },
    },
    required: ['beast'],
  },
  positional: ['beast'],
}
let beasts: Lookup = { ids: () => names }

let roundTrips = async (prefix: string) => {
  let offers = await complete([beast], prefix, beasts)
  let last = tokensIn(prefix, true).at(-1)!
  let read: string[] = []
  for (let offer of offers) {
    let words = tokensIn(prefix.slice(0, last.from) + offer).map((w) => w.value)
    let found = commandFor([beast], words)!
    read.push(String((await argsFor(found.verb, found.args)).beast))
  }
  assertEquals(read.sort(), [...names].sort())
}

test('offered entity words round-trip through the grammar as a positional', async () => {
  await roundTrips('spawn b')
  await roundTrips('spawn "b')
})

test('offered entity words round-trip through the grammar in both flag forms', async () => {
  await roundTrips('spawn --beast b')
  await roundTrips('spawn --beast=b')
})

test('a shell hook is offered entity words as they are', async () => {
  assertEquals(
    await complete([beast], ['spawn', '--beast', 'B'], beasts),
    [...names].sort(),
  )
})

test('completion refuses invalid preceding values and missing flag values', async () => {
  assertEquals(await said('session list --status bogus --'), [])
  assertEquals(await said('session list --status --task '), [])
  assertEquals(await said('session list --unknown x --'), [])
  assertEquals(await said('session list --status --'), [])
  assertEquals(await said('session list --all false --st'), ['--status'])
  assertEquals(await said('session list --all=false --st'), ['--status'])
  assertEquals(await said('session list --scope fleet '), [])
  assertEquals(await said('session list -- --'), [])
})

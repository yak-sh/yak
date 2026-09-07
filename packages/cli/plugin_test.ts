/// <reference lib="deno.ns" />
// The seam at its pure seam: tables merge in the order they were given, one
// usage draws them all, and an app's command becomes the `command` call it
// stands for. Nothing here opens a socket — `ask` is a function that records
// what it was asked.

import { assert, assertEquals, assertRejects } from '@std/assert'
import { Usage } from './args.ts'
import { commands } from './commands.ts'
import { type Ctx, parts, type Plugin, usage, verbFor } from './plugin.ts'

let asked: { name: string; arguments: Record<string, unknown> }[] = []
let printed: string[] = []

let ctx = (plugins: Plugin[], word = '', args: string[] = []): Ctx => ({
  host: 'yaks.test',
  word,
  args,
  json: false,
  help: false,
  ask: (_method, params) => {
    asked.push(params as typeof asked[number])
    return Promise.resolve({ content: [{ type: 'text', text: 'done' }] })
  },
  reads: { file: () => 'FILE', stdin: () => 'STDIN' },
  out: (line) => printed.push(line),
  note: (line) => printed.push(line),
  plugins,
})

let saying = (name: string, about: string): Plugin => ({
  name,
  about,
  verbs: () => [
    { name, about: `the ${name} verb`, run: () => 0 },
    {
      name: 'both',
      about: `${name}’s both`,
      run: () => (printed.push(name), 0),
    },
  ],
})

let one = saying('one', 'the first table')
let two = saying('two', 'the second table')

Deno.test('two plugins are one table, and the first to name a verb wins', async () => {
  printed = []
  let c = ctx([one, two])
  assertEquals((await verbFor([one, two], c, 'one'))?.name, 'one')
  assertEquals((await verbFor([one, two], c, 'two'))?.name, 'two')
  await (await verbFor([one, two], c, 'both'))!.run(c)
  assertEquals(printed, ['one'])
  await (await verbFor([two, one], c, 'both'))!.run(c)
  assertEquals(printed, ['one', 'two'])
  assertEquals(await verbFor([one, two], c, 'neither'), undefined)
})

Deno.test('one usage renders every plugin under its own heading', async () => {
  let page = usage(await parts([one, two, commands], ctx([])))
  assert(page.includes('the first table'), page)
  assert(page.includes('the second table'), page)
  assert(page.includes('the apps’ own commands'), page)
  // One column across the sections, so it reads as one page.
  assert(page.includes('  one      '), page)
  assert(page.includes('  command <name> [key=value ...]  '), page)
  // `both` is named by both tables and reachable in one: it is drawn once,
  // under the table that answers for it.
  assertEquals(page.match(/^ {2}both\b/gm)?.length, 1)
  assert(page.includes('one’s both'), page)
})

Deno.test('a plugin that cannot answer says so instead of taking the page down', async () => {
  let broken: Plugin = {
    name: 'broken',
    about: 'the broken table',
    verbs: () => {
      throw new Error('no server')
    },
  }
  let page = usage(await parts([one, broken], ctx([])))
  assert(page.includes('the one verb'), page)
  assert(page.includes('  (no server)'), page)
})

Deno.test('`yak command` builds the command call, with the app it was given', async () => {
  asked = []
  let c = ctx([commands], 'command', [
    'add_recipe',
    '--app',
    'recipes',
    'title=Lemon cake',
    'serves=4',
  ])
  assertEquals(await (await verbFor([commands], c, 'command'))!.run(c), 0)
  assertEquals(asked, [{
    name: 'command',
    arguments: {
      name: 'add_recipe',
      app: 'recipes',
      // JSON where it parses as JSON, the word itself otherwise.
      args: { title: 'Lemon cake', serves: 4 },
    },
  }])
})

Deno.test('`yak <app> <command>` is the same call, the app named by the word', async () => {
  asked = []
  let c = ctx([commands], 'recipes', ['add_recipe', 'title=@page.md'])
  let verb = await verbFor([commands], c, 'recipes')
  assertEquals(verb?.name, 'recipes')
  await verb!.run(c)
  assertEquals(asked, [{
    name: 'command',
    // @path is that file, the same spelling every value here takes.
    arguments: { name: 'add_recipe', app: 'recipes', args: { title: 'FILE' } },
  }])
})

Deno.test('a stray needs a second word, and a verb of its own is never one', async () => {
  // One word alone names nothing: `yak recipes` is a typo, not a command.
  assertEquals(
    await verbFor([commands], ctx([], 'recipes', []), 'recipes'),
    undefined,
  )
  assertEquals(
    await verbFor([commands], ctx([], 'recipes', ['--json']), 'recipes'),
    undefined,
  )
  // And a table that names the word answers before any stray is asked.
  let c = ctx([one, commands], 'one', ['add_recipe'])
  assertEquals(
    (await verbFor([one, commands], c, 'one'))?.about,
    'the one verb',
  )
})

Deno.test('an argument that is not key=value is a usage error, not a round trip', async () => {
  asked = []
  let c = ctx([commands], 'command', ['add_recipe', 'lemon'])
  let verb = (await verbFor([commands], c, 'command'))!
  await assertRejects(() => Promise.resolve(verb.run(c)), Usage, 'key=value')
  assertEquals(asked, [])
})

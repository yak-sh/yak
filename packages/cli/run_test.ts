/// <reference lib="deno.ns" />
// The runner at its pure seam: a list of tools is the whole registry, the
// first to name a word wins, one usage draws them all, a two-word tool answers
// to either order, and an app's command becomes the `command` call it stands
// for. Nothing here opens a socket — `ask` is a function that records what it
// was asked.

import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Tool } from '@yaks/graph'
import { toolDefinition } from '@yaks/vocab/tools'
import { argsFor, type Reads, Usage } from './args.ts'
import { appStray, appTools } from './commands.ts'
import {
  cli,
  type Command,
  commandFor,
  helpTool,
  type Opts,
  unique,
  usage,
} from './run.ts'
import { commandOf } from './tool.ts'

let asked: { name: string; arguments: Record<string, unknown> }[] = []
let printed: string[] = []

let reads: Reads = { file: () => 'FILE', stdin: () => 'STDIN' }

let ran = (tools: Command[], argv: string[], opts: Opts = {}) => {
  asked = []
  printed = []
  return cli(tools, {
    argv,
    host: 'yaks.test',
    reads,
    out: (l) => printed.push(l),
    note: (l) => printed.push(l),
    ask: (_method, params) => {
      asked.push(params as typeof asked[number])
      return Promise.resolve({ content: [{ type: 'text', text: 'done' }] })
    },
    ...opts,
  })
}

let saying = (name: string): Command[] => [
  { name, description: `the ${name} word`, run: () => 0 },
  {
    name: 'both',
    description: `${name}’s both`,
    run: () => (printed.push(name), 0),
  },
]

let one = saying('one')
let two = saying('two')

Deno.test('one list is the registry, and the first to name a word wins', async () => {
  assertEquals(await ran([...one, ...two], ['one']), 0)
  assertEquals(await ran([...one, ...two], ['both']), 0)
  assertEquals(printed, ['one'])
  assertEquals(await ran([...two, ...one], ['both']), 0)
  assertEquals(printed, ['two'])
  assertEquals(await ran([...one, ...two], ['neither']), 2)
  assert(printed.join('\n').includes('nothing called neither'), printed[0])
})

Deno.test('two tools that answer to one line are refused, either order', () => {
  let t = { noun: 'session', verb: 'list', description: '', run: () => 0 }
  unique([t])
  assertThrows(() => unique([t, t]), Error, 'two tools answer to')
  assertThrows(
    () => unique([t, { ...t, noun: 'list', verb: 'session' }]),
    Error,
    'two tools answer to',
  )
})

Deno.test('a two-word tool answers to either order, and gives up both words', () => {
  let t = { noun: 'session', verb: 'list', description: '', run: () => 0 }
  assertEquals(commandFor([t], ['session', 'list', '--all'])?.args, ['--all'])
  assertEquals(commandFor([t], ['list', 'session', '--all'])?.args, ['--all'])
  assertEquals(commandFor([t], ['list']), undefined)
})

Deno.test('a tool that said one word answers to that word, and eats one', () => {
  let noun = { noun: 'history', description: '', run: () => 0 }
  let verb = { verb: 'land', description: '', run: () => 0 }
  assertEquals(commandOf(noun), 'history')
  assertEquals(commandOf(verb), 'land')
  assertEquals(commandFor([noun], ['history', 'T-5'])?.args, ['T-5'])
  assertEquals(commandFor([verb], ['land', '--allow-revert=x'])?.args, [
    '--allow-revert=x',
  ])
  unique([noun, verb])
  assertThrows(() => unique([noun, noun]), Error, 'two tools answer to')
})

Deno.test('one usage draws every tool, one column throughout', async () => {
  await ran([...one, ...appTools], [], {
    about: 'the head',
    notes: 'the tail',
  })
  let page = printed.join('\n')
  assert(page.startsWith('the head'), page)
  assert(page.endsWith('the tail'), page)
  // `both` is named once and drawn once, under the tool that answers for it.
  assertEquals(page.match(/^ {2}both\b/gm)?.length, 1)
  assert(page.includes('one’s both'), page)
  assert(
    page.includes('  command <name> [key=value ...] [--app <string>]  '),
    page,
  )
})

Deno.test('a table that cannot be had is a reason on the page, not no page', async () => {
  await ran(one, [], {
    more: () => {
      throw new Error('no server')
    },
  })
  let page = printed.join('\n')
  assert(page.includes('the one word'), page)
  assert(page.includes('(no server)'), page)
})

Deno.test('a table that costs a round trip is not asked on a line that misses it', async () => {
  let asks = 0
  let more = () => {
    asks++
    return [{ name: 'far', description: 'over there', run: () => 0 }]
  }
  assertEquals(await ran(one, ['one'], { more }), 0)
  assertEquals(asks, 0)
  assertEquals(await ran(one, ['far'], { more }), 0)
  assertEquals(asks, 1)
})

Deno.test('a word a cached table lacks is asked past the cache before it is an app', async () => {
  let fresh: boolean[] = []
  let more: Opts['more'] = (_c, o) => {
    fresh.push(!!o?.fresh)
    return [
      o?.fresh
        ? { noun: 'task', verb: 'list', description: '', run: () => 7 }
        : { name: 'task_list', description: '', run: () => 0 },
    ]
  }
  assertEquals(await ran([], ['task', 'list'], { more, stray: appStray }), 7)
  assertEquals(fresh, [false, true])
  assertEquals(asked, [])
})

Deno.test('`yak command` builds the command call, with the app it was given', async () => {
  assertEquals(
    await ran(appTools, [
      'command',
      'add_recipe',
      '--app',
      'recipes',
      'title=Lemon cake',
      'serves=4',
    ]),
    0,
  )
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
  assertEquals(
    // Aimed at a host: a machine with its own graph opens that instead.
    await ran(appTools, [
      '--host',
      'yaks.test',
      'recipes',
      'add_recipe',
      'title=@page.md',
    ], { stray: appStray }),
    0,
  )
  assertEquals(asked, [{
    name: 'command',
    // @path is that file, the same syntax every value here takes.
    arguments: { name: 'add_recipe', app: 'recipes', args: { title: 'FILE' } },
  }])
})

Deno.test('a host whose tool list fails says why, and reads no arguments', async () => {
  let refused = () => Promise.reject(new Error('connection refused'))
  assertEquals(
    await ran(appTools, ['graph', 'show', 'M-4455'], {
      stray: appStray,
      more: refused,
    }),
    1,
  )
  assertEquals(printed, ['yak: connection refused'])
  assertEquals(asked, [])
})

Deno.test('a stray needs a second word, and a tool of its own is never one', async () => {
  // One word alone names nothing: `yak recipes` is a typo, not a command.
  assertEquals(await ran(appTools, ['recipes'], { stray: appStray }), 2)
  assertEquals(
    await ran(appTools, ['recipes', '--json'], {
      stray: appStray,
    }),
    2,
  )
  assertEquals(asked, [])
  // And a table that names the word answers before any stray is asked.
  assertEquals(
    await ran([...one, ...appTools], ['one', 'add_recipe'], {
      stray: appStray,
    }),
    2,
  )
  assertEquals(asked, [])
})

Deno.test('a line that opened a graph asks no host about a word the graph lacks', async () => {
  assertEquals(
    await ran(appTools, ['--config', 'here.json', 'show', 'T-1'], {
      stray: appStray,
    }),
    2,
  )
  assertEquals(asked, [])
  assert(printed.join('\n').includes('here.json has nothing called show'))
})

Deno.test('a word the graph found at home lacks is the host’s, run as the host’s', async () => {
  // The graph here lists `mine`; the host lists `theirs`. `more` answers by
  // where it was aimed, the way yak.ts's table does.
  let aimedAt: (string | undefined)[] = []
  let more: Opts['more'] = (c) => {
    aimedAt.push(c.config)
    return [{
      name: c.config ? 'mine' : 'theirs',
      description: '',
      run: (_args, c) => (printed.push(`ran at ${c.config ?? c.host}`), 0),
    }]
  }
  let home = (name: string) => name == 'YAK_CONFIG' ? 'home.json' : undefined
  assertEquals(await ran([], ['theirs'], { more, env: home }), 0)
  assertEquals(printed, ['ran at yaks.test'])
  assertEquals(await ran([], ['mine'], { more, env: home }), 0)
  assertEquals(printed, ['ran at home.json'])
  // A word neither has is a usage error naming both.
  assertEquals(await ran([], ['nobody'], { more, env: home }), 2)
  assert(printed.join('\n').includes('neither home.json nor yaks.test'))
  // A config the line named is the one place it means: no host is asked.
  aimedAt = []
  assertEquals(
    await ran([], ['--config', 'here.json', 'theirs'], { more, env: home }),
    2,
  )
  assertEquals(aimedAt.includes(undefined), false)
})

Deno.test('an argument that is not key=value is a usage error, not a round trip', async () => {
  assertEquals(await ran(appTools, ['command', 'add_recipe', 'lemon']), 2)
  assert(printed.join('\n').includes('key=value'), printed.join('\n'))
  assertEquals(asked, [])
})

// One declaration, read by a command line the way a transport reads it.
let t: Tool = {
  ...toolDefinition({
    noun: 'session',
    verb: 'list',
    description: 'sessions',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['scope'],
      properties: {
        scope: { type: 'string' },
        limit: { type: 'integer', minimum: 1, default: 20 },
        all: { type: 'boolean' },
        status: { type: 'string', enum: ['open', 'done'] },
      },
    },
    options: { positional: ['scope'], short: { n: 'limit', a: 'all' } },
  }),
  run: () => [],
}
let said = (argv: string[]) => argsFor(t, argv, reads)

Deno.test('JSON schema arguments provide typed options validation and defaults', async () => {
  assertEquals(
    await said(['root', '-n', '3', '-a', '--status=done']),
    { scope: 'root', limit: 3, all: true, status: 'done' },
  )
  assertEquals(await said(['root']), { scope: 'root', limit: 20 })
  await assertRejects(() => said(['root', '--limit=0']), Usage, 'Invalid tool')
  await assertRejects(() => said([]), Usage, 'Invalid tool')
  await assertRejects(
    () => said(['root', '--status=bad']),
    Usage,
    'Invalid tool',
  )
  await assertRejects(
    () => said(['root', '--unknown']),
    Usage,
    'Unknown option',
  )
  await assertRejects(
    () => said(['root', '--limit=1.5']),
    Usage,
    'Invalid tool',
  )
  assertEquals((await said(['--', '--literal'])).scope, '--literal')
})

Deno.test('declaration is JSON Schema validated without component association', () => {
  assertThrows(
    () => toolDefinition({ noun: ['session'], verb: 'list', description: '' }),
    Error,
  )
  assertThrows(
    () =>
      toolDefinition({
        noun: 'session',
        verb: 'list',
        description: '',
        options: { short: { z: 'absent' } },
      }),
    Error,
    'unknown property',
  )
})

Deno.test('a usage page with no head or tail is only the tools', () => {
  assertEquals(usage(one), '  one   the one word\n  both  one’s both')
})

// The verbs of a noun read as one block under it, and a tool that said one
// word alone stands above them — `search` is not a kind of `graph`.
let tiered: Command[] = [
  { name: 'search', verb: 'search', description: 'Search', run: () => 0 },
  { noun: 'graph', verb: 'apply', description: 'Apply', run: () => 0 },
  { noun: 'graph', verb: 'query', description: 'Query', run: () => 0 },
]

Deno.test('a usage page gathers a noun’s verbs under it', () => {
  assertEquals(
    usage(tiered),
    '  search  Search\n\ngraph\n  apply   Apply\n  query   Query',
  )
})

Deno.test('a noun alone is a page of its verbs, by either door', async () => {
  assertEquals(await ran(tiered, ['graph']), 0)
  assertEquals(printed, ['graph\n  apply  Apply\n  query  Query'])
  assertEquals(await ran([helpTool(), ...tiered], ['help', 'graph']), 0)
  assertEquals(printed, ['graph\n  apply  Apply\n  query  Query'])
  // `yak graph --help` is the same line with the flag lifted off it.
  assertEquals(await ran(tiered, ['graph', '--help']), 0)
  assertEquals(printed, ['graph\n  apply  Apply\n  query  Query'])
  // And a word nobody holds is still a usage error.
  assertEquals(await ran(tiered, ['nonsense']), 2)
})

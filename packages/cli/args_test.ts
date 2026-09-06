import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { argsFor, type Reads, saidIn, Usage, valueOf } from './args.ts'
import type { Tool } from './tool.ts'

let reads: Reads = {
  file: (path) => `<${path}>`,
  stdin: () => 'from stdin',
}

let tool: Tool = {
  name: 'app_files',
  inputSchema: {
    type: 'object',
    required: ['app'],
    properties: {
      app: { type: 'string' },
      path: { type: 'string' },
      content: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number' },
      deploy: { type: 'boolean' },
      meta: { type: 'object' },
    },
  },
}

let args = (argv: string[]) => argsFor(tool, argv, reads)

Deno.test('a line splits into options, values and bare words', () => {
  assertEquals(saidIn(['--q', '.recipe!']), {
    opts: [['q', '.recipe!']],
    words: [],
  })
  // A flag is a name with nothing after it, or a name followed by another
  // option; `--name=value` is how a value starting with -- is given at all.
  assertEquals(saidIn(['--deploy', '--app', 'x']), {
    opts: [['deploy', true], ['app', 'x']],
    words: [],
  })
  assertEquals(saidIn(['--q=--weird', 'stray']), {
    opts: [['q', '--weird']],
    words: ['stray'],
  })
})

Deno.test('a value is what its property says it is', () => {
  // A string stays a string even when it looks like JSON.
  assertEquals(valueOf('a', '42', { type: 'string' }), '42')
  assertEquals(valueOf('a', '42', { type: 'number' }), 42)
  assertEquals(valueOf('a', 'true', { type: 'boolean' }), true)
  assertEquals(valueOf('a', '{"x":1}', { type: 'object' }), { x: 1 })
  assertEquals(valueOf('a', '["x"]', { type: 'array' }), ['x'])
  // One item for an array is the item, wrapped — repeating the option is how
  // a list is typed without quoting brackets past a shell.
  assertEquals(valueOf('a', '.doc!', { type: 'array' }), ['.doc!'])
  // A union with null reads by the type that is not null.
  assertEquals(valueOf('a', '7', { type: ['number', 'null'] }), 7)
  assertThrows(() => valueOf('a', 'lots', { type: 'number' }), Usage)
  assertThrows(() => valueOf('a', 'nope', { type: 'object' }), Usage)
})

Deno.test('@file inflates, - is stdin, and both happen before the type', async () => {
  assertEquals(await args(['--app', 'r', '--content', '@index.html']), {
    app: 'r',
    content: '<index.html>',
  })
  assertEquals(await args(['--app', 'r', '--content', '-']), {
    app: 'r',
    content: 'from stdin',
  })
  // An object read out of a file is still parsed as one.
  assertEquals(
    await argsFor(tool, ['--app', 'r', '--meta', '@m.json'], {
      ...reads,
      file: () => '{"x":1}',
    }),
    { app: 'r', meta: { x: 1 } },
  )
})

Deno.test('a repeated option builds the list its property asked for', async () => {
  assertEquals(await args(['--app', 'r', '--files', 'a', '--files', 'b']), {
    app: 'r',
    files: ['a', 'b'],
  })
})

Deno.test('a bare flag is a boolean, and only a boolean', async () => {
  assertEquals(await args(['--app', 'r', '--deploy']), {
    app: 'r',
    deploy: true,
  })
  await assertRejects(() => args(['--app', 'r', '--path']), Usage)
})

Deno.test('the command line is refused before the round trip', async () => {
  // A name the tool does not declare, a required one nobody gave, and a bare
  // word where a name belongs.
  await assertRejects(() => args(['--app', 'r', '--nmae', 'x']), Usage)
  await assertRejects(() => args(['--path', 'index.html']), Usage)
  await assertRejects(() => args(['recipes']), Usage)
})

Deno.test('a tool with no schema takes nothing', async () => {
  assertEquals(await argsFor({ name: 'app_list' }, [], reads), {})
  await assertRejects(
    () => argsFor({ name: 'app_list' }, ['--app', 'r'], reads),
    Usage,
  )
})

import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  argsFor,
  pairsIn,
  type Reads,
  saidIn,
  scanned,
  Usage,
  valueOf,
} from './args.ts'
import type { Listed as Tool } from './tool.ts'

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

test('a line splits into options, values and bare words', () => {
  assertEquals(saidIn(['--q', '.recipe']), {
    opts: [['q', '.recipe']],
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

test('a value is what its property says it is', () => {
  // A string stays a string even when it looks like JSON.
  assertEquals(valueOf('a', '42', { type: 'string' }), '42')
  assertEquals(valueOf('a', '42', { type: 'number' }), 42)
  assertEquals(valueOf('a', 'true', { type: 'boolean' }), true)
  assertEquals(valueOf('a', '{"x":1}', { type: 'object' }), { x: 1 })
  assertEquals(valueOf('a', '["x"]', { type: 'array' }), ['x'])
  // One item for an array is the item, wrapped — repeating the option is how
  // a list is typed without quoting brackets past a shell.
  assertEquals(valueOf('a', '.doc', { type: 'array' }), ['.doc'])
  // A union with null reads by the type that is not null.
  assertEquals(valueOf('a', '7', { type: ['number', 'null'] }), 7)
  assertThrows(() => valueOf('a', 'lots', { type: 'number' }), Usage)
  assertThrows(() => valueOf('a', 'nope', { type: 'object' }), Usage)
})

test('@file inflates, - is stdin, and both happen before the type', async () => {
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

test('a repeated option builds the list its property asked for', async () => {
  assertEquals(await args(['--app', 'r', '--files', 'a', '--files', 'b']), {
    app: 'r',
    files: ['a', 'b'],
  })
  // Where the list also takes the bare words, they join it.
  let listing = { ...tool, options: { positional: ['app'], rest: 'files' } }
  assertEquals(
    await argsFor(listing, ['r', '--files', 'a', 'b', 'c'], reads),
    { app: 'r', files: ['a', 'b', 'c'] },
  )
})

test('a bare flag is a boolean, and only a boolean', async () => {
  assertEquals(await args(['--app', 'r', '--deploy']), {
    app: 'r',
    deploy: true,
  })
  await assertRejects(() => args(['--app', 'r', '--path']), Usage)
})

test('the command line is refused before the round trip', async () => {
  // A name the tool does not declare, a required one nobody gave, and a bare
  // word where a name belongs.
  await assertRejects(() => args(['--app', 'r', '--nmae', 'x']), Usage)
  await assertRejects(() => args(['--path', 'index.html']), Usage)
  await assertRejects(() => args(['recipes']), Usage)
})

test('a tool with no schema takes nothing', async () => {
  assertEquals(await argsFor({ name: 'app_list' }, [], reads), {})
  await assertRejects(
    () => argsFor({ name: 'app_list' }, ['--app', 'r'], reads),
    Usage,
  )
})

test('both flag forms parse the same typed arguments including false', async () => {
  for (
    let [name, value, expected] of [
      ['deploy', 'false', false],
      ['deploy', 'true', true],
      ['deploy', '0', false],
      ['limit', '-2', -2],
      ['meta', '{"x":1}', { x: 1 }],
      ['path', 'two words', 'two words'],
    ] as const
  ) {
    assertEquals(await args(['--app', 'r', `--${name}`, value]), {
      app: 'r',
      [name]: expected,
    })
    assertEquals(await args(['--app=r', `--${name}=${value}`]), {
      app: 'r',
      [name]: expected,
    })
  }
  for (let flag of [['--deploy', '@bool'], ['--deploy=@bool']]) {
    assertEquals(
      await argsFor(tool, ['--app', 'r', ...flag], {
        ...reads,
        file: () => 'false',
      }),
      { app: 'r', deploy: false },
    )
  }
})

test('schema-less pairs accept legacy and both long option forms with JSON values', async () => {
  for (let form of ['legacy', 'equals', 'space']) {
    let words = [
      ['title', 'two words'],
      ['count', '-2'],
      ['enabled', 'false'],
      ['meta', '{"x":1}'],
      ['tags', '["cake"]'],
      ['empty', ''],
      ['nil', 'null'],
      ['literal', 'a=b'],
    ].flatMap(([key, value]) =>
      form == 'space'
        ? [`--${key}`, value]
        : [`${form == 'equals' ? '--' : ''}${key}=${value}`]
    )
    assertEquals(await pairsIn(words), {
      title: 'two words',
      count: -2,
      enabled: false,
      meta: { x: 1 },
      tags: ['cake'],
      empty: '',
      nil: null,
      literal: 'a=b',
    })
  }
  assertEquals(await pairsIn(['--text=--literal', 'old=1', '--old', '2']), {
    text: '--literal',
    old: 2,
  })
})

test('schema-less pair values inflate before JSON parsing in every form', async () => {
  let reads: Reads = { file: () => '{"file":true}', stdin: () => '[1,2]' }
  for (let value of ['@data.json', '-', '@-']) {
    let expected = value.startsWith('@data') ? { file: true } : [1, 2]
    for (
      let words of [[`data=${value}`], [`--data=${value}`], ['--data', value]]
    ) {
      assertEquals(await pairsIn(words, reads), { data: expected })
    }
  }
})

test('schema-less flags require an explicit value rather than becoming booleans', async () => {
  for (let words of [['--enabled'], ['--enabled', '--next=1']]) {
    await assertRejects(() => pairsIn(words), Usage, '--enabled needs a value')
  }
  for (let word of ['bare', '=value', '--=value', '--']) {
    await assertRejects(() => pairsIn([word]), Usage, 'not an argument')
  }
})

test('unknown options stay refused without a declared object rest', async () => {
  for (
    let grammar of [
      tool,
      { ...tool, options: { rest: 'files' } },
      { ...tool, options: { rest: 'path' } },
      { name: 'empty', options: { rest: 'args' } },
    ]
  ) {
    for (let words of [['--unknown=1'], ['--unknown', '1']]) {
      await assertRejects(
        () => argsFor(grammar, words),
        Usage,
        'Unknown option',
      )
    }
  }
  let listing = { ...tool, options: { positional: ['app'], rest: 'files' } }
  assertEquals(
    await argsFor(listing, ['r', '--', '--literal=1', '--other', '2']),
    {
      app: 'r',
      files: ['--literal=1', '--other', '2'],
    },
  )
})

test('object rest completion can await an unknown flag without swallowing declared options', () => {
  let grammar = { ...tool, options: { rest: 'meta' } }
  let pending = scanned(grammar, ['--extra'], true)
  assertEquals(pending.pending, 'extra')
  assertEquals(pending.awaiting, 'extra')
  assertEquals(scanned(grammar, ['--extra', 'false', '--app', 'r']).spare, [
    '--extra',
    'false',
  ])
  assertThrows(
    () => scanned(grammar, ['--extra', '--app=r']),
    Usage,
    'needs a value',
  )
})

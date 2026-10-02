import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  appGrammar,
  argsFor,
  type Reads,
  saidIn,
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
  let listing = { ...tool, positional: ['app', 'files...'] }
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

test('all named forms parse the same typed arguments including false', async () => {
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
    assertEquals(await args(['app=r', `${name}=${value}`]), {
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

test('unknown options stay refused without a declared object rest', async () => {
  for (
    let grammar of [
      tool,
      { ...tool, positional: ['files...'] },
      { ...tool, positional: ['path...'] },
      { name: 'empty', positional: ['args...'] },
    ]
  ) {
    for (
      let words of [['--unknown=1'], ['--unknown', '1']]
    ) {
      await assertRejects(
        () => argsFor(grammar, words),
        Usage,
        'Unknown',
      )
    }
  }
  let listing = { ...tool, positional: ['app', 'files...'] }
  assertEquals(
    await argsFor(listing, ['r', '--', '--literal=1', '--other', '2']),
    {
      app: 'r',
      files: ['--literal=1', '--other', '2'],
    },
  )
})

test('a trailing text input takes remaining words around either flag form', async () => {
  let grammar = {
    name: 'summon',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        at: { type: 'string' },
      },
    },
    positional: ['text...'],
  }
  for (let flags of [['--at', 'square'], ['--at=square']]) {
    assertEquals(
      await argsFor(grammar, ['a', 'large', ...flags, 'polar', 'bear']),
      { text: 'a large polar bear', at: 'square' },
    )
  }
  assertEquals(await argsFor(grammar, ['a large polar bear']), {
    text: 'a large polar bear',
  })
})

test('equals words are positional unless their name is declared', async () => {
  for (
    let [name, field, word] of [
      ['graph_query', 'query', '.task.status=open'],
      ['task_list', 'query', '.filed.project=P-19'],
      ['task_new', 'title', 'Fix x=y'],
    ]
  ) {
    let grammar = {
      name,
      inputSchema: {
        type: 'object',
        properties: {
          [field]: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      positional: [field],
    }
    assertEquals(await argsFor(grammar, [word, 'limit=5']), {
      [field]: word,
      limit: 5,
    })
  }
  let grammar = {
    name: 'task_new',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    positional: ['title...'],
  }
  assertEquals(await argsFor(grammar, ['x=y', 'and', 'z=w']), {
    title: 'x=y and z=w',
  })
})

test('trailing text inflates each remaining word before joining', async () => {
  let grammar = {
    name: 'note',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    positional: ['text...'],
  }
  assertEquals(await argsFor(grammar, ['begin', '@letter', '-', '@-'], reads), {
    text: 'begin <letter> from stdin from stdin',
  })
})

test('an app uses its declared positionals, shorts and named arguments', async () => {
  let declaration = {
    input: {
      person: { type: 'string' },
      text: { type: 'string' },
      limit: { type: 'number', short: 'n' },
    },
    required: ['person', 'text'],
  }
  let declared = appGrammar('tell', {
    ...declaration,
    positional: ['person', 'text...'],
  })
  assertEquals(await argsFor(declared, ['matt', 'hello', '-n', '2', 'there']), {
    person: 'matt',
    text: 'hello there',
    limit: 2,
  })
  let flags = appGrammar('tell', declaration)
  assertEquals(await argsFor(flags, ['--person=matt', '--text', 'hello']), {
    person: 'matt',
    text: 'hello',
  })
  await assertRejects(() => argsFor(flags, ['matt', 'hello']), Usage)
  assertEquals(await argsFor(flags, ['person=matt', 'text=hello']), {
    person: 'matt',
    text: 'hello',
  })
  await assertRejects(() => argsFor(flags, ['--person=matt']), Usage)
})

test('a forwarding grammar keeps remote words intact while taking its selector', async () => {
  let forwarded = {
    name: 'command',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        app: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
      },
    },
    positional: ['name'],
    forward: 'args',
  }
  let words = [
    'add',
    '--text',
    '@letter',
    '-n',
    '2',
    '--enabled',
    '--',
    '--app',
    '-',
  ]
  for (let selector of [['--app=recipes'], ['--app', 'recipes']]) {
    let expanded = 0
    assertEquals(
      await argsFor(forwarded, ['add', ...selector, ...words.slice(1)], {
        file: () => {
          expanded++
          return 'file'
        },
        stdin: () => {
          expanded++
          return 'stdin'
        },
      }),
      { name: 'add', app: 'recipes', args: words.slice(1) },
    )
    assertEquals(expanded, 0)
  }
  assertEquals(
    await argsFor(forwarded, ['app_versions', 'space=yourname', 'app=vale']),
    {
      name: 'app_versions',
      app: 'vale',
      args: ['space=yourname'],
    },
  )
})

test('rest array words follow the declared item type', async () => {
  let grammar = appGrammar('total', {
    positional: ['values...'],
    input: { values: { type: 'array', items: { type: 'integer' } } },
  })
  assertEquals(await argsFor(grammar, ['1', '2', '--values=3', '4']), {
    values: [1, 3, 2, 4],
  })
  await assertRejects(() => argsFor(grammar, ['1', 'nope']), Usage)
})

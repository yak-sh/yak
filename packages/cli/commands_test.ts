import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { argsFor, type Reads, Usage } from './args.ts'
import { appStray, appTools } from './commands.ts'
import { cli } from './run.ts'

let reads: Reads = { file: () => '{"file":true}', stdin: () => '[1,2]' }
let flags = (equals: boolean) =>
  [
    ['title', 'Lemon cake'],
    ['serves', '-2'],
    ['enabled', 'false'],
    ['meta', '@meta.json'],
    ['tags', '@-'],
    ['empty', ''],
  ].flatMap(([key, value]) =>
    equals ? [`--${key}=${value}`] : [`--${key}`, value]
  )

let expected = {
  title: 'Lemon cake',
  serves: -2,
  enabled: false,
  meta: { file: true },
  tags: [1, 2],
  empty: '',
  legacy: true,
}

test('app fallback and command verb parse both app flag forms through their actual grammars', async () => {
  let stray = appStray('recipes', ['add_recipe'])
  assert(stray)
  let verb = appTools[0]
  for (let equals of [false, true]) {
    let words = ['add_recipe', ...flags(equals), 'legacy=true']
    assertEquals(await argsFor(stray, words, reads), {
      name: 'add_recipe',
      args: expected,
    })
    assertEquals(
      await argsFor(verb, [
        ...words,
        ...equals ? ['--app=recipes'] : ['--app', 'recipes'],
      ], reads),
      { name: 'add_recipe', app: 'recipes', args: expected },
    )
  }
})

test('declared app command flags keep priority over fallback names', async () => {
  for (let equals of [false, true]) {
    let words = equals
      ? ['--name=add_recipe', '--app=recipes', '--args={"serves":4}']
      : ['--name', 'add_recipe', '--app', 'recipes', '--args', '{"serves":4}']
    assertEquals(await argsFor(appTools[0], words), {
      name: 'add_recipe',
      app: 'recipes',
      args: { serves: 4 },
    })
    assertEquals(
      await argsFor(appTools[0], [
        'add_recipe',
        'app=payload',
        ...equals ? ['--app=recipes'] : ['--app', 'recipes'],
      ]),
      { name: 'add_recipe', app: 'recipes', args: { app: 'payload' } },
    )
  }
})

test('app commands refuse missing fallback values before a call', async () => {
  let stray = appStray('recipes', ['add_recipe'])
  assert(stray)
  for (let grammar of [stray, appTools[0]]) {
    for (let words of [['--serves'], ['--serves', '--name=other']]) {
      await assertRejects(
        () => argsFor(grammar, ['add_recipe', ...words]),
        Usage,
        '--serves needs a value',
      )
    }
  }
})

test('both app command routes send typed fallback flags and no call on missing values', async () => {
  for (
    let route of [['command', 'add_recipe', '--app=recipes'], [
      'recipes',
      'add_recipe',
    ]]
  ) {
    for (let equals of [false, true]) {
      let calls: unknown[] = []
      let notes: string[] = []
      let run = (args: string[]) =>
        cli(appTools, {
          argv: [...route, ...args],
          host: 'yaks.test',
          env: () => undefined,
          stray: appStray,
          reads,
          out: () => {},
          note: (line) => notes.push(line),
          ask: (method, params) => {
            calls.push({ method, params })
            return Promise.resolve({
              content: [{ type: 'text', text: 'done' }],
            })
          },
        })
      assertEquals(
        await run([...flags(equals), 'legacy=true']),
        0,
        notes.join('\n'),
      )
      assertEquals(calls, [{
        method: 'tools/call',
        params: {
          name: 'command',
          arguments: { name: 'add_recipe', app: 'recipes', args: expected },
        },
      }])
      calls = []
      assertEquals(await run(['--enabled']), 2)
      assertEquals(calls, [])
      assert(notes.join('\n').includes('--enabled needs a value'))
    }
  }
})

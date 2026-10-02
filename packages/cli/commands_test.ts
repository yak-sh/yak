import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Grammar, type Reads, Usage } from './args.ts'
import { appStray, appTools, toolCall } from './commands.ts'
import { type Rpc } from './rpc.ts'
import { cli } from './run.ts'
import { COMMAND, type Listed, type Schema } from './tool.ts'

type App = {
  name: string
  at: string
  input: Schema
  options?: Grammar['options']
}
let done = { content: [{ type: 'text', text: 'done' }] }
let door = (tools: Listed[] = [], commands: App[] = []) => {
  let calls: { method: string; params?: unknown }[] = []
  let ask: Rpc = (method, params) => {
    calls.push({ method, params })
    if (method == 'tools/list') return Promise.resolve({ tools })
    let request = params as { name: string; arguments: { app?: string } }
    if (request.name == 'commands') {
      let found = commands.filter((c) =>
        !request.arguments.app || c.at == request.arguments.app
      )
      return Promise.resolve({
        ...done,
        structuredContent: {
          result: [{
            entity: { eid: '$commands' },
            output: { value: { commands: found } },
          }],
        },
      })
    }
    return Promise.resolve(done)
  }
  return { ask, calls }
}
let recipe: App = {
  name: 'add_recipe',
  at: 'recipes',
  input: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
      serves: { type: 'integer' },
      enabled: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      meta: { type: 'object' },
      note: { type: 'string' },
    },
  },
  options: { positional: ['title'], rest: 'title', short: { n: 'serves' } },
}
let discovery = (app?: string) => ({
  method: 'tools/call',
  params: { name: 'commands', arguments: app ? { app } : {} },
})
let executed = (name: string, args: Record<string, unknown>, app?: string) => ({
  method: 'tools/call',
  params: app
    ? { name: 'command', arguments: { name, app, args } }
    : { name, arguments: args },
})

test('a connector schema is fetched first and its declared grammar wins over an app', async () => {
  let where: Listed = {
    name: 'where',
    inputSchema: {
      type: 'object',
      required: ['person'],
      properties: { person: { type: 'string' } },
    },
    _meta: { [COMMAND]: { options: { positional: ['person'] } } },
  }
  let { ask, calls } = door([where], [{ ...recipe, name: 'where' }])
  assertEquals(await toolCall(ask, 'where', ['matt']), done)
  assertEquals(calls, [
    { method: 'tools/list', params: undefined },
    executed('where', { person: 'matt' }),
  ])
})

test('a connector takes no guessed positionals and an empty schema takes no arguments', async () => {
  for (let words of [['matt'], ['person=matt'], ['--unknown=1'], []]) {
    let { ask, calls } = door([{
      name: 'where',
      inputSchema: {
        type: 'object',
        required: ['person'],
        properties: { person: { type: 'string' } },
      },
    }])
    await assertRejects(() => toolCall(ask, 'where', words), Usage)
    assertEquals(calls, [{ method: 'tools/list', params: undefined }])
  }
  let { ask, calls } = door([{ name: 'app_list' }])
  assertEquals(await toolCall(ask, 'app_list', []), done)
  assertEquals(calls.at(-1), executed('app_list', {}))
})

test('an app schema types declared positionals shorts flags arrays and expanded values', async () => {
  let { ask, calls } = door([], [recipe])
  let expanded: string[] = []
  let reads: Reads = {
    file: (path) => {
      expanded.push(path)
      return path == 'meta.json' ? '{"file":true}' : '@kept'
    },
    stdin: () => {
      expanded.push('stdin')
      return '42'
    },
  }
  assertEquals(
    await toolCall(ask, 'add_recipe', [
      'Lemon',
      '-n',
      '-2',
      'cake',
      '--enabled',
      '--tags=a',
      '--tags',
      'b',
      '--meta=@meta.json',
      '--note',
      '-',
      '--title',
      '@title',
    ], { reads }),
    done,
  )
  assertEquals(calls, [
    { method: 'tools/list', params: undefined },
    discovery(),
    executed('add_recipe', {
      title: '@kept cake',
      serves: -2,
      enabled: true,
      tags: ['a', 'b'],
      meta: { file: true },
      note: '42',
    }, 'recipes'),
  ])
  assertEquals(expanded, ['meta.json', 'stdin', 'title'])
})

test('shared app command names require a selector before execution', async () => {
  let apps = [recipe, { ...recipe, at: 'bakery' }]
  let { ask, calls } = door([], apps)
  await assertRejects(
    () => toolCall(ask, 'add_recipe', ['Cake']),
    Usage,
    '--app',
  )
  assertEquals(calls, [
    { method: 'tools/list', params: undefined },
    discovery(),
  ])
  let selected = door([], apps)
  await toolCall(selected.ask, 'add_recipe', ['Cake'], { app: 'bakery' })
  assertEquals(selected.calls, [
    { method: 'tools/list', params: undefined },
    discovery('bakery'),
    executed('add_recipe', { title: 'Cake' }, 'bakery'),
  ])
})

test('apps without options accept flags only and invalid inputs never execute', async () => {
  let flags = { ...recipe, options: undefined }
  for (
    let words of [['Cake'], ['title=Cake'], [], ['--title=Cake', '--unknown=1']]
  ) {
    let { ask, calls } = door([], [flags])
    await assertRejects(() => toolCall(ask, 'add_recipe', words), Usage)
    assertEquals(calls, [
      { method: 'tools/list', params: undefined },
      discovery(),
    ])
  }
  let { ask, calls } = door([], [flags])
  await toolCall(ask, 'add_recipe', ['--title=Cake', '--enabled=false'])
  assertEquals(
    calls.at(-1),
    executed('add_recipe', { title: 'Cake', enabled: false }, 'recipes'),
  )
})

test('command and app fallback forward words until the fetched app grammar reads them once', async () => {
  for (
    let route of [['command', 'add_recipe', '--app=recipes'], [
      'recipes',
      'add_recipe',
    ]]
  ) {
    let { ask, calls } = door([], [recipe])
    let expanded = 0, notes: string[] = []
    let code = await cli(appTools, {
      argv: [
        ...route,
        '@title',
        '--enabled=false',
        '-n',
        '2',
        '--',
        '--literal',
      ],
      host: 'yaks.test',
      env: () => undefined,
      stray: appStray,
      ask,
      reads: {
        file: () => {
          expanded++
          return '@kept'
        },
        stdin: () => 'stdin',
      },
      out: () => {},
      note: (line) => notes.push(line),
    })
    assertEquals(code, 0, notes.join('\n'))
    assertEquals(calls, [
      { method: 'tools/list', params: undefined },
      discovery('recipes'),
      executed('add_recipe', {
        title: '@kept --literal',
        enabled: false,
        serves: 2,
      }, 'recipes'),
    ])
    assertEquals(expanded, 1)
  }
  assert(appStray('recipes', ['add_recipe']))
})

test('forwarded flags may share the outer positional and forward property names', async () => {
  let { ask, calls } = door([{
    name: 'rename',
    inputSchema: {
      type: 'object',
      required: ['name', 'args'],
      properties: { name: { type: 'string' }, args: { type: 'string' } },
    },
  }])
  let notes: string[] = []
  assertEquals(
    await cli(appTools, {
      argv: ['command', 'rename', '--name=new', '--args=quoted'],
      host: 'yaks.test',
      env: () => undefined,
      ask,
      out: () => {},
      note: (line) => notes.push(line),
    }),
    0,
    notes.join('\n'),
  )
  assertEquals(
    calls.at(-1),
    executed('rename', { name: 'new', args: 'quoted' }),
  )
})

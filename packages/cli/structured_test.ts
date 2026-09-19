import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Tool } from '@yaks/graph'
import { completeCommand, resolveCommand } from './structured.ts'
import { argsFor, type Reads, Usage } from './args.ts'
import { toolDefinition } from '@yaks/vocab/tools'

let reads: Reads = { file: () => '', stdin: () => '' }
let said = (argv: string[]) => argsFor(t, argv, reads)
const t: Tool = {
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
  run: (args) => args,
}
Deno.test('one registry supports both traversals and contextual completion', () => {
  const tools = [t, { ...t, noun: 'task' }, { ...t, verb: 'show' }]
  assertEquals(completeCommand(tools, ['list']), ['session', 'task'])
  assertEquals(completeCommand(tools, ['session']), ['list', 'show'])
  assertEquals(resolveCommand(tools, ['list', 'session', 'root'])?.command, t)
  assertEquals(resolveCommand(tools, ['session', 'list', 'root'])?.command, t)
})
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

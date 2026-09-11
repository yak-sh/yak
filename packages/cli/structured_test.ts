import { assertEquals, assertThrows } from '@std/assert'
import type { Tool } from '@yaks/graph'
import {
  commandArguments,
  completeCommand,
  resolveCommand,
} from './structured.ts'
import { toolDefinition } from '@yaks/vocab/tools'
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
Deno.test('JSON schema arguments provide typed options validation and defaults', () => {
  assertEquals(
    commandArguments(t, ['root', '-n', '3', '-a', '--status=done']),
    { scope: 'root', limit: 3, all: true, status: 'done' },
  )
  assertEquals(commandArguments(t, ['root']), { scope: 'root', limit: 20 })
  assertThrows(
    () => commandArguments(t, ['root', '--limit=0']),
    Error,
    'Invalid tool',
  )
  assertThrows(() => commandArguments(t, []), Error, 'Invalid tool')
  assertThrows(
    () => commandArguments(t, ['root', '--status=bad']),
    Error,
    'Invalid tool',
  )
  assertThrows(
    () => commandArguments(t, ['root', '--unknown']),
    Error,
    'Unknown option',
  )
  assertThrows(
    () => commandArguments(t, ['root', '--limit=1.5']),
    Error,
    'Invalid tool',
  )
  assertEquals(commandArguments(t, ['--', '--literal']).scope, '--literal')
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

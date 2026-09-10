import { assertEquals } from '@std/assert'
import { errorPath, home } from './paths.ts'
import { dbPath } from './store.ts'

Deno.test('harness state moves together without redirecting HOME', () => {
  let values: Record<string, string> = { HOME: '/owner' }
  let env = (key: string) => values[key]
  assertEquals(home(env), '/owner/.harness')
  assertEquals(dbPath(env), '/owner/.harness/harness.db')
  assertEquals(errorPath(env), '/owner/.harness/exceptions.jsonl')
  values.HARNESS_HOME = '/probe'
  assertEquals(dbPath(env), '/probe/harness.db')
  assertEquals(errorPath(env), '/probe/exceptions.jsonl')
  values.HARNESS_DB = ':memory:'
  values.HARNESS_ERROR_LOG = '/journal/errors.jsonl'
  assertEquals(dbPath(env), ':memory:')
  assertEquals(errorPath(env), '/journal/errors.jsonl')
  values.HARNESS_HOME = values.HARNESS_DB = values.HARNESS_ERROR_LOG = ''
  assertEquals(dbPath(env), '/owner/.harness/harness.db')
  assertEquals(errorPath(env), '/owner/.harness/exceptions.jsonl')
})

import { assertEquals } from '@std/assert'
import { errorPath, home, worktrees } from './paths.ts'
import { dbPath } from './store.ts'

Deno.test('harness state moves together without redirecting HOME', () => {
  let values: Record<string, string> = { HOME: '/owner' }
  let env = (key: string) => values[key]
  assertEquals(home(env), '/owner/.harness')
  assertEquals(dbPath(env), '/owner/.harness/harness.db')
  assertEquals(errorPath(env), '/owner/.harness/exceptions.jsonl')
  assertEquals(worktrees(env), '/owner/.harness/worktrees')
  values.HARNESS_HOME = '/probe'
  assertEquals(dbPath(env), '/probe/harness.db')
  assertEquals(errorPath(env), '/probe/exceptions.jsonl')
  assertEquals(worktrees(env), '/probe/worktrees')
  values.HARNESS_DB = ':memory:'
  values.HARNESS_ERROR_LOG = '/journal/errors.jsonl'
  values.HARNESS_WORKTREE_DIR = '/checkouts'
  assertEquals(dbPath(env), ':memory:')
  assertEquals(errorPath(env), '/journal/errors.jsonl')
  assertEquals(worktrees(env), '/checkouts')
  values.HARNESS_HOME = values.HARNESS_DB = values.HARNESS_ERROR_LOG = ''
  values.HARNESS_WORKTREE_DIR = ''
  assertEquals(dbPath(env), '/owner/.harness/harness.db')
  assertEquals(errorPath(env), '/owner/.harness/exceptions.jsonl')
  assertEquals(worktrees(env), '/owner/.harness/worktrees')
})

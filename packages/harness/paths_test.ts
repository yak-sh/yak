import { assertEquals } from '@std/assert'
import { home, worktrees } from './paths.ts'
import { dbPath } from './store.ts'

Deno.test('harness state moves together without redirecting HOME', () => {
  let values: Record<string, string> = { HOME: '/owner' }
  let env = (key: string) => values[key]
  assertEquals(home(env), '/owner/.yak')
  assertEquals(dbPath(env), '/owner/.yak/yak.db')
  assertEquals(worktrees(env), '/owner/.yak/worktrees')
  values.HARNESS_HOME = '/probe'
  assertEquals(dbPath(env), '/probe/yak.db')
  assertEquals(worktrees(env), '/probe/worktrees')
  values.HARNESS_DB = ':memory:'
  values.HARNESS_WORKTREE_DIR = '/checkouts'
  assertEquals(dbPath(env), ':memory:')
  assertEquals(worktrees(env), '/checkouts')
  values.HARNESS_HOME = values.HARNESS_DB = ''
  values.HARNESS_WORKTREE_DIR = ''
  assertEquals(dbPath(env), '/owner/.yak/yak.db')
  assertEquals(worktrees(env), '/owner/.yak/worktrees')
})

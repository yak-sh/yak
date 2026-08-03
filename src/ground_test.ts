// The worktree roots are a migration contract: writes choose visible ground,
// while readers keep recognizing the former data-home location.
import { assertEquals } from '@std/assert'
import { worktreeDirs } from './ground.ts'

Deno.test('worktree roots write visibly and keep the hidden root readable', () => {
  assertEquals(worktreeDirs('/home/me'), [
    '/home/me/tasks-worktrees',
    '/home/me/.tasks/worktrees',
  ])
  assertEquals(worktreeDirs('/home/me', '/tmp/trees'), ['/tmp/trees'])
  assertEquals(worktreeDirs('/home/me', ''), [''])
})

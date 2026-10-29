// Worktree occupancy compares paths without inspecting the host's processes.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { inUse } from './host.ts'

test('process directories protect a worktree and its descendants', () => {
  for (
    let [cwd, held] of [
      ['/work/tree', true],
      ['/work/tree/subdir', true],
      ['/work/tree-other', false],
      ['/work', false],
    ] as const
  ) assertEquals(inUse('/work/tree', new Set([cwd])), held)
})

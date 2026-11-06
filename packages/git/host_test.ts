// Worktree occupancy compares paths; the scan reads processes through Procs.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { inUse, processCwds, processPaths, type Procs } from './host.ts'

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

let me = Deno.uid()!
let denied = () => Promise.reject(new Deno.errors.PermissionDenied())
let gone = () => Promise.reject(new Deno.errors.NotFound())
let is = <T>(value: T) => Promise.resolve(value)

// Each pid names how procfs answers for it: readable (1, 6), hidden from all
// (2), exited (3), hidden but read by the helper (4), another user's (5).
let procs: Procs = {
  pids: () => is(['1', '2', '3', '4', '5', '6']),
  owner: (pid) => is(pid == '5' ? me + 1 : me),
  cwd: (pid) =>
    pid == '2' || pid == '4'
      ? denied()
      : pid == '3'
      ? gone()
      : is(`/cwd/${pid}`),
  links: () => is(['/open (deleted)', 'pipe:[9]', '']),
  privileged: (pid) => is(pid == '4' ? ['/hidden', '/hidden/file'] : undefined),
}

test('a process the scan cannot read holds nothing', async () => {
  assertEquals([...await processPaths(procs)].sort(), [
    '/cwd/1',
    '/cwd/6',
    '/hidden',
    '/hidden/file',
    '/open',
  ])
  assertEquals(
    [...await processCwds(procs)].slice(1).sort(),
    ['/cwd/1', '/cwd/6', '/hidden'],
  )
})

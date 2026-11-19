// Worktree occupancy compares paths; the scan reads processes through Procs.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  createWorktree,
  inUse,
  processCwds,
  processPaths,
  type Procs,
  reclaim,
} from './host.ts'
import { fixture } from './testing.ts'
import type { Comp } from '@yaks/graph'

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

// A throwaway repository with one commit on main.
let repo = async () => {
  let dir = await Deno.realPath(Deno.makeTempDirSync({ prefix: 'host-' }))
  let run = (...args: string[]) =>
    new Deno.Command('git', { args, cwd: `${dir}/repo` }).output()
  Deno.mkdirSync(`${dir}/repo`)
  await run('init', '-q', '-b', 'main')
  await run(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'one',
  )
  return {
    dir,
    source: `${dir}/repo`,
    close: () => Deno.removeSync(dir, { recursive: true }),
  }
}

test('a checkout cut while it is taken back grows again once the removal is done', async () => {
  let { dir, source, close } = await repo()
  try {
    let g = fixture().g
    let path = `${dir}/S1`
    let request = { path, branch: 'session-S1', base: 'refs/heads/main' }
    let base = String(
      ((await createWorktree(g, source, request)).checkout as Comp).base,
    )
    // The removal holds the path's lock while it asks whether the checkout
    // is free; the cut starts then, and must wait for it.
    let free!: (yes: boolean) => void
    let held!: () => void
    let holding = new Promise<void>((r) => held = r)
    let removing = reclaim(path, 'refs/heads/main', base, () => {
      held()
      return new Promise((r) => free = r)
    })
    await holding
    let cutting = createWorktree(g, source, request)
    free(true)
    assertEquals(await removing, undefined)
    let tree = await cutting
    assertEquals((tree.workspace as { root: string }).root, path)
    // Taken up again before its removal is asked: it is kept.
    assertEquals(
      await reclaim(
        path,
        'refs/heads/main',
        base,
        () => Promise.resolve(false),
      ),
      'taken',
    )
    assertEquals((await Deno.stat(`${path}/.git`)).isFile, true)
  } finally {
    close()
  }
})

test('a checkout whose removal was killed partway grows again', async () => {
  let { dir, source, close } = await repo()
  try {
    let g = fixture().g
    let path = `${dir}/S1`
    let request = { path, branch: 'session-S1', base: 'refs/heads/main' }
    await createWorktree(g, source, request)
    // `git worktree remove` empties the directory before it drops Git's
    // registration; killed between, a file and the registration are left.
    Deno.removeSync(`${path}/.git`)
    Deno.writeTextFileSync(`${path}/left`, 'x')
    let tree = await createWorktree(g, source, request)
    assertEquals((tree.workspace as { root: string }).root, path)
    assertEquals((await Deno.stat(`${path}/.git`)).isFile, true)
    assertEquals(Deno.readDirSync(path).some((e) => e.name == 'left'), false)
  } finally {
    close()
  }
})

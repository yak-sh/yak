// Taking a worktree back, against a real repository: what a worktree holds is
// Git's answer, so the fixture is Git itself, one repository and a root of
// checkouts cut from it.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { holds, idleFor, lost, reclaim } from './host.ts'
import { git, template } from './testing.ts'

let there = (path: string) => Deno.stat(path).then(() => true, () => false)

let seeded = template(async (dir) => {
  let repo = dir + '/repo'
  await Deno.mkdir(repo)
  await Deno.mkdir(dir + '/worktrees')
  await git(repo, 'init', '-q', '-b', 'main', '.')
  await git(repo, 'config', 'user.email', 'test@example.org')
  await git(repo, 'config', 'user.name', 'Test')
  await Deno.writeTextFile(repo + '/file', 'committed')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-qm', 'initial')
})

/** A repository, a worktree root beside it, and one cut checkout per name,
 * linked the way Git does by default or by a path relative to itself. */
let fixture = async () => {
  let dir = await seeded()
  let repo = dir + '/repo'
  let root = dir + '/worktrees'
  return {
    repo,
    cut: async (name: string, ...how: string[]) => {
      let path = root + '/' + name
      await git(
        repo,
        'worktree',
        'add',
        '-q',
        ...how,
        '-b',
        'task-' + name,
        path,
      )
      return path
    },
    commit: async (path: string, text: string) => {
      await Deno.writeTextFile(path + '/work', text)
      await git(path, 'add', '.')
      await git(path, 'commit', '-qm', text)
    },
    branches: () =>
      git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'),
    free: () => Deno.remove(dir, { recursive: true }),
  }
}

test('a clean, landed checkout is taken back with its branch', async () => {
  let f = await fixture()
  try {
    let path = await f.cut('done')
    assertEquals(await holds(path), undefined)
    assertEquals(await reclaim(path), undefined)
    assertEquals(await there(path), false)
    assertEquals(await f.branches(), 'main')
  } finally {
    await f.free()
  }
})

test('dirty files and unlanded commits keep a checkout', async () => {
  let f = await fixture()
  try {
    let dirty = await f.cut('dirty')
    await Deno.writeTextFile(dirty + '/scratch', 'not committed')
    assertEquals(await reclaim(dirty), 'dirty')
    assert(await there(dirty))

    let ahead = await f.cut('ahead')
    await f.commit(ahead, 'unlanded')
    assertEquals(await reclaim(ahead), 'unlanded')
    assert(await there(ahead))

    // Landing it anywhere else is enough: the parent's branch, not only main.
    await git(f.repo, 'branch', 'parent', 'task-ahead')
    assertEquals(await reclaim(ahead), undefined)
    assertEquals(await there(ahead), false)
    assertEquals(await f.branches(), 'main\nparent\ntask-dirty')
  } finally {
    await f.free()
  }
})

test('a path that is not a checkout is kept, never guessed at', async () => {
  let dir = await Deno.makeTempDir()
  try {
    assertEquals(await holds(dir), 'unlanded')
    assertEquals(await holds(dir + '/missing'), 'unlanded')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('a checkout whose gitdir is gone is removed outright', async () => {
  let f = await fixture()
  try {
    let path = await f.cut('orphan')
    await f.commit(path, 'work the runner threw away')
    await Deno.remove(f.repo + '/.git/worktrees', { recursive: true })
    assert(await lost(path))
    assertEquals(await reclaim(path), undefined)
    assertEquals(await there(path), false)
    // A live checkout is not lost, whatever it holds.
    assertEquals(await lost(await f.cut('live')), false)
  } finally {
    await f.free()
  }
})

test('a worktree linked by a relative path is live, and just touched', async () => {
  let f = await fixture()
  try {
    let path = await f.cut('relative', '--relative-paths')
    await Deno.writeTextFile(path + '/scratch', 'not committed')
    assertEquals(await lost(path), false)
    assert(await idleFor(path) < 60_000)
    assertEquals(await reclaim(path), 'dirty')
    assert(await there(path + '/scratch'))
  } finally {
    await f.free()
  }
})

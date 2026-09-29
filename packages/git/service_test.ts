// Collecting the worktrees agents leave behind, against a real repository: a
// linked worktree goes once it holds nothing and Git has left it alone for
// long enough, and nothing else does.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { discover } from './host.ts'
import { collect, IDLE, service } from './service.ts'
import { fixture as graphed } from './testing.ts'

let git = async (cwd: string, ...args: string[]) => {
  let p = await new Deno.Command('git', {
    cwd,
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!p.success) throw new Error(new TextDecoder().decode(p.stderr))
  return new TextDecoder().decode(p.stdout).trim()
}
let there = (path: string) => Deno.stat(path).then(() => true, () => false)

/** A repository with one checkout cut per name, and its graph. */
let fixture = async () => {
  let dir = await Deno.realPath(await Deno.makeTempDir())
  let repo = dir + '/repo'
  await Deno.mkdir(repo)
  await git(repo, 'init', '-q', '-b', 'main', '.')
  await git(repo, 'config', 'user.email', 'test@example.org')
  await git(repo, 'config', 'user.name', 'Test')
  await Deno.writeTextFile(repo + '/file', 'committed')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-qm', 'initial')
  return {
    repo,
    common: repo + '/.git',
    g: graphed().g,
    cut: async (name: string) => {
      let path = dir + '/' + name
      await git(repo, 'worktree', 'add', '-q', '-b', name, path)
      return path
    },
    free: () => Deno.remove(dir, { recursive: true }),
  }
}

let later = Date.now() + 2 * IDLE

test('an idle worktree that holds nothing is taken back', async () => {
  let f = await fixture()
  try {
    let landed = await f.cut('landed')
    let dirty = await f.cut('dirty')
    await Deno.writeTextFile(dirty + '/scratch', 'not committed')
    let ahead = await f.cut('ahead')
    await Deno.writeTextFile(ahead + '/work', 'unlanded')
    await git(ahead, 'add', '.')
    await git(ahead, 'commit', '-qm', 'unlanded')

    // Freshly touched, nothing goes.
    assertEquals(await collect(f.g, f.common), {})
    assert(await there(landed))

    assertEquals(await collect(f.g, f.common, IDLE, later), {
      [dirty]: 'dirty',
      [ahead]: 'unlanded',
    })
    assertEquals(await there(landed), false)
    assert(await there(f.repo + '/file'))
  } finally {
    await f.free()
  }
})

test('a worktree the harness manages is left to it', async () => {
  let f = await fixture()
  try {
    let path = await f.cut('managed')
    let tree = await discover(f.g, path)
    await f.g.apply([{ entity: tree.entity, worktree: { managed: true } }])
    assertEquals(await collect(f.g, f.common, IDLE, later), {})
    assert(await there(path))
  } finally {
    await f.free()
  }
})

test('the service collects each repository the graph knows', async () => {
  let f = await fixture()
  try {
    let path = await f.cut('landed')
    await discover(f.g, f.repo)
    await service({ graph: f.g }, { idle: 0 })
    assertEquals(await there(path), false)
  } finally {
    await f.free()
  }
})

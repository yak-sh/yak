// Collecting the worktrees agents leave behind, against a real repository: a
// linked worktree goes once it holds nothing and Git has left it alone for
// long enough, and nothing else does.
import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { discover, inUse, processCwds } from './host.ts'
import { collect, IDLE, service } from './service.ts'
import { fixture as graphed, git, template } from './testing.ts'

let there = (path: string) => Deno.stat(path).then(() => true, () => false)

let seeded = template(async (dir) => {
  let repo = dir + '/repo'
  await Deno.mkdir(repo)
  await git(repo, 'init', '-q', '-b', 'main', '.')
  await git(repo, 'config', 'user.email', 'test@example.org')
  await git(repo, 'config', 'user.name', 'Test')
  await Deno.writeTextFile(repo + '/file', 'committed')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-qm', 'initial')
})

/** A repository with one checkout cut per name, and its graph. */
let fixture = async () => {
  let dir = await seeded()
  let repo = dir + '/repo'
  return {
    repo,
    common: repo + '/.git',
    g: graphed({
      docs: [{
        $defs: {
          session: {
            component: true,
            type: 'object',
            properties: { status: { type: 'string' } },
          },
          home: {
            component: true,
            type: 'object',
            properties: { worktree: { type: 'string', ref: 'worktree' } },
          },
          process: { component: true, type: 'object' },
          exit: { component: true, type: 'object' },
        },
      }],
    }).g,
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
    await git(f.repo, 'branch', 'another-task', 'ahead')

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

test('an idle checkout stays while a graph session or local process uses it', async () => {
  let f = await fixture()
  let child: Deno.ChildProcess | undefined
  try {
    let busy = await f.cut('busy')
    let occupied = await f.cut('occupied')
    let tree = await discover(f.g, busy)
    await f.g.apply([{
      entity: { eid: 'session' },
      session: { status: 'running' },
      home: { worktree: tree.entity.eid },
    }])
    child = new Deno.Command('cat', {
      cwd: occupied,
      stdin: 'piped',
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    await until(async () => inUse(occupied, await processCwds()))
    assertEquals(await collect(f.g, f.common, IDLE, later), {})
    assert(await there(busy))
    assert(await there(occupied))
    await f.g.apply([{
      entity: { eid: 'session' },
      session: { status: 'settled' },
    }])
    assertEquals(await collect(f.g, f.common, IDLE, later), {})
    assertEquals(await there(busy), false)
    assert(await there(occupied))
  } finally {
    if (child) {
      child.kill('SIGTERM')
      await child.status
    }
    await f.free()
  }
})

test('a settled transcript keeps its checkout until its process exits', async () => {
  let f = await fixture()
  try {
    let path = await f.cut('draining')
    let tree = await discover(f.g, path)
    await f.g.apply([{
      entity: { eid: 'draining' },
      session: { status: 'settled' },
      home: { worktree: tree.entity.eid },
      process: {},
    }])
    await collect(f.g, f.common, IDLE, later)
    assert(await there(path))
    await f.g.apply([{ entity: { eid: 'draining' }, exit: {} }])
    await collect(f.g, f.common, IDLE, later)
    assertEquals(await there(path), false)
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

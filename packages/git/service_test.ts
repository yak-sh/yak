// Collecting the worktrees agents leave behind, against a real repository: a
// linked worktree goes once it holds nothing and Git has left it alone for
// long enough, and nothing else does.
import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { discover, inUse, processPaths } from './host.ts'
import {
  collect as collectOnHost,
  IDLE,
  service as serviceOnHost,
} from './service.ts'
import { fixture as graphed, git, template, testMachine } from './testing.ts'

let pids = new Set([String(Deno.pid)])
let machine = testMachine()
let processes = () => processPaths([...pids], machine)
let collect = (
  g: Parameters<typeof collectOnHost>[0],
  common: string,
  idle?: number,
  now?: number,
) => collectOnHost(g, common, idle, now, processes, machine)
let service = (
  host: Parameters<typeof serviceOnHost>[0],
  options: Parameters<typeof serviceOnHost>[1],
) =>
  serviceOnHost(
    { ...host, machines: { local: machine } },
    options,
    undefined,
    processes,
  )

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
            properties: { machine: { type: 'string', ref: 'machine' } },
          },
          machine: {
            component: true,
            type: 'object',
            properties: { address: { type: 'string' } },
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
    land: async (path: string) => {
      await Deno.writeTextFile(path + '/work', path)
      await git(path, 'add', '.')
      await git(path, 'commit', '-qm', 'work')
      await git(repo, 'merge', '--ff-only', path.split('/').at(-1)!)
    },
    free: () => Deno.remove(dir, { recursive: true }),
  }
}

let later = Date.now() + 2 * IDLE

test('an idle worktree that holds nothing is taken back', async () => {
  let f = await fixture()
  try {
    let landed = await f.cut('landed')
    await f.land(landed)
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
    await f.land(busy)
    let occupied = await f.cut('occupied')
    await f.land(occupied)
    let tree = await discover(f.g, busy, machine)
    await f.g.apply([{ entity: tree.entity, machine: { address: busy } }, {
      entity: { eid: 'session' },
      session: { status: 'running' },
      home: { machine: tree.entity.eid },
    }])
    child = new Deno.Command('cat', {
      cwd: occupied,
      stdin: 'piped',
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    pids.add(String(child.pid))
    await until(async () => inUse(occupied, await processes()))
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
      pids.delete(String(child.pid))
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
    await f.land(path)
    let tree = await discover(f.g, path, machine)
    await f.g.apply([{ entity: tree.entity, machine: { address: path } }, {
      entity: { eid: 'draining' },
      session: { status: 'settled' },
      home: { machine: tree.entity.eid },
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
    let tree = await discover(f.g, path, machine)
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
    await f.land(path)
    await discover(f.g, f.repo, machine)
    await service({ graph: f.g }, { idle: 0 })
    assertEquals(await there(path), false)
  } finally {
    await f.free()
  }
})

test('collection retires externally removed observations and preserves managed restore history', async () => {
  let f = await fixture()
  try {
    let gone = await f.cut('gone')
    let managed = await f.cut('managed')
    let tree = await discover(f.g, gone, machine)
    let saved = await discover(f.g, managed, machine)
    await f.g.apply([{ entity: saved.entity, worktree: { managed: true } }])
    await git(f.repo, 'worktree', 'remove', gone)
    await git(f.repo, 'worktree', 'remove', managed)
    assertEquals(await collect(f.g, f.common), {})
    assertEquals((await f.g.get([tree.entity.eid]))[0]?.worktree, undefined)
    assert((await f.g.get([saved.entity.eid]))[0]?.worktree)
    assertEquals(await collect(f.g, f.common), {})
  } finally {
    await f.free()
  }
})

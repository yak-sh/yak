// Graph-backed landing through a lent machine, with real scratch Git checkouts.
// The accepted ref is the result; a linked primary checkout is only its mirror.
import { docDoc } from '@yaks/doc'
import type { Comp } from '@yaks/graph'
import { equal, ok, test } from '@yaks/testing'
import { discover, repositoryEid } from './host.ts'
import {
  callerMachine,
  exportPack,
  fetchObjects,
  landGraph,
} from './landing.ts'
import { acceptPack } from './receive.ts'
import { moved, refAt, type Repo } from './refs.ts'
import { fixture, git, template, testMachine } from './testing.ts'

let MAIN = 'refs/heads/main'
let quiet = { write: () => {} }
let seeded = template(async (root) => {
  let primary = root + '/primary'
  await Deno.mkdir(primary)
  await git(primary, 'init', '-q', '-b', 'main')
  await git(primary, 'config', 'user.name', 'Landing test')
  await git(primary, 'config', 'user.email', 'landing@example.test')
  await Deno.writeTextFile(primary + '/base.txt', 'base\n')
  await git(primary, 'add', 'base.txt')
  await git(primary, 'commit', '-qm', 'base')
})

let scratch = async () => {
  let root = await seeded()
  let primary = root + '/primary'
  let caller = root + '/caller'
  // fixture already includes checkoutDoc's four components through gitDoc.
  let { g, bytes } = fixture({ docs: [docDoc] })
  let machine = testMachine()
  let repo: Repo = { refs: g, objects: g, bytes }
  let base = await git(primary, 'rev-parse', 'HEAD')
  let app = repositoryEid(await Deno.realPath(primary + '/.git'))
  return {
    root,
    primary,
    caller,
    g,
    bytes,
    machine,
    repo,
    base,
    app,
    linked: () => git(primary, 'worktree', 'add', '-qb', 'task', caller),
    clone: async (path: string, source = primary) => {
      await git(root, 'clone', '-q', '--no-local', source, path)
      await git(path, 'config', 'user.name', 'Landing test')
      await git(path, 'config', 'user.email', 'landing@example.test')
      return path
    },
    accept: async (path: string, app: string, old: string | null) => {
      let head = await git(path, 'rev-parse', 'HEAD')
      await acceptPack(repo, {
        app,
        branch: MAIN,
        old,
        commit: head,
        pack: await exportPack(machine, path, head, old),
      }, { machine, cwd: path })
      return head
    },
    land: (options = quiet) => landGraph(g, bytes, machine, caller, options),
    free: () => Deno.remove(root, { recursive: true }),
  }
}

let commit = async (path: string, file: string, text: string) => {
  await Deno.writeTextFile(path + '/' + file, text)
  await git(path, 'add', file)
  await git(path, 'commit', '-qm', file)
  return git(path, 'rev-parse', 'HEAD')
}

let hasObject = async (path: string, oid: string) => {
  let result = await new Deno.Command('git', {
    args: ['cat-file', '-e', oid],
    cwd: path,
    stdout: 'null',
    stderr: 'null',
  }).output()
  return result.success
}

test('landGraph bootstraps a legacy linked checkout, accepts, and syncs its mirror', async () => {
  let f = await scratch()
  try {
    await f.linked()
    let head = await commit(f.caller, 'task.txt', 'task\n')
    // A legacy accepted ref predates object receiving; discovery observes oid.
    await f.g.apply([moved(f.app, MAIN, f.base)])
    await discover(f.g, f.caller, f.machine)
    equal(await refAt(f.g, f.app, MAIN), f.base)
    equal((await f.g.get([f.base], ['gitobj']))[0]?.gitobj, undefined)

    equal(await f.land(), { landed: head, root: f.caller })
    equal(await refAt(f.g, f.app, MAIN), head)
    equal(
      ((await f.g.get([f.base], ['gitobj']))[0]?.gitobj as Comp | undefined)
        ?.type,
      'commit',
    )
    equal(
      ((await f.g.get([head], ['gitobj']))[0]?.gitobj as Comp | undefined)
        ?.type,
      'commit',
    )
    equal(await git(f.primary, 'rev-parse', 'HEAD'), head)
    equal(await Deno.readTextFile(f.primary + '/task.txt'), 'task\n')
    equal(await git(f.primary, 'status', '--porcelain'), '')
    equal(await git(f.caller, 'status', '--porcelain'), '')
  } finally {
    await f.free()
  }
})

test('landGraph accepts an independent clone with supplied repository and branch, without a shared checkout', async () => {
  let f = await scratch()
  try {
    let app = crypto.randomUUID()
    await f.g.apply([{ entity: { eid: app } }])
    await f.accept(f.primary, app, null)
    await f.clone(f.caller)
    await git(f.caller, 'checkout', '-qb', 'task')
    // No origin or linked worktree remains to supply acceptance or catch-up.
    await git(f.caller, 'remote', 'remove', 'origin')
    await Deno.remove(f.primary, { recursive: true })
    let head = await commit(f.caller, 'task.txt', 'independent\n')

    equal(
      await landGraph(f.g, f.bytes, f.machine, f.caller, {
        repository: app,
        branch: 'main',
        ...quiet,
      }),
      { landed: head, root: f.caller },
    )
    equal(await refAt(f.g, app, MAIN), head)
    equal(
      ((await f.g.get([head], ['gitobj']))[0]?.gitobj as Comp | undefined)
        ?.type,
      'commit',
    )
    equal(await git(f.caller, 'rev-parse', MAIN), f.base)
    equal(await git(f.caller, 'status', '--porcelain'), '')
  } finally {
    await f.free()
  }
})

test('landGraph fetches moved graph main, rebases without accepting, and lands on the next call', async () => {
  let f = await scratch()
  try {
    let app = crypto.randomUUID()
    await f.g.apply([{ entity: { eid: app } }])
    await f.accept(f.primary, app, null)
    await f.clone(f.caller)
    await git(f.caller, 'checkout', '-qb', 'task')
    let candidate = await commit(f.caller, 'task.txt', 'task\n')
    let rival = await f.clone(f.root + '/rival')
    let moved = await commit(rival, 'rival.txt', 'rival\n')
    await f.accept(rival, app, f.base)
    equal(await hasObject(f.caller, moved), false)
    let options = { repository: app, branch: MAIN, ...quiet }

    equal(await landGraph(f.g, f.bytes, f.machine, f.caller, options), {
      diverged: true,
      conflict: false,
    })
    equal(await refAt(f.g, app, MAIN), moved)
    let rebased = await git(f.caller, 'rev-parse', 'HEAD')
    ok(rebased != candidate)
    equal(await git(f.caller, 'rev-parse', 'HEAD^'), moved)
    equal((await f.g.get([rebased], ['gitobj']))[0]?.gitobj, undefined)
    equal(await Deno.readTextFile(f.caller + '/task.txt'), 'task\n')
    equal(await Deno.readTextFile(f.caller + '/rival.txt'), 'rival\n')
    equal(await git(f.caller, 'rev-parse', MAIN), f.base)

    equal(await landGraph(f.g, f.bytes, f.machine, f.caller, options), {
      landed: rebased,
      root: f.caller,
    })
    equal(await refAt(f.g, app, MAIN), rebased)
    equal(await git(f.primary, 'rev-parse', 'HEAD'), f.base)
  } finally {
    await f.free()
  }
})

test('landGraph moves the accepted ref while preserving a dirty mirror and its index', async () => {
  let f = await scratch()
  try {
    await f.linked()
    let head = await commit(f.caller, 'base.txt', 'landed base\n')
    await Deno.writeTextFile(f.primary + '/base.txt', 'staged mirror\n')
    await git(f.primary, 'add', 'base.txt')
    await Deno.writeTextFile(f.primary + '/base.txt', 'unstaged mirror\n')
    await Deno.writeTextFile(f.primary + '/scratch.txt', 'untracked\n')
    let status = await git(f.primary, 'status', '--porcelain')
    let index = await git(f.primary, 'show', ':base.txt')

    equal(await f.land(), { landed: head, root: f.caller })
    equal(await refAt(f.g, f.app, MAIN), head)
    equal(await git(f.primary, 'rev-parse', 'HEAD'), f.base)
    equal(await git(f.primary, 'status', '--porcelain'), status)
    equal(await git(f.primary, 'show', ':base.txt'), index)
    equal(await Deno.readTextFile(f.primary + '/base.txt'), 'unstaged mirror\n')
    equal(await Deno.readTextFile(f.primary + '/scratch.txt'), 'untracked\n')
    equal(await git(f.caller, 'status', '--porcelain'), '')
  } finally {
    await f.free()
  }
})

test('discover cannot replace accepted graph main with a stale local checkout observation', async () => {
  let f = await scratch()
  try {
    await f.linked()
    await discover(f.g, f.caller, f.machine)
    await f.accept(f.primary, f.app, null)
    let rival = await f.clone(f.root + '/rival')
    let accepted = await commit(rival, 'rival.txt', 'accepted elsewhere\n')
    await f.accept(rival, f.app, f.base)
    equal(await git(f.primary, 'rev-parse', MAIN), f.base)
    equal(await hasObject(f.caller, accepted), false)

    await discover(f.g, f.caller, f.machine)
    equal(await refAt(f.g, f.app, MAIN), accepted)
    await discover(f.g, f.primary, f.machine)
    equal(await refAt(f.g, f.app, MAIN), accepted)
    equal(await git(f.primary, 'rev-parse', MAIN), f.base)
    equal(await hasObject(f.caller, accepted), false)
  } finally {
    await f.free()
  }
})

test('graph fetch crosses the argv size limit through Machine files, not shell arguments', async () => {
  let f = await scratch()
  try {
    let app = crypto.randomUUID()
    await f.g.apply([{ entity: { eid: app } }])
    await f.accept(f.primary, app, null)
    await f.clone(f.caller)
    let rival = await f.clone(f.root + '/large-rival')
    let bytes = new Uint8Array(256 * 1024)
    for (let i = 0; i < bytes.length; i += 65536) {
      crypto.getRandomValues(bytes.subarray(i, i + 65536))
    }
    await Deno.writeFile(rival + '/large.bin', bytes)
    await git(rival, 'add', 'large.bin')
    await git(rival, 'commit', '-qm', 'large blob')
    let head = await f.accept(rival, app, f.base)
    await fetchObjects(f.g, f.bytes, f.machine, f.caller, head)
    equal(await hasObject(f.caller, head), true)
    equal(await git(f.caller, 'status', '--porcelain'), '')
    equal(await git(f.caller, 'rev-parse', 'HEAD'), f.base)
  } finally {
    await f.free()
  }
})

test('HTTP session landing chooses its recorded machine, never the server checkout', async () => {
  let { g, bytes } = fixture({
    docs: [{
      $defs: {
        session: { component: true, type: 'object' },
        home: {
          component: true,
          type: 'object',
          properties: { machine: { type: 'string' }, cwd: { type: 'string' } },
        },
        machine: {
          component: true,
          type: 'object',
          properties: {
            provider: { type: 'string' },
            address: { type: 'string' },
          },
        },
      },
    }],
  })
  let session = crypto.randomUUID(), id = crypto.randomUUID()
  await g.apply([{
    entity: { eid: session },
    session: {},
    home: { machine: id, cwd: '/session/checkout' },
  }, {
    entity: { eid: id },
    machine: { provider: 'remote', address: 'session-box' },
  }])
  let local = testMachine(), remote = testMachine()
  let host = {
    roles: ['web', 'graph'],
    artifacts: bytes,
    machines: {
      local,
      defaultProvider: 'remote',
      providers: {
        remote: {
          wake: () => Promise.resolve({ machine: remote }),
          release: () => Promise.resolve(),
          export: async function* () {},
        },
      },
    },
  }
  let got = await callerMachine(host, {
    entity: { eid: crypto.randomUUID() },
    $actor: { by: session },
    process: { cwd: '/server/checkout' },
  }, g)
  equal(got.machine, remote)
  equal(got.cwd, '/session/checkout')
})

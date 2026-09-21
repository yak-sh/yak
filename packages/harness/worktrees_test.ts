import { assert, assertEquals, assertRejects } from '@std/assert'
import { discover } from '@yaks/git/host'
import { agent } from './run.ts'
import { open } from './store.ts'
import { sessionCwd } from './workspace.ts'
import {
  collect,
  cutFor,
  going,
  holds,
  homes,
  lost,
  over,
  reclaim,
  restore,
  sweep,
} from './worktrees.ts'

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

/** Poll instead of guessing: an effect runs after its batch commits. */
let until = async (fact: () => Promise<boolean>, timeout = 5000) => {
  let end = Date.now() + timeout
  while (!await fact()) {
    if (Date.now() >= end) throw new Error('never became true')
    await new Promise((go) => setTimeout(go, 5))
  }
}

/** A repository, a worktree root beside it, and one cut checkout per name. */
let fixture = async () => {
  let dir = await Deno.makeTempDir()
  let repo = dir + '/repo'
  let root = dir + '/worktrees'
  await Deno.mkdir(repo)
  await Deno.mkdir(root)
  await git(repo, 'init', '-q', '-b', 'main', '.')
  await git(repo, 'config', 'user.email', 'test@example.org')
  await git(repo, 'config', 'user.name', 'Test')
  await Deno.writeTextFile(repo + '/file', 'committed')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-qm', 'initial')
  return {
    dir,
    repo,
    root,
    cut: async (name: string) => {
      let path = root + '/' + name
      await git(
        repo,
        'worktree',
        'add',
        '-q',
        '-b',
        'task-' + name,
        path,
        'HEAD',
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

/** One entry, said the way `statusOf` reads it: prose a model returned with
 * nothing owed after it (settled), or a `stop` line (stopped). */
let line = (session: string, seq: number, comp: Record<string, unknown>) => ({
  entity: { eid: `${session}:${seq}` },
  entry: { session, seq },
  ...comp,
})
let said = (session: string, seq = 1) =>
  line(session, seq, { output: {}, content: { body: 'done' } })
let stopped = (session: string, seq = 1) => line(session, seq, { stop: {} })

Deno.test('a checkout is named after the child it was cut for', () => {
  assertEquals(cutFor('child:abc', '/wt'), '/wt/child-abc')
})

Deno.test('a clean, landed checkout is taken back with its branch', async () => {
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

Deno.test('dirty files and unlanded commits keep a checkout', async () => {
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

Deno.test('a checkout whose gitdir is gone is removed outright', async () => {
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

Deno.test('a sweep takes back the root, keeps what is held, and skips a live home', async () => {
  let f = await fixture()
  let h = open(':memory:')
  try {
    let gone = await f.cut('gone')
    await f.commit(gone, 'landed')
    await git(f.repo, 'branch', 'parent', 'task-gone')
    let kept = await f.cut('kept')
    await f.commit(kept, 'unlanded')
    let live = await f.cut('live')
    await Deno.writeTextFile(f.root + '/not-a-directory', 'ignored')
    let held = await sweep(h.g, f.root, new Set([live]))
    assertEquals(held, { [kept]: 'unlanded' })
    assertEquals(await there(gone), false)
    assert(await there(kept))
    assert(await there(live))
    assert(await there(f.root + '/not-a-directory'))
    // Where each swept checkout stood is recorded before its bytes go: that
    // row is all a resume has to cut it again from.
    let [row] = await h.g.read(`.worktree.path=${gone}`)
    assertEquals(
      (row.worktree as Record<string, unknown>).head,
      await git(
        f.repo,
        'rev-parse',
        'parent',
      ),
    )
    assertEquals(await sweep(h.g, f.root + '/absent'), {})
  } finally {
    h.close()
    await f.free()
  }
})

Deno.test('over: a transcript that ended, and a process that exited with it', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([
      { entity: { eid: 'empty' }, session: {} },
      { entity: { eid: 'busy' }, session: {} },
      line('busy', 1, { content: { body: 'go' } }),
      { entity: { eid: 'done' }, session: {} },
      said('done'),
      { entity: { eid: 'halted' }, session: {} },
      stopped('halted'),
      { entity: { eid: 'agent' }, session: {}, process: { pid: 1 } },
      said('agent'),
    ])
    let saw = async (eid: string) =>
      over(
        (await h.g.read('.session'))
          .find((b) => b.entity.eid == eid)!,
      )
    assertEquals(await saw('empty'), false)
    assertEquals(await saw('busy'), false)
    assertEquals(await saw('done'), true)
    assertEquals(await saw('halted'), true)
    // A settled transcript whose agent is still running is not over.
    assertEquals(await saw('agent'), false)
    assertEquals(
      (await going(h.g)).map((b) => b.entity.eid).toSorted(),
      ['agent', 'busy'],
    )
    await h.g.apply([{ entity: { eid: 'agent' }, exit: { code: 0 } }])
    assertEquals(await saw('agent'), true)
  } finally {
    h.close()
  }
})

Deno.test('collect keeps a checkout while its session could still run', async () => {
  let f = await fixture()
  let h = open(':memory:')
  try {
    let path = await f.cut('child-one')
    await h.g.apply([{ entity: { eid: 'child:one' }, session: {} }])
    // The pool letting go is not the transcript ending: an empty transcript
    // keeps everything, whatever the dispatch says.
    await h.g.apply([{
      entity: { eid: 'child:one' },
      dispatch: { state: 'settled' },
    }])
    assertEquals(await collect(h.g, 'child:one', f.root), undefined)
    assert(await there(path))
    // A session with no checkout of its own finds nothing to take.
    assertEquals(await collect(h.g, 'child:two', f.root), undefined)
    await h.g.apply([said('child:one')])
    assertEquals(await collect(h.g, 'child:one', f.root), undefined)
    assertEquals(await there(path), false)
  } finally {
    h.close()
    await f.free()
  }
})

Deno.test('a collected checkout is cut again where it stood', async () => {
  let f = await fixture()
  let h = open(':memory:')
  try {
    let path = await f.cut('child-one')
    await f.commit(path, 'the work')
    let head = await git(path, 'rev-parse', 'HEAD')
    await git(f.repo, 'branch', 'parent', 'task-child-one')
    await h.g.apply([
      { entity: { eid: 'child:one' }, session: {} },
      said('child:one'),
    ])
    assertEquals(await collect(h.g, 'child:one', f.root), undefined)
    assertEquals(await there(path), false)
    assertEquals(await f.branches(), 'main\nparent')

    let [row] = await h.g.read(`.worktree.path=${path}`)
    assertEquals(await restore(h.g, row), path)
    assertEquals(await git(path, 'rev-parse', 'HEAD'), head)
    assertEquals(
      await git(path, 'symbolic-ref', 'HEAD'),
      'refs/heads/task-child-one',
    )
    assertEquals(await git(path, 'status', '--porcelain'), '')
    assertEquals(await Deno.readTextFile(path + '/work'), 'the work')
    // Standing already, it is itself; and it can go and come back again.
    assertEquals(await restore(h.g, row), path)
    assertEquals(await collect(h.g, 'child:one', f.root), undefined)
    assertEquals(await there(path), false)
  } finally {
    h.close()
    await f.free()
  }
})

Deno.test('a checkout with nothing recorded cannot be cut again', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([{ entity: { eid: 'w1' }, worktree: { path: '/wt/gone' } }])
    let [row] = await h.g.read('.worktree')
    await assertRejects(() => restore(h.g, row), Error, 'nothing recorded')
  } finally {
    h.close()
  }
})

Deno.test('live homes are the checkouts named for a session and the ones it inherited', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([
      { entity: { eid: 'w1' }, worktree: { path: '/wt/child-inherited' } },
      { entity: { eid: 'child:one' }, session: {}, home: { worktree: 'w1' } },
      { entity: { eid: 'child:two' }, session: {} },
    ])
    let live = await homes(h.g, await h.g.read('.session'), '/wt')
    assertEquals(
      [...live].toSorted(),
      ['/wt/child-inherited', '/wt/child-one', '/wt/child-two'],
    )
  } finally {
    h.close()
  }
})

Deno.test('a child that is over hands its checkout back, and gets it again on resume', async () => {
  let f = await fixture()
  let was = Deno.env.get('HARNESS_WORKTREE_DIR')
  Deno.env.set('HARNESS_WORKTREE_DIR', f.root)
  let a = agent({
    h: open(':memory:'),
    model: () => Promise.reject(new Error('no model is asked here')),
    tools: [],
  })
  try {
    let path = await f.cut('child-one')
    assertEquals(cutFor('child:one'), path)
    await f.commit(path, 'the work')
    await git(f.repo, 'branch', 'parent', 'task-child-one')
    let home = (await discover(a.h.g, path)).entity.eid
    await a.h.g.apply([{
      entity: { eid: 'child:one' },
      session: {},
      home: { worktree: home },
      dispatch: { state: 'queued' },
    }], { trusted: true })
    // The pool letting go says nothing about the transcript.
    await a.h.g.apply([{
      entity: { eid: 'child:one' },
      dispatch: { state: 'settled' },
    }], { trusted: true })
    assertEquals(await collect(a.h.g, 'child:one', f.root), undefined)
    assert(await there(path))

    // The transcript ending is what hands it back.
    await a.h.g.apply([stopped('child:one')], { trusted: true })
    await until(async () => !await there(path))
    await until(async () => await f.branches() == 'main\nparent')

    // Resumed, the session asks where it runs — and its work is there.
    assertEquals(await sessionCwd(a.h.g, 'child:one', f.repo), path)
    assertEquals(await Deno.readTextFile(path + '/work'), 'the work')
    assertEquals(await f.branches(), 'main\nparent\ntask-child-one')
  } finally {
    await a.close()
    if (was == null) Deno.env.delete('HARNESS_WORKTREE_DIR')
    else Deno.env.set('HARNESS_WORKTREE_DIR', was)
    await f.free()
  }
})

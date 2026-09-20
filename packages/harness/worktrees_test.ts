import { assert, assertEquals } from '@std/assert'
import { agent } from './run.ts'
import { open } from './store.ts'
import { cutFor, holds, homes, lost, reclaim, sweep } from './worktrees.ts'

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
  try {
    let gone = await f.cut('gone')
    let kept = await f.cut('kept')
    await f.commit(kept, 'unlanded')
    let live = await f.cut('live')
    await Deno.writeTextFile(f.root + '/not-a-directory', 'ignored')
    let held = await sweep(f.root, new Set([live]))
    assertEquals(held, { [kept]: 'unlanded' })
    assertEquals(await there(gone), false)
    assert(await there(kept))
    assert(await there(live))
    assert(await there(f.root + '/not-a-directory'))
    assertEquals(await sweep(f.root + '/absent'), {})
  } finally {
    await f.free()
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

Deno.test('a settled child hands its checkout back', async () => {
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
    await a.h.g.apply([{
      entity: { eid: 'child:one' },
      session: {},
      dispatch: { state: 'queued' },
    }], { trusted: true })
    assert(await there(path))
    await a.h.g.apply([{
      entity: { eid: 'child:one' },
      dispatch: { state: 'settled' },
    }], { trusted: true })
    await until(async () => !await there(path))
    await until(async () => await f.branches() == 'main')
  } finally {
    await a.close()
    if (was == null) Deno.env.delete('HARNESS_WORKTREE_DIR')
    else Deno.env.set('HARNESS_WORKTREE_DIR', was)
    await f.free()
  }
})

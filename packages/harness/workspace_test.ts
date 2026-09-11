import { daemon } from '@yaks/session'
import { agent } from './run.ts'
import { harnessTools } from './tools.ts'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { checkoutAt, createWorktree, discover } from '@yaks/git/host'
import { refEid } from '../git/refs.ts'
import { open } from './store.ts'
import { homeAt, sessionCwd, workspace } from './workspace.ts'

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
let fixture = async () => {
  let dir = await Deno.makeTempDir()
  let repo = dir + '/repo'
  await Deno.mkdir(repo)
  await git(repo, 'init', '-b', 'main')
  await git(repo, 'config', 'user.email', 'test@example.org')
  await git(repo, 'config', 'user.name', 'Test')
  await Deno.writeTextFile(repo + '/file', 'committed')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-m', 'initial')
  let h = open(':memory:')
  return {
    dir,
    repo,
    h,
    free: async () => {
      h.close()
      await Deno.remove(dir, { recursive: true })
    },
  }
}

Deno.test('worktree discovery is canonical, shared, and ref identity survives movement/deletion', async () => {
  let f = await fixture()
  try {
    let a = await discover(f.h.g, f.repo)
    let b = await discover(f.h.g, f.repo + '/.')
    assertEquals(a.entity.eid, b.entity.eid)
    assertEquals(a.updated, b.updated)
    let home = await homeAt(f.h.g, f.repo)
    await Deno.mkdir(f.repo + '/sub')
    await f.h.g.apply([
      { entity: { eid: 's1' }, session: {}, home },
      {
        entity: { eid: 's2' },
        session: {},
        home: { worktree: home.worktree, cwd: f.repo + '/sub' },
      },
    ])
    assertEquals(await sessionCwd(f.h.g, 's2', '/wrong'), f.repo + '/sub')
    let repo = String((a.worktree as Comp).repository)
    let id = refEid(repo, 'refs/heads/main')
    let before = (await f.h.g.read('.ref.app=' + repo)).find((b) =>
      b.entity.eid == id
    )!
    await Deno.writeTextFile(f.repo + '/file', 'next')
    await git(f.repo, 'commit', '-am', 'next')
    await discover(f.h.g, f.repo)
    let after = (await f.h.g.read('.ref.app=' + repo)).find((b) =>
      b.entity.eid == id
    )!
    assert((before.ref as Comp).oid != (after.ref as Comp).oid)
    await git(
      f.repo,
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/heads/main',
    )
    await discover(f.h.g, f.repo)
    let symbolic = (await f.h.g.read('.ref.app=' + repo)).find((b) =>
      (b.ref as Comp).name == 'refs/remotes/origin/HEAD'
    )!
    assertEquals((symbolic.ref as Comp).target, 'refs/heads/main')
    await git(f.repo, 'branch', 'temporary')
    await discover(f.h.g, f.repo)
    await git(f.repo, 'branch', '-D', 'temporary')
    await discover(f.h.g, f.repo)
    let gone = (await f.h.g.read('.ref.app=' + repo)).find((b) =>
      (b.ref as Comp).name == 'refs/heads/temporary'
    )!
    assertEquals(Boolean((gone.ref as Comp).present), false)
    assertEquals((await f.h.g.read('.worktree')).length, 1)
  } finally {
    await f.free()
  }
})

Deno.test('concurrent creation and retry share identity, dirty files stay home, detached and branch HEAD differ', async () => {
  let f = await fixture()
  try {
    await Deno.writeTextFile(f.repo + '/file', 'dirty')
    let request = { path: f.dir + '/child' }
    let [a, b] = await Promise.all([
      createWorktree(f.h.g, f.repo, request),
      createWorktree(f.h.g, f.repo, request),
    ])
    assertEquals(a.entity.eid, b.entity.eid)
    assertEquals(await Deno.readTextFile(request.path + '/file'), 'committed')
    assertEquals((a.worktree as Comp).branch ?? null, null)
    assertEquals(Boolean((a.worktree as Comp).managed), true)
    let linked = await createWorktree(f.h.g, f.repo, {
      path: f.dir + '/branch',
      branch: 'feature',
    })
    let repo = String((linked.worktree as Comp).repository)
    assertEquals(
      (linked.worktree as Comp).branch,
      refEid(repo, 'refs/heads/feature'),
    )
    assertEquals(
      (await discover(f.h.g, f.repo)).worktree &&
        (await f.h.g.read('.ref.app=' + repo)).filter((b) =>
          (b.ref as Comp).name == 'refs/heads/feature'
        ).length,
      1,
    )
    await assertRejects(() => createWorktree(f.h.g, f.repo, { path: f.repo }))
    await assertRejects(() =>
      createWorktree(f.h.g, f.repo, { path: f.dir + '/bad', branch: 'main' })
    )
    let failed = await f.h.g.read('.checkout.state=failed')
    assertEquals(failed.length, 1)
    assert(String((failed[0].checkout as Comp).error).includes('git'))
    // Simulate a crash after Git creation, before marking preparation ready.
    await f.h.g.apply([{
      entity: linked.entity,
      worktree: null,
      checkout: { state: 'preparing' },
    }])
    let recovered = await createWorktree(f.h.g, f.repo, {
      path: f.dir + '/branch',
      branch: 'feature',
    })
    assertEquals(recovered.entity.eid, linked.entity.eid)
    assertEquals((recovered.checkout as Comp).state, 'ready')
  } finally {
    await f.free()
  }
})

Deno.test('host preparation separates home and cwd, defaults to sharing, and refuses failures before launch', async () => {
  let f = await fixture()
  try {
    let home = await homeAt(f.h.g, f.repo)
    await f.h.g.apply([{ entity: { eid: 'parent' }, session: {}, home }])
    let prepare = workspace(f.h.g, f.repo).prepareChild!
    assertEquals(
      (await prepare({ parent: 'parent', child: 'one', args: {} })).home,
      home,
    )
    let prepared = await prepare({
      parent: 'parent',
      child: 'two',
      args: { worktree: { path: f.dir + '/two' } },
    })
    await f.h.g.apply([{ entity: { eid: 'two' }, session: {}, ...prepared }])
    assertEquals(await sessionCwd(f.h.g, 'two', '/wrong'), f.dir + '/two')
    let attach = await prepare({
      parent: 'parent',
      child: 'three',
      args: { home: (prepared.home as Comp).worktree, cwd: f.repo },
    })
    assertEquals((attach.home as Comp).cwd, f.repo)
    assertEquals((await f.h.g.read('.worktree')).length, 2)
    await assertRejects(() =>
      prepare({
        parent: 'parent',
        child: 'bad',
        args: { worktree: { path: f.dir + '/bad', base: 'missing-commit' } },
      })
    )
    assertEquals(await f.h.g.read('.session.id=bad'), [])
    assertEquals(await checkoutAt(f.h.g, f.dir), undefined)
  } finally {
    await f.free()
  }
})

Deno.test('spawn prepares admitted home, replay creates nothing, shell defaults are session-local', async () => {
  let f = await fixture()
  let d: ReturnType<typeof daemon> | undefined
  try {
    await f.h.g.apply([{
      entity: { eid: 'parent' },
      session: {},
      home: await homeAt(f.h.g, f.repo),
    }])
    await f.h.g.apply([{
      entity: { eid: 'spawn-one' },
      call: {},
      entry: { session: 'parent', seq: 1 },
    }, {
      entity: { eid: 'bad-spawn' },
      entry: { session: 'parent' },
      call: { id: 'bad-spawn' },
    }])
    let tools = harnessTools(f.h.g, { cwd: f.repo })
    let spawn = tools.find((t) => t.name == 'spawn')!
    let ctx = {
      session: 'parent',
      call: { entity: { eid: 'spawn-one' } },
      entries: [],
    }
    let args = { prompt: 'work', worktree: { path: f.dir + '/child' } }
    let child = await spawn.run(args, ctx)
    assertEquals(await spawn.run(args, ctx), child)
    let entries = await f.h.g.read('.entry.session=' + child)
    assertEquals(entries.length, 1)
    d = daemon(
      f.h.g,
      f.h.fx,
      {
        tools: [],
        model: () => Promise.resolve({ id: 'r', model: 'fake', items: [] }),
      },
      undefined,
      () => {},
    )
    await d.idle(child)
    assertEquals(await sessionCwd(f.h.g, child, '/wrong'), f.dir + '/child')
    let shell = tools.find((t) => t.name == 'shell')!
    let out = await shell.run({ command: 'pwd' }, { ...ctx, session: child })
    assert(out.includes(f.dir + '/child'))
    let explicit = await shell.run({ command: 'pwd', cwd: f.repo }, {
      ...ctx,
      session: child,
    })
    assert(explicit.includes(f.repo))
    assertEquals(await sessionCwd(f.h.g, child, '/wrong'), f.dir + '/child')
    let failed = await spawn.run({
      prompt: 'no',
      worktree: { path: f.dir + '/fail', branch: 'main' },
    }, { ...ctx, call: { entity: { eid: 'bad-spawn' } } })
    await d.idle(failed)
    assertEquals((await f.h.g.read('.session.id=child:bad-spawn')).length, 1)
    assertEquals((await f.h.g.read('.checkout.state=failed')).length, 1)
  } finally {
    await d?.stop()
    await f.free()
  }
})

Deno.test('root sessions discover and share the existing default worktree', async () => {
  let f = await fixture()
  let a = agent({
    h: f.h,
    cwd: f.repo,
    tools: [],
    model: (req) =>
      Promise.resolve({
        id: 'r',
        model: req.model,
        items: [{ kind: 'assistant', text: 'done' }],
      }),
  })
  try {
    let root = await a.start('hello')
    await a.idle(root)
    let other = await a.start('hello again')
    await a.idle(other)
    assertEquals((await f.h.g.read('.worktree')).length, 1)
    let roots = await f.h.g.read('.session')
    assertEquals(
      (roots[0].home as Comp).worktree,
      (roots[1].home as Comp).worktree,
    )
  } finally {
    await a.close()
    await Deno.remove(f.dir, { recursive: true })
  }
})

Deno.test('queued fork preserves anchor and prepares checkout on admission', async () => {
  let f = await fixture()
  let d: ReturnType<typeof daemon> | undefined
  try {
    let root = 'parent'
    let entries = [
      {
        entity: { eid: 'input' },
        entry: { session: root, seq: 1 },
        content: { body: 'hello' },
      },
      {
        entity: { eid: 'ask' },
        entry: { session: root, seq: 2 },
        ask: { through: 'input' },
      },
    ]
    await f.h.g.apply([{
      entity: { eid: root },
      session: {},
      home: await homeAt(f.h.g, f.repo),
    }, ...entries])
    let call = {
      entity: { eid: 'fork-call' },
      entry: { session: root, seq: 99 },
      call: {},
    }
    await f.h.g.apply([call])
    let fork = harnessTools(f.h.g, { cwd: f.repo }).find((t) =>
      t.name == 'fork'
    )!
    let child = await fork.run({
      prompt: 'fork work',
      worktree: { path: f.dir + '/forked' },
    }, { session: root, call, entries })
    d = daemon(
      f.h.g,
      f.h.fx,
      {
        tools: [],
        model: () => Promise.resolve({ id: 'r', model: 'fake', items: [] }),
      },
      undefined,
      () => {},
    )
    await d.idle(child)
    assertEquals(await sessionCwd(f.h.g, child, '/wrong'), f.dir + '/forked')
    assertEquals((await f.h.g.read('.worktree')).length, 2)
  } finally {
    await d?.stop()
    await f.free()
  }
})

Deno.test('user task forks stable context and prepares an independent pinned checkout', async () => {
  let f = await fixture()
  let a = agent({
    h: f.h,
    cwd: f.repo,
    maxChildren: 0,
    name: 'fake',
    model: () => Promise.resolve({ id: 'r', model: 'fake', items: [] }),
  })
  try {
    let root = await a.start('We are implementing a TUI, not browser CSS')
    await a.idle(root)
    await a.send(root, 'Keep components graph-free')
    await a.idle(root)
    let before = await a.transcript(root)
    let head = await git(f.repo, 'rev-parse', 'HEAD')
    await Deno.writeTextFile(f.repo + '/file', 'dirty parent')
    let admitted = await a.taskEntry(root, 'Fix table dividers')
    let child = (await f.h.g.storage.tx((tx) => tx.get([admitted.child])))[0]
    assertEquals((child.fork as Comp).from, before.at(-1)!.entity.eid)
    let args = JSON.parse(String((child.dispatch as Comp).args))
    assertEquals(args.worktree.base, head)
    await assertRejects(
      () => Deno.stat(args.worktree.path),
      Deno.errors.NotFound,
    )
    let inherited = await a.transcript(admitted.child)
    assertEquals(inherited.slice(0, before.length), before)
    assertEquals(
      inherited.filter((b) => (b.content as Comp)?.body == 'Fix table dividers')
        .length,
      1,
    )
    let prepared = await workspace(f.h.g, f.repo).prepareChild!({
      parent: root,
      child: admitted.child,
      args,
    })
    await f.h.g.apply([{ entity: child.entity, ...prepared }])
    assertEquals(
      await sessionCwd(f.h.g, admitted.child, '/wrong'),
      args.worktree.path,
    )
    assertEquals(
      await Deno.readTextFile(args.worktree.path + '/file'),
      'committed',
    )
    assertEquals(await Deno.readTextFile(f.repo + '/file'), 'dirty parent')
    assertEquals(
      await workspace(f.h.g, f.repo).prepareChild!({
        parent: root,
        child: admitted.child,
        args,
      }),
      prepared,
    )
    await git(f.repo, 'worktree', 'remove', args.worktree.path)
  } finally {
    await a.close()
    await Deno.remove(f.dir, { recursive: true })
  }
})

Deno.test('user task outside a repository fails before minting work', async () => {
  let dir = await Deno.makeTempDir()
  let a = agent({
    h: open(':memory:'),
    cwd: dir,
    name: 'fake',
    model: () => Promise.resolve({ id: 'r', model: 'fake', items: [] }),
  })
  try {
    let root = await a.start('nonrepo')
    await a.idle(root)
    await assertRejects(
      () => a.taskEntry(root, 'work'),
      Error,
      'requires a Git repository',
    )
    assertEquals(await a.tasks(), [])
  } finally {
    await a.close()
    await Deno.remove(dir, { recursive: true })
  }
})

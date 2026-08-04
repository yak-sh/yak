// Landing against disposable git repositories: the graph chooses every
// coordinate, a red gate leaves origin untouched, contention rebases and
// retests, and a non-contention refusal does not burn the retry budget.
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { type Row } from './client.ts'
import { land, landedChanges, type Landing, landing } from './land.ts'

let row = (
  eid: string,
  num: number,
  kind: string,
  comps: Row['comps'],
): Row => ({ eid, num, kind, comps })

Deno.test('landing reads the session task and its project from the graph', () => {
  let project = row('p', 19, 'project', {
    project: {},
    repo: {
      path: '/code/tasks',
      base_branch: 'main',
      gate: 'deno task gate',
    },
  })
  let task = row('t', 42, 'task', {
    task: { status: 'open', project_eid: project.eid },
  })
  let session = row('s', 7, 'session', {
    session: {
      id: 'thread',
      requested_task_eid: task.eid,
      cwd: '/worktrees/S-7',
      branch: 'session/S-7',
    },
  })
  assertEquals(landing([project, task, session], 'thread'), {
    repo: '/code/tasks',
    base: 'main',
    gate: 'deno task gate',
    tree: '/worktrees/S-7',
    task,
  })
  delete project.comps.repo.gate
  assertThrows(
    () => landing([project, task, session], 'thread'),
    Error,
    'P-19: repo.gate is required',
  )
})

Deno.test('a landing completes its task with one idempotent receipt', () => {
  let task = row('t', 42, 'task', { task: { status: 'wip' } })
  let session = row('s', 7, 'session', { session: { id: 'thread' } })
  let changes = landedChanges([task, session], task, 'abc123', 'thread')
  assertEquals(changes[0], {
    eid: task.eid,
    name: 'task',
    comp: { status: 'done' },
  })
  let doc = changes.find((c) => c.name == 'doc')!
  assertEquals(doc.comp?.body, 'Landed `abc123`.')
  let receipt = row(doc.eid, 8, 'comment', {
    doc: doc.comp!,
    comment: { target_eid: task.eid },
  })
  assertEquals(
    landedChanges([task, session, receipt], task, 'abc123', 'thread'),
    [],
  )
})

type Repo = { root: string; repo: string; remote: string; spec: Landing }

let command = async (cwd: string, ...args: string[]) => {
  let r = await new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  let out = new TextDecoder().decode(r.stdout).trim()
  let err = new TextDecoder().decode(r.stderr).trim()
  if (r.code) throw new Error(`git ${args.join(' ')}: ${err || out}`)
  return out
}

let result = async (cwd: string, ...args: string[]) =>
  await new Deno.Command('git', {
    args,
    cwd,
    stdout: 'null',
    stderr: 'null',
  }).output()

let exists = (path: string) => {
  try {
    Deno.statSync(path)
    return true
  } catch {
    return false
  }
}

let setup = async (): Promise<Repo> => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-land-' })
  let remote = `${root}/origin.git`
  let repo = `${root}/repo`
  let tree = `${root}/S-7`
  await command(root, 'init', '--bare', '--initial-branch=main', remote)
  await command(root, 'clone', remote, repo)
  await command(repo, 'config', 'user.email', 'test@example.com')
  await command(repo, 'config', 'user.name', 'Test')
  Deno.writeTextFileSync(`${repo}/base.txt`, 'base\n')
  await command(repo, 'add', 'base.txt')
  await command(repo, 'commit', '-m', 'base')
  await command(repo, 'push', 'origin', 'HEAD:main')
  await command(repo, 'worktree', 'add', '-b', 'session/S-7', tree, 'main')
  Deno.writeTextFileSync(`${tree}/candidate.txt`, 'candidate\n')
  await command(tree, 'add', 'candidate.txt')
  await command(tree, 'commit', '-m', 'candidate')
  let task = row('t', 42, 'task', { task: { status: 'open' } })
  return {
    root,
    repo,
    remote,
    spec: {
      repo,
      base: 'main',
      gate: 'the project gate',
      tree,
      task,
    },
  }
}

let quiet = { write: () => {} }

Deno.test('a red project gate never reaches origin', async () => {
  let r = await setup()
  try {
    let before = await command(r.repo, 'rev-parse', 'origin/main')
    r.spec.gate = "printf 'looks green\\n'; exit 7"
    await assertRejects(
      () =>
        land(r.spec, {
          ...quiet,
          cwd: r.spec.tree,
        }),
      Error,
      'project gate failed with exit 7',
    )
    assertEquals(await command(r.repo, 'rev-parse', 'origin/main'), before)
    assert(exists(r.spec.tree))
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test('a concurrent landing rebases, retests, records, and cleans up', async () => {
  let r = await setup()
  try {
    let rival = `${r.root}/rival`
    await command(r.root, 'clone', r.remote, rival)
    await command(rival, 'config', 'user.email', 'test@example.com')
    await command(rival, 'config', 'user.name', 'Test')
    let gates = 0, recorded = ''
    let sha = await land(r.spec, {
      ...quiet,
      cwd: r.spec.tree,
      gate: async () => {
        gates++
        if (gates == 1) {
          Deno.writeTextFileSync(`${rival}/rival.txt`, 'rival\n')
          await command(rival, 'add', 'rival.txt')
          await command(rival, 'commit', '-m', 'rival')
          await command(rival, 'push', 'origin', 'HEAD:main')
        }
        return 0
      },
      record: (landed) => {
        assert(exists(r.spec.tree))
        recorded = landed
        return Promise.resolve()
      },
    })
    assertEquals(gates, 2)
    assertEquals(recorded, sha)
    assertEquals(
      (await command(r.repo, 'ls-remote', 'origin', 'refs/heads/main')).split(
        /\s/,
      )[0],
      sha,
    )
    assertEquals(await command(r.repo, 'show', `${sha}:rival.txt`), 'rival')
    assertEquals(
      await command(r.repo, 'show', `${sha}:candidate.txt`),
      'candidate',
    )
    assertEquals(exists(r.spec.tree), false)
    assertEquals(
      (await result(r.repo, 'show-ref', '--verify', 'refs/heads/session/S-7'))
        .success,
      false,
    )
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test('a push refusal without contention does not rerun the gate', async () => {
  let r = await setup()
  try {
    let hook = `${r.remote}/hooks/pre-receive`
    Deno.writeTextFileSync(hook, '#!/bin/sh\nexit 1\n')
    Deno.chmodSync(hook, 0o755)
    let gates = 0
    await assertRejects(
      () =>
        land(r.spec, {
          ...quiet,
          cwd: r.spec.tree,
          gate: () => Promise.resolve((gates++, 0)),
        }),
      Error,
      'git push failed with exit 1',
    )
    assertEquals(gates, 1)
    assert(exists(r.spec.tree))
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

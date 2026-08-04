// Landing against disposable git repositories: the graph chooses every
// coordinate, a red gate leaves the base branch untouched, contention
// rebases and retests, and a non-contention refusal does not burn the retry
// budget. No remote anywhere — landing is a fast-forward of the project's
// own checkout, and a test that needed a network would be testing the wrong
// verb.
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

type Repo = { root: string; repo: string; spec: Landing }

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
  let repo = `${root}/repo`
  let tree = `${root}/S-7`
  Deno.mkdirSync(repo)
  await command(repo, 'init', '--initial-branch=main')
  await command(repo, 'config', 'user.email', 'test@example.com')
  await command(repo, 'config', 'user.name', 'Test')
  Deno.writeTextFileSync(`${repo}/base.txt`, 'base\n')
  await command(repo, 'add', 'base.txt')
  await command(repo, 'commit', '-m', 'base')
  await command(repo, 'worktree', 'add', '-b', 'session/S-7', tree, 'main')
  Deno.writeTextFileSync(`${tree}/candidate.txt`, 'candidate\n')
  await command(tree, 'add', 'candidate.txt')
  await command(tree, 'commit', '-m', 'candidate')
  let task = row('t', 42, 'task', { task: { status: 'open' } })
  return {
    root,
    repo,
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

Deno.test('a red project gate never moves the base branch', async () => {
  let r = await setup()
  try {
    let before = await command(r.repo, 'rev-parse', 'main')
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
    assertEquals(await command(r.repo, 'rev-parse', 'main'), before)
    assert(exists(r.spec.tree))
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test('landing refuses a checkout sitting on another branch', async () => {
  let r = await setup()
  try {
    await command(r.repo, 'checkout', '-q', '-b', 'detour')
    await assertRejects(
      () => land(r.spec, { ...quiet, cwd: r.spec.tree }),
      Error,
      `land: ${r.repo} is on detour, not main`,
    )
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test('landing leaves the checkout holding the work it tested', async () => {
  let r = await setup()
  try {
    // Dirt the merge does not touch stays put: the shared checkout is a tree
    // people work in, and landing is not entitled to a spotless one.
    Deno.writeTextFileSync(`${r.repo}/scratch.txt`, 'mine\n')
    let sha = await land(r.spec, {
      ...quiet,
      cwd: r.spec.tree,
      gate: () => Promise.resolve(0),
    })
    assertEquals(await command(r.repo, 'rev-parse', 'main'), sha)
    assertEquals(
      Deno.readTextFileSync(`${r.repo}/candidate.txt`),
      'candidate\n',
    )
    assertEquals(Deno.readTextFileSync(`${r.repo}/scratch.txt`), 'mine\n')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test('a concurrent landing rebases, retests, records, and cleans up', async () => {
  let r = await setup()
  try {
    let rival = `${r.root}/rival`
    let gates = 0, recorded = ''
    let sha = await land(r.spec, {
      ...quiet,
      cwd: r.spec.tree,
      // A rival lander does exactly what this verb does: its own worktree,
      // fast-forwarded into the same checkout while our gate is running.
      gate: async () => {
        gates++
        if (gates == 1) {
          await command(r.repo, 'worktree', 'add', '-b', 'rival', rival, 'main')
          Deno.writeTextFileSync(`${rival}/rival.txt`, 'rival\n')
          await command(rival, 'add', 'rival.txt')
          await command(rival, 'commit', '-m', 'rival')
          await command(r.repo, 'merge', '--ff-only', 'rival')
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
    assertEquals(await command(r.repo, 'rev-parse', 'main'), sha)
    assertEquals(Deno.readTextFileSync(`${r.repo}/rival.txt`), 'rival\n')
    assertEquals(
      Deno.readTextFileSync(`${r.repo}/candidate.txt`),
      'candidate\n',
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

Deno.test('a merge refusal without contention does not rerun the gate', async () => {
  let r = await setup()
  try {
    // The candidate rewrites a file the checkout has uncommitted edits to, so
    // git refuses the fast-forward while the base branch has not moved at all.
    Deno.writeTextFileSync(`${r.spec.tree}/base.txt`, 'rewritten\n')
    await command(r.spec.tree, 'commit', '-am', 'rewrite base')
    Deno.writeTextFileSync(`${r.repo}/base.txt`, 'being edited\n')
    let gates = 0
    await assertRejects(
      () =>
        land(r.spec, {
          ...quiet,
          cwd: r.spec.tree,
          gate: () => Promise.resolve((gates++, 0)),
        }),
      Error,
      'git merge failed with exit 1',
    )
    assertEquals(gates, 1)
    assert(exists(r.spec.tree))
    assertEquals(Deno.readTextFileSync(`${r.repo}/base.txt`), 'being edited\n')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

// Landing against disposable git repositories: the graph chooses every
// coordinate, a red gate leaves the base branch untouched, contention
// rebases and retests, and a non-contention refusal does not burn the retry
// budget. No remote anywhere — landing is a fast-forward of the project's
// own checkout, and a test that needed a network would be testing the wrong
// verb.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from '@std/assert'
import { type Row } from './client.ts'
import { land, type Landing, landing } from './land.ts'

let row = (
  eid: string,
  num: number,
  kind: string,
  comps: Row['comps'],
): Row => ({ eid, num, kind, comps })

Deno.test('landing reads the project that owns the worktree checkout', () => {
  let project = row('p', 19, 'project', {
    project: {},
    repo: {
      path: '/code/tasks',
      base_branch: 'main',
      gate: 'deno task gate',
    },
  })
  let other = row('q', 20, 'project', {
    project: {},
    repo: { path: '/code/other', base_branch: 'main', gate: 'g' },
  })
  assertEquals(landing([other, project], '/worktrees/S-7', '/code/tasks'), {
    repo: '/code/tasks',
    base: 'main',
    gate: 'deno task gate',
    tree: '/worktrees/S-7',
    push: false,
  })
  project.comps.repo.push = 1
  assertEquals(
    landing([project], '/worktrees/S-7', '/code/tasks').push,
    true,
  )
})

Deno.test('landing refuses a checkout no project owns', () => {
  let project = row('p', 19, 'project', {
    project: {},
    repo: { path: '/code/tasks', base_branch: 'main', gate: 'g' },
  })
  assertThrows(
    () => landing([project], '/worktrees/x', '/code/unknown'),
    Error,
    'land: no project has a checkout at /code/unknown',
  )
})

// A missing gate is not fatal at resolve time — land() decides, because
// --no-gate makes it irrelevant. Absent stays absent for the caller to see.
Deno.test('landing leaves a missing gate empty rather than throwing', () => {
  let project = row('p', 19, 'project', {
    project: {},
    repo: { path: '/code/tasks', base_branch: 'main' },
  })
  assertEquals(landing([project], '/worktrees/S-7', '/code/tasks').gate, '')
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
  // Locked, because that is how an agent's worktree arrives: the harness
  // locks the tree it hands out, naming that agent's pid. Every landing here
  // therefore runs the case the field has.
  await command(repo, 'worktree', 'lock', '--reason', 'an agent lives', tree)
  Deno.writeTextFileSync(`${tree}/candidate.txt`, 'candidate\n')
  await command(tree, 'add', 'candidate.txt')
  await command(tree, 'commit', '-m', 'candidate')
  return {
    root,
    repo,
    spec: {
      repo,
      base: 'main',
      gate: 'the project gate',
      tree,
      push: false,
    },
  }
}

// A bare remote wired as the base branch's real upstream — a genuine push
// establishes both the tracking config `@{u}` reads AND the remote-tracking
// ref, which a config-only stub cannot fake. `reachable: false` then breaks
// the remote's URL (tracking survives; connecting to it does not), the shape
// an unreachable remote takes for the refusal test below.
let withUpstream = async (r: Repo, reachable = true) => {
  let bare = `${r.root}/origin.git`
  await command(r.root, 'init', '--bare', '--initial-branch=main', bare)
  await command(r.repo, 'remote', 'add', 'origin', bare)
  await command(r.repo, 'push', '-q', '-u', 'origin', 'main')
  if (!reachable) {
    await command(
      r.repo,
      'remote',
      'set-url',
      'origin',
      `${r.root}/missing.git`,
    )
  }
  return bare
}

let quiet = { write: () => {} }

Deno.test('a red project gate never moves the base branch', async () => {
  let r = await setup()
  try {
    let before = await command(r.repo, 'rev-parse', 'main')
    let outcome = ''
    r.spec.gate = "printf 'looks green\\n'; exit 7"
    await assertRejects(
      () =>
        land(r.spec, {
          ...quiet,
          cwd: r.spec.tree,
          outcome: (error) => {
            outcome = error ?? ''
            return Promise.resolve()
          },
        }),
      Error,
      'project gate failed with exit 7',
    )
    assertEquals(await command(r.repo, 'rev-parse', 'main'), before)
    assertEquals(
      outcome,
      'UNLANDED: 1 commit on session/S-7 not in main — ' +
        'project gate failed with exit 7',
    )
    assert(exists(r.spec.tree))
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test('--no-gate lands a red gate without ever running it', async () => {
  let r = await setup()
  try {
    let ran = 0
    let sha = await land(r.spec, {
      ...quiet,
      cwd: r.spec.tree,
      force: true,
      // A gate that would fail — force must never reach it.
      gate: () => Promise.resolve((ran++, 7)),
    })
    assertEquals(ran, 0)
    assertEquals(await command(r.repo, 'rev-parse', 'main'), sha)
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test('an absent gate refuses unless --no-gate waives it', async () => {
  let r = await setup()
  try {
    r.spec.gate = ''
    let before = await command(r.repo, 'rev-parse', 'main')
    await assertRejects(
      () => land(r.spec, { ...quiet, cwd: r.spec.tree }),
      Error,
      'land: this project has no repo.gate',
    )
    assertEquals(await command(r.repo, 'rev-parse', 'main'), before)
    let sha = await land(r.spec, { ...quiet, cwd: r.spec.tree, force: true })
    assertEquals(await command(r.repo, 'rev-parse', 'main'), sha)
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

Deno.test('a concurrent landing rebases, retests, records, and keeps the tree', async () => {
  let r = await setup()
  try {
    let rival = `${r.root}/rival`
    let gates = 0, recorded = '', outcomes: (string | undefined)[] = []
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
      outcome: (error) => {
        outcomes.push(error)
        return Promise.resolve()
      },
    })
    assertEquals(gates, 2)
    assertEquals(recorded, sha)
    assertEquals(outcomes, [undefined])
    assertEquals(await command(r.repo, 'rev-parse', 'main'), sha)
    assertEquals(Deno.readTextFileSync(`${r.repo}/rival.txt`), 'rival\n')
    assertEquals(
      Deno.readTextFileSync(`${r.repo}/candidate.txt`),
      'candidate\n',
    )
    // The caller is still standing here, with a claim to release and scratch
    // to delete, so the tree and its branch outlive the landing — unlocked,
    // for whoever collects it once nobody is inside (probes.ts).
    assert(exists(r.spec.tree))
    assert(
      (await result(r.repo, 'show-ref', '--verify', 'refs/heads/session/S-7'))
        .success,
    )
    await command(r.repo, 'worktree', 'remove', r.spec.tree)
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
    let gates = 0, outcome = ''
    await assertRejects(
      () =>
        land(r.spec, {
          ...quiet,
          cwd: r.spec.tree,
          gate: () => Promise.resolve((gates++, 0)),
          outcome: (error) => {
            outcome = error ?? ''
            return Promise.resolve()
          },
        }),
      Error,
      'git merge failed with exit 1',
    )
    assertEquals(gates, 1)
    assertMatch(
      outcome,
      /^UNLANDED: 2 commits on session\/S-7 not in main — git merge failed /,
    )
    assert(exists(r.spec.tree))
    assertEquals(Deno.readTextFileSync(`${r.repo}/base.txt`), 'being edited\n')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test("a landing publishes to the base branch's upstream when the project grants it", async () => {
  let r = await setup()
  try {
    let bare = await withUpstream(r)
    r.spec.push = true
    let sha = await land(r.spec, {
      ...quiet,
      cwd: r.spec.tree,
      gate: () => Promise.resolve(0),
    })
    assertEquals(await command(bare, 'rev-parse', 'main'), sha)
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test('landing never publishes when the project withholds push', async () => {
  let r = await setup()
  try {
    let bare = await withUpstream(r)
    let before = await command(bare, 'rev-parse', 'main')
    let sha = await land(r.spec, {
      ...quiet,
      cwd: r.spec.tree,
      gate: () => Promise.resolve(0),
    })
    assertEquals(await command(r.repo, 'rev-parse', 'main'), sha)
    assertEquals(await command(bare, 'rev-parse', 'main'), before)
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

Deno.test('a publish refusal lands anyway — publishing is best-effort, never a failed land', async () => {
  let r = await setup()
  try {
    await withUpstream(r, false)
    r.spec.push = true
    let warned = ''
    let sha = await land(r.spec, {
      cwd: r.spec.tree,
      gate: () => Promise.resolve(0),
      write: (text, error) => {
        if (error && text.includes('publish')) warned = text
      },
    })
    assertEquals(await command(r.repo, 'rev-parse', 'main'), sha)
    assert(warned.includes('landed locally, publish separately'), warned)
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

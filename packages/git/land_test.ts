// Landing against disposable git repositories, with no graph and no server
// anywhere: land reads every coordinate from git alone. A base that has not
// moved fast-forwards; a base that moved makes land rebase and RETURN without
// merging, so a second land fast-forwards cleanly. No gate runs. No remote is
// needed except the two publish cases, which wire a real bare upstream.
//
// Every case that builds a repository costs git processes and a temp directory,
// so it runs under TASKS_SLOW; the guard's own two questions are stubbed and
// stay in the fast tier.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { land, reverts } from './land.ts'
import { runs } from './tools.ts'
import { CallError } from '@yaks/tools'
import type { ToolCtx } from '@yaks/graph'

let slow = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, ignore: !Deno.env.get('TASKS_SLOW') })

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

type Repo = { root: string; repo: string; tree: string }

// A primary checkout on `main` and one locked linked worktree on `work` with a
// commit to land — the shape a worker's checkout arrives in (whoever hands one
// out locks it). land derives `main` as the base and the primary as the shared
// checkout from `git worktree list`, so nothing here is a graph entity: the
// whole test proves land needs no graph, no server and no config.
let setup = async (): Promise<Repo> => {
  let root = Deno.makeTempDirSync({ prefix: 'yaks-land-' })
  let repo = `${root}/repo`
  let tree = `${root}/work`
  Deno.mkdirSync(repo)
  await command(repo, 'init', '--initial-branch=main')
  await command(repo, 'config', 'user.email', 'test@example.com')
  await command(repo, 'config', 'user.name', 'Test')
  Deno.writeTextFileSync(`${repo}/base.txt`, 'base\n')
  await command(repo, 'add', 'base.txt')
  await command(repo, 'commit', '-m', 'base')
  await command(repo, 'worktree', 'add', '-b', 'work', tree, 'main')
  await command(repo, 'worktree', 'lock', '--reason', 'someone works', tree)
  Deno.writeTextFileSync(`${tree}/candidate.txt`, 'candidate\n')
  await command(tree, 'add', 'candidate.txt')
  await command(tree, 'commit', '-m', 'candidate')
  return { root, repo, tree }
}

// A rival lands on `main` first — exactly what land does from another worktree:
// its own branch, fast-forwarded into the shared checkout. This is how the base
// MOVES out from under a pending lander.
let rivalLands = async (r: Repo, file: string, body: string) => {
  let rival = `${r.root}/rival`
  await command(r.repo, 'worktree', 'add', '-b', 'rival', rival, 'main')
  Deno.writeTextFileSync(`${rival}/${file}`, body)
  await command(rival, 'add', file)
  await command(rival, 'commit', '-m', 'rival')
  await command(r.repo, 'merge', '--ff-only', 'rival')
}

// A bare remote wired as `main`'s real upstream — a genuine push establishes
// both the tracking config `@{u}` reads AND the remote-tracking ref, which a
// config-only stub cannot fake. `reachable: false` then breaks the remote's URL
// (tracking survives; connecting to it does not), the shape the refusal wants.
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

slow(
  'land fast-forwards a branch whose base has not moved — no graph, no rebase',
  async () => {
    let r = await setup()
    try {
      let out: string[] = []
      let outcome = await land({ cwd: r.tree, write: (t) => out.push(t) })
      assert('landed' in outcome, JSON.stringify(outcome))
      assertEquals(await command(r.repo, 'rev-parse', 'main'), outcome.landed)
      assertEquals(
        await command(outcome.root, 'rev-parse', '--show-toplevel'),
        await command(r.repo, 'rev-parse', '--show-toplevel'),
      )
      assertEquals(
        Deno.readTextFileSync(`${r.repo}/candidate.txt`),
        'candidate\n',
      )
      // Nothing was rebased: land never mentions a moved base.
      assert(!out.join('\n').includes('moved'), out.join('\n'))
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

slow(
  'the `land` tool answers the sha; a divergence is a refusal',
  async () => {
    let r = await setup()
    try {
      // The tool acts on the checkout its CALL stands in — `ctx.cwd`, which a
      // command line fills with where the person typed.
      let ctx = { args: {}, cwd: r.tree } as unknown as ToolCtx
      await rivalLands(r, 'rival.txt', 'rival\n')
      let refused = await assertRejects(
        () => Promise.resolve(runs().land([], ctx)),
        CallError,
      )
      assert(refused.message.includes('moved'), refused.message)
      let [said] = await runs().land([], ctx)
      let landed = await command(r.repo, 'rev-parse', 'main')
      let body = String((said.content as { body?: unknown })?.body ?? '')
      assert(body.includes(`landed ${landed}`), body)
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

slow(
  'landing leaves the checkout holding the work it landed, dirt untouched',
  async () => {
    let r = await setup()
    try {
      // Dirt the merge does not touch stays put: the shared checkout is a tree
      // people work in, and landing is not entitled to a spotless one.
      Deno.writeTextFileSync(`${r.repo}/scratch.txt`, 'mine\n')
      let outcome = await land({ cwd: r.tree, ...quiet })
      assert('landed' in outcome)
      assertEquals(await command(r.repo, 'rev-parse', 'main'), outcome.landed)
      assertEquals(
        Deno.readTextFileSync(`${r.repo}/candidate.txt`),
        'candidate\n',
      )
      assertEquals(Deno.readTextFileSync(`${r.repo}/scratch.txt`), 'mine\n')
      // The worktree and its branch survive the landing, unlocked for whoever
      // collects it once nobody is inside.
      assert(exists(r.tree))
      assert(
        (await result(r.repo, 'show-ref', '--verify', 'refs/heads/work'))
          .success,
      )
      await command(r.repo, 'worktree', 'remove', r.tree)
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

slow(
  'a moved base makes land rebase and RETURN without merging; a second land fast-forwards',
  async () => {
    let r = await setup()
    try {
      let before = await command(r.repo, 'rev-parse', 'main')
      await rivalLands(r, 'rival.txt', 'rival\n')
      let moved = await command(r.repo, 'rev-parse', 'main')
      assert(moved != before)

      let out: string[] = []
      let first = await land({ cwd: r.tree, write: (t) => out.push(t) })
      assert('diverged' in first && !first.conflict, JSON.stringify(first))
      // The base is UNTOUCHED — land did not merge.
      assertEquals(await command(r.repo, 'rev-parse', 'main'), moved)
      let text = out.join('\n')
      assert(text.includes('moved'), text)
      // The `git diff --stat` names what the base pulled in.
      assert(text.includes('rival.txt'), text)
      // The branch was rebased: the moved base is now its ancestor.
      assert(
        (await result(r.tree, 'merge-base', '--is-ancestor', 'main', 'HEAD'))
          .success,
      )

      let second = await land({ cwd: r.tree, ...quiet })
      assert('landed' in second, JSON.stringify(second))
      assertEquals(await command(r.repo, 'rev-parse', 'main'), second.landed)
      assertEquals(Deno.readTextFileSync(`${r.repo}/rival.txt`), 'rival\n')
      assertEquals(
        Deno.readTextFileSync(`${r.repo}/candidate.txt`),
        'candidate\n',
      )
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

slow(
  "a rebase conflict returns with git's conflict output, leaving the rebase to resolve",
  async () => {
    let r = await setup()
    try {
      // Our branch and the moved base both rewrite base.txt, so the rebase
      // can't replay cleanly.
      Deno.writeTextFileSync(`${r.tree}/base.txt`, 'candidate edit\n')
      await command(r.tree, 'commit', '-am', 'edit base on branch')
      await rivalLands(r, 'base.txt', 'rival edit\n')
      let moved = await command(r.repo, 'rev-parse', 'main')

      let out: string[] = []
      let outcome = await land({ cwd: r.tree, write: (t) => out.push(t) })
      assert('diverged' in outcome && outcome.conflict, JSON.stringify(outcome))
      assertEquals(await command(r.repo, 'rev-parse', 'main'), moved)
      let text = out.join('\n')
      assert(/CONFLICT|conflict/.test(text), text)
      // The rebase is left in progress for whoever ran it to resolve: conflict
      // markers sit in the tree, and `git rebase --continue` is the way out.
      assert(Deno.readTextFileSync(`${r.tree}/base.txt`).includes('<<<<<<<'))
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

slow(
  "a fast-forward refused without the base moving surfaces git's error, never a rebase",
  async () => {
    let r = await setup()
    try {
      // The candidate rewrites base.txt while the checkout has an uncommitted
      // edit to it, so git refuses the fast-forward though main never moved.
      Deno.writeTextFileSync(`${r.tree}/base.txt`, 'rewritten\n')
      await command(r.tree, 'commit', '-am', 'rewrite base')
      Deno.writeTextFileSync(`${r.repo}/base.txt`, 'being edited\n')
      let before = await command(r.repo, 'rev-parse', 'main')
      let out: string[] = []
      await assertRejects(
        () => land({ cwd: r.tree, write: (t) => out.push(t) }),
        Error,
        'git merge failed',
      )
      // The base is untouched, the local edit preserved, and NO rebase
      // happened.
      assertEquals(await command(r.repo, 'rev-parse', 'main'), before)
      assertEquals(
        Deno.readTextFileSync(`${r.repo}/base.txt`),
        'being edited\n',
      )
      assert(!out.join('\n').includes('moved'), out.join('\n'))
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

slow(
  'land refuses to run in the shared checkout, not a linked worktree',
  async () => {
    let r = await setup()
    try {
      await assertRejects(
        () => land({ cwd: r.repo, ...quiet }),
        Error,
        'not the shared checkout',
      )
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

slow(
  'a landing publishes to the base branch upstream when it has one',
  async () => {
    let r = await setup()
    try {
      let bare = await withUpstream(r)
      let outcome = await land({ cwd: r.tree, ...quiet })
      assert('landed' in outcome)
      assertEquals(await command(bare, 'rev-parse', 'main'), outcome.landed)
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

slow('land does not publish when the base has no upstream', async () => {
  let r = await setup()
  try {
    let outcome = await land({ cwd: r.tree, ...quiet })
    assert('landed' in outcome)
    // No remote was ever configured — landing is purely local.
    assertEquals(
      (await result(r.repo, 'remote', 'get-url', 'origin')).success,
      false,
    )
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

slow(
  'a publish refusal lands anyway — publishing is best-effort, never a failed land',
  async () => {
    let r = await setup()
    try {
      await withUpstream(r, false)
      let warned = ''
      let outcome = await land({
        cwd: r.tree,
        write: (text, error) => {
          if (error && text.includes('publish')) warned = text
        },
      })
      assert('landed' in outcome)
      assertEquals(await command(r.repo, 'rev-parse', 'main'), outcome.landed)
      assert(warned.includes('landed locally, publish separately'), warned)
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

// Exercise the real shared seam: a deleted cwd rejects at spawn, but land
// receives a failed run and labels the operation rather than leaking ENOENT.
Deno.test('a spawn-level failure is a failed result, never a crash', async () => {
  let cwd = Deno.makeTempDirSync({ prefix: 'yaks-land-gone-' })
  Deno.removeSync(cwd)
  await assertRejects(
    () => land({ ...quiet, cwd }),
    Error,
    'find worktree failed with exit -1: git rev-parse --show-toplevel in ' +
      cwd,
  )
})

slow('a transiently failing push publishes on the retry', async () => {
  let r = await setup()
  try {
    let bare = await withUpstream(r)
    let pushes = 0
    let real = async (args: string[], cwd: string) => {
      if (args[0] == 'push' && ++pushes == 1) {
        return { ok: false, code: 1, out: '', err: 'transient spawn blip' }
      }
      let out = await new Deno.Command('git', {
        args,
        cwd,
        stdout: 'piped' as const,
        stderr: 'piped' as const,
      }).output()
      return {
        ok: out.success,
        code: out.code,
        out: new TextDecoder().decode(out.stdout),
        err: new TextDecoder().decode(out.stderr),
      }
    }
    let warned = ''
    let outcome = await land({
      cwd: r.tree,
      run: real,
      write: (text, error) => {
        if (error && text.includes('publish')) warned = text
      },
    })
    assert('landed' in outcome)
    assertEquals(pushes, 2)
    assertEquals(warned, '')
    assertEquals(await command(bare, 'rev-parse', 'main'), outcome.landed)
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

// The guard's two questions, asked of a stubbed git so the fast tier can own
// them: what the branch's commits touch, and what the base's history held.
// `reverts` takes its git as an argument for exactly this seam.
let asking = (r: {
  changed: string[]
  touched: string[]
  past: [string, string][]
  head: [string, string][]
}) =>
(args: string[]) => {
  let said = args.join(' ')
  let out = (ls: string[]) => Promise.resolve(ls.map((l) => `${l}\n`).join(''))
  if (said.startsWith('diff --name-only')) return out(r.changed)
  if (said.startsWith('log --format= --name-only')) return out(r.touched)
  if (said.includes('--raw')) {
    let nil = '0'.repeat(40)
    return out(r.past.map(([f, b]) => `:100644 100644 ${nil} ${b} M\t${f}`))
  }
  if (said.startsWith('ls-tree')) {
    return out(r.head.map(([f, b]) => `100644 blob ${b}\t${f}`))
  }
  throw new Error(`the guard asked something unexpected: ${said}`)
}

Deno.test('a clean rebase reverts nothing', async () => {
  let found = await reverts(
    asking({
      changed: ['a.ts'],
      touched: ['a.ts'],
      past: [['a.ts', 'old']],
      head: [['a.ts', 'new']],
    }),
    'main',
  )
  assertEquals(found, [])
})

Deno.test("a file no branch commit touches is the rebase's own doing", async () => {
  let found = await reverts(
    asking({
      changed: ['a.ts', 'merged.ts'],
      touched: ['a.ts'],
      past: [['a.ts', 'old']],
      head: [['a.ts', 'new'], ['merged.ts', 'x']],
    }),
    'main',
  )
  assertEquals(found, [{ file: 'merged.ts', rewound: false }])
})

Deno.test('a blob the base already moved past is a rewind', async () => {
  let found = await reverts(
    asking({
      changed: ['a.ts'],
      touched: ['a.ts'],
      past: [['a.ts', 'one'], ['a.ts', 'two']],
      head: [['a.ts', 'one']],
    }),
    'main',
  )
  assertEquals(found, [{ file: 'a.ts', rewound: true }])
})

// A stale branch conflicts with a base that moved, and the conflict is resolved
// by taking the branch's side wholesale — which puts the file back to its
// pre-base content and undoes the base commit in between. A gate cannot see it
// (the tests rewind with the code); land must.
let stale = async (r: Repo) => {
  Deno.writeTextFileSync(`${r.tree}/base.txt`, 'branch\n')
  Deno.writeTextFileSync(`${r.tree}/mine.txt`, 'mine\n')
  await command(r.tree, 'add', '-A')
  await command(r.tree, 'commit', '-m', 'the branch edits base.txt too')
  await rivalLands(r, 'base.txt', 'rival\n')
  let first = await land({ cwd: r.tree, write: () => {} })
  assertEquals(first, { diverged: true, conflict: true })
  // The resolution that did the damage: the branch's side, wholesale.
  Deno.writeTextFileSync(`${r.tree}/base.txt`, 'base\n')
  await command(r.tree, 'add', 'base.txt')
  await command(r.tree, '-c', 'core.editor=true', 'rebase', '--continue')
}

slow('land refuses a rebase that rewound a file past the base', async () => {
  let r = await setup()
  try {
    await stale(r)
    let e = await assertRejects(() => land({ cwd: r.tree, write: () => {} }))
    let said = (e as Error).message
    assert(said.includes('base.txt'), said)
    assert(said.includes('--allow-revert=base.txt'), said)
    // Refused BEFORE the merge: the base still holds the rival's content.
    assertEquals(await command(r.repo, 'show', 'main:base.txt'), 'rival')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

slow('--allow-revert lands the rewind, with a warning', async () => {
  let r = await setup()
  try {
    await stale(r)
    let warned: string[] = []
    let outcome = await land({
      cwd: r.tree,
      allow: ['base.txt'],
      write: (text, error) => error && warned.push(text),
    })
    assert('landed' in outcome)
    assert(warned.some((w) => w.includes('--allow-revert')), warned.join('|'))
    assertEquals(await command(r.repo, 'show', 'main:base.txt'), 'base')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

slow('a clean rebase still lands', async () => {
  let r = await setup()
  try {
    await rivalLands(r, 'other.txt', 'rival\n')
    let first = await land({ cwd: r.tree, write: () => {} })
    assertEquals(first, { diverged: true, conflict: false })
    let outcome = await land({ cwd: r.tree, write: () => {} })
    assert('landed' in outcome)
    assertEquals(
      await command(r.repo, 'show', 'main:candidate.txt'),
      'candidate',
    )
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

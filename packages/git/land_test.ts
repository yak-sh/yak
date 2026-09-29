// Landing against disposable git repositories, with no graph and no server
// anywhere: land reads every coordinate from git alone. A base that has not
// moved fast-forwards; a base that moved makes land rebase and return without
// merging, so a second land fast-forwards cleanly. No gate runs. No remote is
// needed except the two publish cases, which wire a real bare upstream.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { land, reverts, run } from './land.ts'
import { runs } from './tools.ts'
import { git as command, template } from './testing.ts'
import { CallError } from '@yaks/tools'
import type { Graph } from '@yaks/graph'

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

let at = (root: string): Repo => ({
  root,
  repo: `${root}/repo`,
  tree: `${root}/work`,
})

// A primary checkout on `main` and one locked linked worktree on `work` with a
// commit to land — the shape a worker's checkout arrives in (whoever hands one
// out locks it). land derives `main` as the base and the primary as the shared
// checkout from `git worktree list`, so nothing here is a graph entity: the
// whole test proves land needs no graph, no server and no config.
let base = async (root: string) => {
  let { repo, tree } = at(root)
  Deno.mkdirSync(repo)
  await command(repo, 'init', '--initial-branch=main')
  await command(repo, 'config', 'user.email', 'test@example.com')
  await command(repo, 'config', 'user.name', 'Test')
  Deno.writeTextFileSync(`${repo}/base.txt`, 'base\n')
  await command(repo, 'add', 'base.txt')
  await command(repo, 'commit', '-m', 'base')
  await command(
    repo,
    'worktree',
    'add',
    '--relative-paths',
    '-b',
    'work',
    tree,
    'main',
  )
  await command(repo, 'worktree', 'lock', '--reason', 'someone works', tree)
  Deno.writeTextFileSync(`${tree}/candidate.txt`, 'candidate\n')
  await command(tree, 'add', 'candidate.txt')
  await command(tree, 'commit', '-m', 'candidate')
}

// Each shape a test starts from is built once and copied to each test.
let repo = (build: (r: Repo) => Promise<unknown>) => {
  let made = template((root) => build(at(root)))
  return async () => at(await made())
}

let setup = repo((r) => base(r.root))

// A rival lands on `main` first — exactly what land does from another worktree:
// its own branch, fast-forwarded into the shared checkout. This is how the base
// moves out from under a pending lander.
let rivalLands = async (r: Repo, file: string, body: string) => {
  let rival = `${r.root}/rival`
  await command(
    r.repo,
    'worktree',
    'add',
    '--relative-paths',
    '-b',
    'rival',
    rival,
    'main',
  )
  Deno.writeTextFileSync(`${rival}/${file}`, body)
  await command(rival, 'add', file)
  await command(rival, 'commit', '-m', 'rival')
  await command(r.repo, 'merge', '--ff-only', 'rival')
}

// The candidate waiting while a rival has landed `rival.txt` on `main`.
let moved = repo(async (r) => {
  await base(r.root)
  await rivalLands(r, 'rival.txt', 'rival\n')
})

// main moves on its own, the way it does when anyone else lands: a commit made
// in the shared checkout itself.
let mainCommits = async (r: Repo, file: string, body: string, msg: string) => {
  Deno.writeTextFileSync(`${r.repo}/${file}`, body)
  await command(r.repo, 'add', file)
  await command(r.repo, 'commit', '-m', msg)
}

// A bare remote wired as `main`'s real upstream — a genuine push establishes
// both the tracking config `@{u}` reads and the remote-tracking ref, which a
// config-only stub cannot fake. Its URL is relative to the checkout, so a copy
// pushes to its own.
let tracked = repo(async (r) => {
  await base(r.root)
  await command(r.root, 'init', '--bare', '--initial-branch=main', 'origin.git')
  await command(r.repo, 'remote', 'add', 'origin', '../origin.git')
  await command(r.repo, 'push', '-q', '-u', 'origin', 'main')
})
let origin = (r: Repo) => `${r.root}/origin.git`

let quiet = { write: () => {} }

test(
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

test(
  'the `land` tool answers the sha; a divergence is a refusal',
  async () => {
    let r = await moved()
    try {
      // The tool acts on the checkout its call stands in — the `cwd` of the
      // process that made it, which a command line fills with where the
      // person typed.
      let call = {
        entity: { eid: 'c1' },
        call: { args: {} },
        process: { cwd: r.tree },
      }
      let graph = {} as Graph
      let refused = await assertRejects(
        () => Promise.resolve(runs().land(call, graph)),
        CallError,
      )
      assert(refused.message.includes('moved'), refused.message)
      let [said] = await runs().land(call, graph)
      let landed = await command(r.repo, 'rev-parse', 'main')
      let body = String((said.content as { body?: unknown })?.body ?? '')
      assert(body.includes(`landed ${landed}`), body)
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

test('a dirty worktree is a tool refusal, not an exception', async () => {
  let r = await setup()
  try {
    Deno.writeTextFileSync(`${r.tree}/scratch.txt`, 'not committed\n')
    let call = {
      entity: { eid: 'c1' },
      call: { args: {} },
      process: { cwd: r.tree },
    }
    let refused = await assertRejects(
      () => Promise.resolve(runs().land(call, {} as Graph)),
      CallError,
      'land: worktree is dirty:\n?? scratch.txt',
    )
    assertEquals(refused.code, 'land')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test(
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

test(
  'a moved base makes land rebase and RETURN without merging; a second land fast-forwards',
  async () => {
    let r = await moved()
    try {
      let tip = await command(r.repo, 'rev-parse', 'main')

      let out: string[] = []
      let first = await land({ cwd: r.tree, write: (t) => out.push(t) })
      assert('diverged' in first && !first.conflict, JSON.stringify(first))
      // The base is untouched — land did not merge.
      assertEquals(await command(r.repo, 'rev-parse', 'main'), tip)
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

test(
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

test(
  'local changes the landing would overwrite are a tool refusal, never an exception',
  async () => {
    let r = await setup()
    try {
      // The candidate rewrites base.txt while the checkout has an uncommitted
      // edit to it, so git refuses the fast-forward though main never moved.
      Deno.writeTextFileSync(`${r.tree}/base.txt`, 'rewritten\n')
      await command(r.tree, 'commit', '-am', 'rewrite base')
      Deno.writeTextFileSync(`${r.repo}/base.txt`, 'being edited\n')
      let before = await command(r.repo, 'rev-parse', 'main')
      let call = {
        entity: { eid: 'c1' },
        call: { args: {} },
        process: { cwd: r.tree },
      }
      let refused = await assertRejects(
        () => Promise.resolve(runs().land(call, {} as Graph)),
        CallError,
        'shared checkout blocks landing',
      )
      assertEquals(refused.code, 'land')
      assert(refused.message.includes('base.txt'), refused.message)
      // The base is untouched, the local edit preserved, and no rebase
      // happened.
      assertEquals(await command(r.repo, 'rev-parse', 'main'), before)
      assertEquals(
        Deno.readTextFileSync(`${r.repo}/base.txt`),
        'being edited\n',
      )
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

test('a file the shared checkout only touched is not in the way', async () => {
  let r = await setup()
  try {
    Deno.writeTextFileSync(`${r.tree}/base.txt`, 'rewritten\n')
    await command(r.tree, 'commit', '-am', 'rewrite base')
    Deno.utimeSync(`${r.repo}/base.txt`, 0, 0)
    let outcome = await land({ cwd: r.tree, ...quiet })
    assert('landed' in outcome, JSON.stringify(outcome))
    assertEquals(Deno.readTextFileSync(`${r.repo}/base.txt`), 'rewritten\n')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test(
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

test(
  'a landing publishes to the base branch upstream when it has one',
  async () => {
    let r = await tracked()
    try {
      let outcome = await land({ cwd: r.tree, ...quiet })
      assert('landed' in outcome)
      assertEquals(
        await command(origin(r), 'rev-parse', 'main'),
        outcome.landed,
      )
    } finally {
      Deno.removeSync(r.root, { recursive: true })
    }
  },
)

test('land does not publish when the base has no upstream', async () => {
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

test(
  'a publish refusal lands anyway — publishing is best-effort, never a failed land',
  async () => {
    let r = await tracked()
    try {
      // Tracking survives a broken URL; connecting to it does not.
      await command(r.repo, 'remote', 'set-url', 'origin', '../missing.git')
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
test('a spawn-level failure is a failed result, never a crash', async () => {
  let cwd = Deno.makeTempDirSync({ prefix: 'yaks-land-gone-' })
  Deno.removeSync(cwd)
  await assertRejects(
    () => land({ ...quiet, cwd }),
    Error,
    'find worktree failed with exit -1: git rev-parse --show-toplevel in ' +
      cwd,
  )
})

// Only where the caller stands is a refusal; a git command that fails is a
// fault, and escapes the tool as one for the runner to report.
let answering = (fails: string, code = 128) => (args: string[]) => {
  let ok = { ok: true, code: 0, err: '' }
  let said = args.join(' ')
  if (said.startsWith(fails)) {
    return Promise.resolve({ ok: false, code, out: '', err: 'fatal: broke' })
  }
  if (args[0] == 'rev-parse') return Promise.resolve({ ...ok, out: '/t\n' })
  if (args[0] == 'symbolic-ref') return Promise.resolve({ ...ok, out: 'b\n' })
  return Promise.resolve({ ...ok, out: '' })
}

test('a detached worktree is refused, a failing git is a fault', async () => {
  let at = (fails: string, code?: number) =>
    land({ ...quiet, cwd: '/t', run: answering(fails, code) })
  let e = await assertRejects(() => at('symbolic-ref', 1))
  assertEquals((e as Error).name, 'LandError')
  for (let fails of ['symbolic-ref', 'worktree list']) {
    let e = await assertRejects(() => at(fails))
    assertEquals((e as Error).name, 'Error', fails)
  }
})

test('a transiently failing push publishes on the retry', async () => {
  let r = await tracked()
  try {
    let pushes = 0
    let blip = (args: string[], cwd: string) =>
      args[0] == 'push' && ++pushes == 1
        ? Promise.resolve({
          ok: false,
          code: 1,
          out: '',
          err: 'transient spawn blip',
        })
        : run(args, cwd)
    let warned = ''
    let outcome = await land({
      cwd: r.tree,
      run: blip,
      write: (text, error) => {
        if (error && text.includes('publish')) warned = text
      },
    })
    assert('landed' in outcome)
    assertEquals(pushes, 2)
    assertEquals(warned, '')
    assertEquals(await command(origin(r), 'rev-parse', 'main'), outcome.landed)
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

// The guard's two questions, asked of a stubbed git so the fast tier can own
// them: what the branch's commits touch, and what the base's history held.
// `reverts` takes its git as an argument for exactly this seam. A `changed`
// entry is a path the landing diff adds a line to, or `[path, added]` to say
// how many — `0` being the pure deletion that adds nothing, `-` how git counts
// a binary file.
let asking = (r: {
  changed: (string | [string, number | '-'])[]
  touched: string[]
  past: [string, string][]
  head: [string, string][]
}) =>
(args: string[]) => {
  let said = args.join(' ')
  let out = (ls: string[]) => Promise.resolve(ls.map((l) => `${l}\n`).join(''))
  if (said.startsWith('diff --numstat')) {
    return out(r.changed.map((c) => {
      let [file, added] = typeof c == 'string' ? [c, 1] : c
      return `${added}\t${added == '-' ? '-' : 1}\t${file}`
    }))
  }
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

test('a clean rebase reverts nothing', async () => {
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

test("a file no branch commit touches is the rebase's own doing", async () => {
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

test('a blob the base already moved past is a rewind', async () => {
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

// The same blob, reached by taking lines away: deleting what the base added
// lands the file at what it held before, and adds back nothing.
test('a diff that adds no line is a deletion, not a rewind', async () => {
  let found = await reverts(
    asking({
      changed: [['a.ts', 0]],
      touched: ['a.ts'],
      past: [['a.ts', 'one'], ['a.ts', 'two']],
      head: [['a.ts', 'one']],
    }),
    'main',
  )
  assertEquals(found, [])
})

// A binary file's added lines are unknowable (`-`), so the guard keeps reading
// it as content added: a rewind refused is recoverable, a rewind landed is not.
test(
  'a binary file that lands at an old blob is still a rewind',
  async () => {
    let found = await reverts(
      asking({
        changed: [['a.png', '-']],
        touched: ['a.png'],
        past: [['a.png', 'one'], ['a.png', 'two']],
        head: [['a.png', 'one']],
      }),
      'main',
    )
    assertEquals(found, [{ file: 'a.png', rewound: true }])
  },
)

// A stale branch conflicts with a base that moved, and the conflict is resolved
// by taking the branch's side wholesale — which puts the file back to its
// pre-base content and undoes the base commit in between. A gate cannot see it
// (the tests rewind with the code); land must.
let stale = repo(async (r) => {
  await base(r.root)
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
})

// A move deletes the old path in the landing diff; the branch's own log must
// say so too, not only name the new path, or every rename reads as the rebase's.
test('a file the branch moves is the branch', async () => {
  let r = await setup()
  try {
    await command(r.tree, 'mv', 'base.txt', 'moved.txt')
    await command(r.tree, 'commit', '-m', 'move')
    let found = await reverts((args) => command(r.tree, ...args), 'main')
    assertEquals(found, [])
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('land refuses a rebase that rewound a file past the base', async () => {
  let r = await stale()
  try {
    let e = await assertRejects(() => land({ cwd: r.tree, write: () => {} }))
    let said = (e as Error).message
    assert(said.includes('base.txt'), said)
    assert(said.includes('--allow-revert=base.txt'), said)
    // Refused before the merge: the base still holds the rival's content.
    assertEquals(await command(r.repo, 'show', 'main:base.txt'), 'rival')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('--allow-revert lands the rewind, with a warning', async () => {
  let r = await stale()
  try {
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

test('a clean rebase still lands', async () => {
  let r = await moved()
  try {
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

// main grew a gadget after this branch forked, and the branch deletes it. The
// file lands at the content it held before the gadget — a blob the base moved
// past — but the branch's diff adds not one line, and a hunk that only takes
// lines away reintroduces nothing. Deleting is the whole point of some
// branches; the guard must not read one as a revert.
test('a pure deletion of content main added still lands', async () => {
  let r = await setup()
  try {
    await mainCommits(r, 'tools.txt', 'core\n', 'the tools')
    await mainCommits(r, 'tools.txt', 'core\ngadget\n', 'add the gadget')
    assertEquals(await land({ cwd: r.tree, ...quiet }), {
      diverged: true,
      conflict: false,
    })
    Deno.writeTextFileSync(`${r.tree}/tools.txt`, 'core\n')
    await command(r.tree, 'commit', '-am', 'delete the gadget')
    let outcome = await land({ cwd: r.tree, ...quiet })
    assert('landed' in outcome, JSON.stringify(outcome))
    assertEquals(await command(r.repo, 'show', 'main:tools.txt'), 'core')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

// The other side of that coin: main removed a line after the branch forked,
// and a stale rebase's resolution puts it back. Those are added lines matching
// content the base deleted — the revert the guard exists for.
test('a rebase that re-adds a line main removed is still refused', async () => {
  let r = await setup()
  try {
    await mainCommits(r, 'list.txt', 'keep\ndrop\n', 'the list')
    assertEquals(await land({ cwd: r.tree, ...quiet }), {
      diverged: true,
      conflict: false,
    })
    // Both sides rewrite the same line, so the rebase cannot replay cleanly.
    Deno.writeTextFileSync(`${r.tree}/list.txt`, 'keep\ndrop edited\n')
    await command(r.tree, 'commit', '-am', 'the branch edits the list too')
    await mainCommits(r, 'list.txt', 'keep\n', 'drop the line')
    assertEquals(await land({ cwd: r.tree, write: () => {} }), {
      diverged: true,
      conflict: true,
    })
    // The resolution that does the damage: the branch's side, wholesale.
    Deno.writeTextFileSync(`${r.tree}/list.txt`, 'keep\ndrop\n')
    await command(r.tree, 'add', 'list.txt')
    await command(r.tree, '-c', 'core.editor=true', 'rebase', '--continue')
    let e = await assertRejects(() => land({ cwd: r.tree, write: () => {} }))
    let said = (e as Error).message
    assert(said.includes('list.txt'), said)
    assertEquals(await command(r.repo, 'show', 'main:list.txt'), 'keep')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

// Landing checks only the caller's disposable checkout. The acceptance callback
// records the proposed HEAD instead of merging it into another checkout.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { land, type LandOps, reverts, run } from './land.ts'
import { git as command, template } from './testing.ts'

let result = async (cwd: string, ...args: string[]) =>
  await new Deno.Command('git', { args, cwd, stdout: 'null', stderr: 'null' })
    .output()
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

// A locked linked checkout and an independent checkout sharing its objects.
// The latter supplies fixture commits, but landing has no permission to touch it.
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
let repo = (build: (r: Repo) => Promise<unknown>) => {
  let made = template((root) => build(at(root)))
  return async () => at(await made())
}
let setup = repo((r) => base(r.root))
let mainCommits = async (r: Repo, file: string, body: string, msg: string) => {
  Deno.writeTextFileSync(`${r.repo}/${file}`, body)
  await command(r.repo, 'add', file)
  await command(r.repo, 'commit', '-m', msg)
}
let rivalLands = async (r: Repo, file: string, body: string) => {
  await mainCommits(r, file, body, 'rival')
}
let moved = repo(async (r) => {
  await base(r.root)
  await rivalLands(r, 'rival.txt', 'rival\n')
})
let quiet = { write: () => {} }
let landing = (
  r: Repo,
  accepted: string[] = [],
  extra: Partial<LandOps> = {},
): LandOps => ({
  cwd: r.tree,
  run,
  base: 'main',
  accept: (head) => {
    accepted.push(head)
    return Promise.resolve()
  },
  ...quiet,
  ...extra,
})

test('land accepts HEAD and returns the caller cwd without changing another checkout', async () => {
  let r = await setup()
  try {
    let accepted: string[] = []
    let tip = await command(r.repo, 'rev-parse', 'main')
    let head = await command(r.tree, 'rev-parse', 'HEAD')
    // Both staged edits and untracked dirt in another checkout are irrelevant.
    Deno.writeTextFileSync(`${r.repo}/base.txt`, 'being edited\n')
    await command(r.repo, 'add', 'base.txt')
    Deno.writeTextFileSync(`${r.repo}/scratch.txt`, 'mine\n')
    let index = await command(r.repo, 'write-tree')
    let calls: string[][] = []
    let outcome = await land(landing(r, accepted, {
      run: async (args, cwd) => {
        assertEquals(cwd, r.tree)
        calls.push(args)
        return await run(args, cwd)
      },
    }))
    assertEquals(outcome, { landed: head, root: r.tree })
    assertEquals(accepted, [head])
    assertEquals(await command(r.repo, 'rev-parse', 'main'), tip)
    assertEquals(await command(r.repo, 'write-tree'), index)
    assertEquals(Deno.readTextFileSync(`${r.repo}/base.txt`), 'being edited\n')
    assertEquals(Deno.readTextFileSync(`${r.repo}/scratch.txt`), 'mine\n')
    assertEquals(exists(`${r.repo}/candidate.txt`), false)
    // A successful landing neither publishes nor changes worktree ownership.
    assert(
      !calls.some(([op]) =>
        ['merge', 'read-tree', 'worktree', 'push'].includes(op)
      ),
    )
    assertEquals(
      (await result(r.repo, 'worktree', 'remove', r.tree)).success,
      false,
    )
    assert(exists(r.tree))
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('landing waits for async acceptance before reporting success', async () => {
  let r = await setup()
  try {
    let release!: () => void
    let ready!: () => void
    let entered = new Promise<void>((resolve) => {
      ready = resolve
    })
    let acceptance = new Promise<void>((resolve) => {
      release = resolve
    })
    let reported = false
    let pending = land(landing(r, [], {
      accept: async () => {
        ready()
        await acceptance
      },
    })).then((outcome) => {
      reported = true
      return outcome
    })
    await entered
    await Promise.resolve()
    assertEquals(reported, false)
    release()
    assert('landed' in await pending)
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('a standalone checkout can land against a fetched revision SHA', async () => {
  let r = await setup()
  try {
    let standalone = `${r.root}/standalone`
    await command(r.root, 'clone', '--no-hardlinks', r.repo, standalone)
    await command(standalone, 'checkout', '-b', 'candidate', 'origin/work')
    let accepted: string[] = []
    let base = await command(standalone, 'rev-parse', 'main')
    let head = await command(standalone, 'rev-parse', 'HEAD')
    assertEquals(await land(landing(r, accepted, { cwd: standalone, base })), {
      landed: head,
      root: standalone,
    })
    assertEquals(accepted, [head])
    assertEquals(await command(standalone, 'rev-parse', 'main'), base)
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('a moved base rebases and stops; a second invocation accepts the rebased HEAD', async () => {
  let r = await moved()
  try {
    let tip = await command(r.repo, 'rev-parse', 'main')
    let accepted: string[] = []
    let out: string[] = []
    assertEquals(
      await land(landing(r, accepted, { write: (t) => out.push(t) })),
      {
        diverged: true,
        conflict: false,
      },
    )
    assertEquals(accepted, [])
    assertEquals(await command(r.repo, 'rev-parse', 'main'), tip)
    assert(out.join('\n').includes('rival.txt'))
    assert(
      (await result(r.tree, 'merge-base', '--is-ancestor', 'main', 'HEAD'))
        .success,
    )
    let head = await command(r.tree, 'rev-parse', 'HEAD')
    assertEquals(await land(landing(r, accepted)), {
      landed: head,
      root: r.tree,
    })
    assertEquals(accepted, [head])
    assertEquals(await command(r.repo, 'rev-parse', 'main'), tip)
    assertEquals(exists(`${r.repo}/candidate.txt`), false)
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('an acceptance race refreshes the base, rebases, and stops without retrying acceptance', async () => {
  let r = await setup()
  try {
    let attempts: string[] = []
    let accepted: string[] = []
    let tip = ''
    let base = await command(r.tree, 'rev-parse', 'main')
    let first = await land(landing(r, [], {
      base,
      accept: async (head) => {
        attempts.push(head)
        await rivalLands(r, 'rival.txt', 'rival\n')
        tip = await command(r.tree, 'rev-parse', 'main')
        throw new Error('acceptance lost compare-and-set')
      },
      refresh: () => Promise.resolve(tip),
    }))
    assertEquals(first, { diverged: true, conflict: false })
    assertEquals(attempts.length, 1)
    assertEquals(await command(r.repo, 'rev-parse', 'main'), tip)
    assertEquals(Deno.readTextFileSync(`${r.tree}/rival.txt`), 'rival\n')
    assertEquals(exists(`${r.repo}/candidate.txt`), false)
    let head = await command(r.tree, 'rev-parse', 'HEAD')
    assertEquals(await land(landing(r, accepted, { base: tip })), {
      landed: head,
      root: r.tree,
    })
    assertEquals(accepted, [head])
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('an acceptance failure with no changed base remains a fault', async () => {
  let r = await setup()
  try {
    let head = await command(r.tree, 'rev-parse', 'HEAD')
    for (let extra of [{}, { refresh: () => Promise.resolve('main') }]) {
      let fault = new Error('receiver unavailable')
      let error = await assertRejects(() =>
        land(landing(r, [], {
          accept: () => Promise.reject(fault),
          ...extra,
        }))
      )
      assertEquals(error, fault)
      assertEquals(await command(r.tree, 'rev-parse', 'HEAD'), head)
    }
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('a conflicting rebase stays unresolved and never calls acceptance', async () => {
  let r = await setup()
  try {
    Deno.writeTextFileSync(`${r.tree}/base.txt`, 'candidate edit\n')
    await command(r.tree, 'commit', '-am', 'edit base on branch')
    await rivalLands(r, 'base.txt', 'rival edit\n')
    let tip = await command(r.repo, 'rev-parse', 'main')
    let accepted: string[] = []
    let out: string[] = []
    assertEquals(
      await land(landing(r, accepted, { write: (t) => out.push(t) })),
      {
        diverged: true,
        conflict: true,
      },
    )
    assertEquals(accepted, [])
    assertEquals(await command(r.repo, 'rev-parse', 'main'), tip)
    assert(/CONFLICT|conflict/.test(out.join('\n')))
    assert(Deno.readTextFileSync(`${r.tree}/base.txt`).includes('<<<<<<<'))
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('dirty, detached, and base-branch checkouts refuse before acceptance', async () => {
  let r = await setup()
  try {
    let accepted: string[] = []
    Deno.writeTextFileSync(`${r.tree}/scratch.txt`, 'not committed\n')
    let dirty = await assertRejects(
      () => land(landing(r, accepted)),
      Error,
      'dirty',
    )
    assertEquals(dirty.name, 'LandError')
    Deno.removeSync(`${r.tree}/scratch.txt`)
    await command(r.tree, 'checkout', '--detach')
    let detached = await assertRejects(
      () => land(landing(r, accepted)),
      Error,
      'detached',
    )
    assertEquals(detached.name, 'LandError')
    for (let base of ['main', 'refs/heads/main']) {
      let onBase = await assertRejects(
        () => land(landing(r, accepted, { cwd: r.repo, base })),
        Error,
        'base branch',
      )
      assertEquals(onBase.name, 'LandError')
    }
    assertEquals(accepted, [])
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

test('a spawn-level failure is labeled as a git fault', async () => {
  let cwd = Deno.makeTempDirSync({ prefix: 'yaks-land-gone-' })
  Deno.removeSync(cwd)
  await assertRejects(
    () => land({ ...quiet, cwd, run, base: 'main', accept: async () => {} }),
    Error,
    'failed with exit -1',
  )
})

test('failed branch and ancestry reads remain faults, not detached refusals', async () => {
  let r = await setup()
  try {
    for (let fails of ['symbolic-ref', 'merge-base']) {
      let accepted: string[] = []
      let broken = (args: string[], cwd: string) =>
        args[0] == fails
          ? Promise.resolve({
            ok: false,
            code: 128,
            out: '',
            err: 'fatal: broke',
          })
          : run(args, cwd)
      let error = await assertRejects(
        () => land(landing(r, accepted, { run: broken })),
        Error,
        'fatal: broke',
      )
      assertEquals(error.name, 'Error')
      assertEquals(accepted, [])
    }
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
  let first = await land(landing(r))
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
    let e = await assertRejects(() => land(landing(r)))
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
    let accepted: string[] = []
    let outcome = await land(landing(r, accepted, {
      allow: ['base.txt'],
      write: (text, error) => {
        if (error) warned.push(text)
      },
    }))
    assert('landed' in outcome)
    assert(warned.some((w) => w.includes('--allow-revert')), warned.join('|'))
    assertEquals(accepted, [outcome.landed])
    assertEquals(
      await command(r.tree, 'show', `${outcome.landed}:base.txt`),
      'base',
    )
    assertEquals(await command(r.repo, 'show', 'main:base.txt'), 'rival')
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
    assertEquals(await land(landing(r)), {
      diverged: true,
      conflict: false,
    })
    Deno.writeTextFileSync(`${r.tree}/tools.txt`, 'core\n')
    await command(r.tree, 'commit', '-am', 'delete the gadget')
    let outcome = await land(landing(r))
    assert('landed' in outcome, JSON.stringify(outcome))
    assertEquals(
      await command(r.tree, 'show', `${outcome.landed}:tools.txt`),
      'core',
    )
    assertEquals(
      await command(r.repo, 'show', 'main:tools.txt'),
      'core\ngadget',
    )
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
    assertEquals(await land(landing(r)), {
      diverged: true,
      conflict: false,
    })
    // Both sides rewrite the same line, so the rebase cannot replay cleanly.
    Deno.writeTextFileSync(`${r.tree}/list.txt`, 'keep\ndrop edited\n')
    await command(r.tree, 'commit', '-am', 'the branch edits the list too')
    await mainCommits(r, 'list.txt', 'keep\n', 'drop the line')
    assertEquals(await land(landing(r)), {
      diverged: true,
      conflict: true,
    })
    // The resolution that does the damage: the branch's side, wholesale.
    Deno.writeTextFileSync(`${r.tree}/list.txt`, 'keep\ndrop\n')
    await command(r.tree, 'add', 'list.txt')
    await command(r.tree, '-c', 'core.editor=true', 'rebase', '--continue')
    let e = await assertRejects(() => land(landing(r)))
    let said = (e as Error).message
    assert(said.includes('list.txt'), said)
    assertEquals(await command(r.repo, 'show', 'main:list.txt'), 'keep')
  } finally {
    Deno.removeSync(r.root, { recursive: true })
  }
})

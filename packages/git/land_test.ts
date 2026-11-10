// Landing's decisions through its Git boundary, without a process or repository.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { land, LandError, type Ran, reverts, type Run } from './land.ts'

type Answer = Partial<Ran>
// A command answered with a list answers each run with the next, the last
// for good.
let fixture = (answers: Record<string, Answer | Answer[]> = {}) => {
  let calls: { args: string[]; cwd: string }[] = []
  let said: string[] = []
  let formats: { files: string[]; cwd: string }[] = []
  let locks: string[] = []
  let reports: { error: string; tags?: Record<string, string> }[] = []
  let waits: number[] = []
  let moved = false
  let values: Record<string, Answer | Answer[]> = {
    'rev-parse --show-toplevel': { out: '/work' },
    'symbolic-ref -q --short HEAD': { out: 'work' },
    'worktree list --porcelain': {
      out:
        'worktree /repo\nbranch refs/heads/main\n\nworktree /work\nbranch refs/heads/work\n',
    },
    'rev-parse --path-format=absolute --git-common-dir': { out: '/repo/.git' },
    'rev-parse HEAD': { out: 'sha' },
    'rev-parse --abbrev-ref main@{u}': { out: 'origin/main' },
    ...answers,
  }
  let run: Run = (args, cwd) => {
    calls.push({ args, cwd })
    let given = values[args.join(' ')] ?? {}
    let value = Array.isArray(given)
      ? given.length > 1 ? given.shift()! : given[0]
      : given
    if (args[0] == 'merge' && value.code) moved = true
    if (args[0] == 'merge-base' && moved && values.raced) value = { code: 1 }
    let code = value.code ?? 0
    return Promise.resolve({ out: '', err: '', ...value, code, ok: code == 0 })
  }
  let ran = (answer: Answer): Promise<Ran> => {
    let code = answer.code ?? 0
    return Promise.resolve({ out: '', err: '', ...answer, code, ok: code == 0 })
  }
  let invoke = (
    allow?: string[],
    formatted: Answer = {},
    locked: Answer = {},
  ) =>
    land({
      cwd: '/work',
      run,
      format: (files, cwd) => {
        formats.push({ files, cwd })
        return ran(formatted)
      },
      lock: (cwd) => {
        locks.push(cwd)
        return ran(locked)
      },
      allow,
      // The lock shows in the calls, where it falls among the git commands.
      hold: (gitdir) => {
        calls.push({ args: ['hold'], cwd: gitdir })
        return Promise.resolve(() => {
          calls.push({ args: ['release'], cwd: gitdir })
        })
      },
      write: (text) => said.push(text),
      report: (error, context) =>
        reports.push({ error: String(error), tags: context?.tags }),
      clock: {
        now: () => 0,
        after: (ms, callback) => (waits.push(ms), callback(), () => {}),
      },
    })
  return {
    invoke,
    calls,
    formats,
    locks,
    said,
    reports,
    waits,
    commands: () => calls.map((c) => c.args.join(' ')),
  }
}

test('land publishes the branch and fast-forwards the base while preserving its worktree', async () => {
  let f = fixture()
  assertEquals(await f.invoke(), { landed: 'sha', root: '/repo', commits: [] })
  assert(
    f.calls.some((c) =>
      c.cwd == '/repo' && c.args.join(' ') == 'merge --ff-only work'
    ),
  )
  assert(f.commands().includes('worktree unlock /work'))
  assert(f.commands().includes('push --quiet origin work:main'))
  assert(!f.calls.some((c) => c.args.includes('remove')))
})

test('land writes the shared checkout only while it holds its lock', async () => {
  let f = fixture()
  await f.invoke()
  let at = f.commands()
  let held = at.slice(at.indexOf('hold'), at.indexOf('release') + 1)
  assertEquals(held, [
    'hold',
    'update-index -q --refresh',
    'read-tree -n -m -u HEAD work',
    'log --format=%H%x00%B%x01 HEAD..work',
    'merge-base --is-ancestor main work',
    'push --quiet origin work:main',
    'merge --ff-only work',
    'rev-parse HEAD',
    'release',
  ])
  assertEquals(f.calls.find((c) => c.args[0] == 'hold')?.cwd, '/repo/.git')
})

test('land releases the lock when the shared checkout refuses it', async () => {
  let f = fixture({ 'read-tree -n -m -u HEAD work': { code: 1 } })
  await assertRejects(() => f.invoke(), LandError)
  assertEquals(f.commands().filter((c) => c == 'release').length, 1)
})

for (
  let [name, answers, message] of [
    ['outside Git', {
      'rev-parse --show-toplevel': { code: -1, err: 'spawn failed' },
    }, 'find worktree'],
    [
      'a detached worktree',
      { 'symbolic-ref -q --short HEAD': { code: 1 } },
      'worktree is detached',
    ],
    [
      'the shared checkout',
      { 'rev-parse --show-toplevel': { out: '/repo' } },
      'not the shared checkout',
    ],
    ['a detached base', {
      'worktree list --porcelain': { out: 'worktree /repo\n' },
    }, 'shared checkout is detached'],
    ['a branch on the base', {
      'symbolic-ref -q --short HEAD': { out: 'main' },
    }, 'base branch'],
    ['uncommitted work', {
      'status --porcelain=v1 --untracked-files=all': { out: '?? scratch.txt' },
    }, 'worktree is dirty'],
    ['overlapping shared edits', {
      'read-tree -n -m -u HEAD work': {
        code: 128,
        err: 'base.txt has local edits',
      },
    }, 'shared checkout blocks landing'],
  ] as [string, Record<string, Answer>, string][]
) {
  test(`land refuses ${name} before merging`, async () => {
    let f = fixture(answers)
    await assertRejects(f.invoke, LandError, message)
    assert(!f.calls.some((c) => c.args[0] == 'merge'))
  })
}

for (
  let command of [
    'symbolic-ref -q --short HEAD',
    'worktree list --porcelain',
    'merge-base --is-ancestor main work',
    'merge --ff-only work',
  ]
) {
  test(`an unexpected ${command.split(' ')[0]} failure is a fault`, async () => {
    let f = fixture({ [command]: { code: 128, err: 'fatal: broke' } })
    let error = await assertRejects(f.invoke, Error, 'failed with exit 128')
    assertEquals(error.name, 'Error')
  })
}

for (let conflict of [false, true]) {
  test(`a moved base rebases and returns${conflict ? ' its conflict' : ''} without merging`, async () => {
    let f = fixture({
      'merge-base --is-ancestor main work': { code: 1 },
      'diff --stat work...main': { out: ' rival.txt | 1 +\n' },
      'rebase main': {
        code: conflict ? 1 : 0,
        err: conflict ? 'CONFLICT in rival.txt' : '',
      },
    })
    assertEquals(await f.invoke(), { diverged: true, conflict })
    assert(f.said.join('\n').includes(' rival.txt | 1 +'))
    if (conflict) assert(f.said.join('\n').includes('CONFLICT in rival.txt'))
    assert(!f.calls.some((c) => ['merge', 'push'].includes(c.args[0])))
  })
}

test('a rival landing after the ancestry read causes a rebase', async () => {
  let f = fixture({ 'merge --ff-only work': { code: 1 }, raced: {} })
  assertEquals(await f.invoke(), { diverged: true, conflict: false })
  assert(f.commands().includes('rebase main'))
})

test('a touched but unchanged shared file can land after the safety read', async () => {
  let f = fixture({ 'update-index -q --refresh': { code: 1 } })
  assertEquals(await f.invoke(), { landed: 'sha', root: '/repo', commits: [] })
})

test('a base without an upstream lands without a push', async () => {
  let f = fixture({ 'rev-parse --abbrev-ref main@{u}': { code: 1 } })
  assertEquals(await f.invoke(), { landed: 'sha', root: '/repo', commits: [] })
  assert(!f.calls.some((c) => c.args[0] == 'push'))
})

let refused = 'remote: fatal error in commit_refs\nerror: failed to push'
let refusal = (answers: Record<string, Answer | Answer[]> = {}) =>
  fixture({
    'push --quiet origin work:main': { code: 1, err: refused },
    'rev-parse --verify FETCH_HEAD^{commit}': { out: 'up\n' },
    ...answers,
  })

for (
  let [why, answers] of [
    ['an unreachable remote', { 'fetch --quiet origin main': { code: 128 } }],
    ['a remote that refuses for its own reasons', {}],
  ] as [string, Record<string, Answer>][]
) {
  test(`a push refused by ${why} lands locally and reports it once`, async () => {
    let f = refusal(answers)
    assertEquals(await f.invoke(), {
      landed: 'sha',
      root: '/repo',
      commits: [],
    })
    assertEquals(f.calls.filter((c) => c.args[0] == 'push').length, 1)
    assert(f.said.join('\n').includes('landed locally, publish separately'))
    assertEquals(f.reports, [{
      error:
        `Error: land: publish to origin/main failed with exit 1:\n${refused}`,
      tags: { step: 'land: publish', remote: 'origin' },
    }])
  })
}

test('a push the remote declines lands nothing and refuses the caller with its words', async () => {
  let declined = 'remote: - Push cannot contain secrets\n' +
    ' ! [remote rejected] work -> main (push declined due to repository rule violations)'
  let f = refusal({
    'push --quiet origin work:main': { code: 1, err: declined },
  })
  await assertRejects(f.invoke, LandError, 'Push cannot contain secrets')
  assertEquals(pushes(f), 1)
  assert(!f.calls.some((c) => c.args[0] == 'merge'))
  assertEquals(f.commands().filter((c) => c == 'release').length, 1)
  assertEquals(f.reports, [])
})

test('a push refused because the upstream moved brings the base up to it and rebases', async () => {
  let f = refusal({ 'merge-base --is-ancestor up work': { code: 1 } })
  assertEquals(await f.invoke(), { diverged: true, conflict: false })
  let at = f.commands()
  assert(at.indexOf('merge --ff-only up') < at.indexOf('release'))
  assert(at.indexOf('rebase main') > at.indexOf('release'))
  assert(!at.includes('merge --ff-only work'))
  assertEquals(f.reports, [])
})

test('a base the moved upstream does not contain is a fault, not a rewrite', async () => {
  let f = refusal({
    'merge-base --is-ancestor up work': { code: 1 },
    'merge-base --is-ancestor main up': { code: 1 },
  })
  let error = await assertRejects(f.invoke, Error, 'have diverged')
  assertEquals(error.name, 'Error')
  assert(!f.calls.some((c) => ['merge', 'rebase'].includes(c.args[0])))
  assertEquals(f.commands().filter((c) => c == 'release').length, 1)
})

let failed = 'remote: Internal Server Error\n' +
  ' ! [remote rejected] work -> main (Internal Server Error)'
let pushes = (f: ReturnType<typeof fixture>) =>
  f.calls.filter((c) => c.args[0] == 'push').length

for (
  let said of [
    failed,
    'error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502',
    'fatal: the remote end hung up unexpectedly',
  ]
) {
  test(`a push answered "${said.split('\n')[0]}" is tried again and lands`, async () => {
    let f = fixture({
      'push --quiet origin work:main': [{ code: 1, err: said }, {}],
    })
    assertEquals(await f.invoke(), {
      landed: 'sha',
      root: '/repo',
      commits: [],
    })
    assertEquals(pushes(f), 2)
    assertEquals(f.waits, [1000])
    assertEquals(f.reports, [])
  })
}

test('a push the remote keeps failing is tried four times, then reported once', async () => {
  let f = refusal({ 'push --quiet origin work:main': { code: 1, err: failed } })
  assertEquals(await f.invoke(), { landed: 'sha', root: '/repo', commits: [] })
  assertEquals(pushes(f), 4)
  assertEquals(f.waits, [1000, 2000, 4000])
  assertEquals(f.reports.map((r) => r.error), [
    `Error: land: publish to origin/main failed with exit 1:\n${failed}`,
  ])
})

test('a retried push that finds the upstream moved rebases onto it, reporting nothing', async () => {
  let f = refusal({
    'push --quiet origin work:main': [{ code: 1, err: failed }, {
      code: 1,
      err: ' ! [rejected] work -> main (fetch first)',
    }],
    'merge-base --is-ancestor up work': { code: 1 },
  })
  assertEquals(await f.invoke(), { diverged: true, conflict: false })
  assertEquals(pushes(f), 2)
  assertEquals(f.reports, [])
})

test('a push that goes through reports nothing', async () => {
  let f = fixture()
  await f.invoke()
  assertEquals(f.reports, [])
})

let rewound = {
  'diff --numstat --no-renames main...HEAD': { out: '1\t1\tbase.txt\n' },
  'log --format= --name-only --no-renames main..HEAD': { out: 'base.txt\n' },
  'log -200 --format= --raw --no-abbrev --no-renames main': {
    out: ':100644 100644 before old M\tbase.txt\n',
  },
  'ls-tree -r HEAD': { out: '100644 blob old\tbase.txt\n' },
}

test('a rewound rebase is refused before merging', async () => {
  let f = fixture(rewound)
  await assertRejects(f.invoke, LandError, '--allow-revert=base.txt')
  assert(!f.calls.some((c) => c.args[0] == 'merge'))
})

test('an allowed rewind lands with its warning', async () => {
  let f = fixture(rewound)
  assertEquals(await f.invoke(['base.txt']), {
    landed: 'sha',
    root: '/repo',
    commits: [],
  })
  assert(f.said.join('\n').includes('--allow-revert'))
})

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

let formatting = {
  'diff --raw -z --no-renames --diff-filter=ACDMT main...HEAD': {
    out: [
      ':100644 100644 old new M',
      'apps/icon.svg',
      ':000000 100644 zero new A',
      'page with spaces.html',
      ':000000 100755 zero new A',
      '-script.ts',
      ':000000 100644 zero new A',
      'image.png',
      ':120000 100644 old new T',
      'was-link.ts',
      ':100644 000000 old zero D',
      'gone.ts',
      ':000000 120000 zero new A',
      'link.ts',
      ':160000 160000 old new M',
      'module',
      '',
    ].join('\0'),
  },
}
let files = [
  'apps/icon.svg',
  'page with spaces.html',
  '-script.ts',
  'image.png',
  'was-link.ts',
]

test('landing formats only changed regular files and amends before merging', async () => {
  let f = fixture({
    ...formatting,
    [`--literal-pathspecs diff --quiet -- ${files.join(' ')}`]: { code: 1 },
  })
  await f.invoke()
  assertEquals(f.formats, [{ files: files.map((p) => `./${p}`), cwd: '/work' }])
  let commands = f.commands()
  let add = commands.indexOf(`--literal-pathspecs add -- ${files.join(' ')}`)
  let amend = commands.indexOf('commit --amend --no-edit --allow-empty')
  assert(add >= 0 && add < amend)
  assert(amend < commands.indexOf('merge --ff-only work'))
})

test('formatted files land without rewriting the commit', async () => {
  let f = fixture(formatting)
  await f.invoke()
  assertEquals(f.formats.length, 1)
  assert(!f.commands().some((c) => c.startsWith('commit ')))
})

test('a landing without changed regular files never starts the formatter', async () => {
  let f = fixture()
  await f.invoke()
  assertEquals(f.formats, [])
})

test('a formatter error reports its reason and still lands its partial edits', async () => {
  let f = fixture({
    ...formatting,
    [`--literal-pathspecs diff --quiet -- ${files.join(' ')}`]: { code: 1 },
  })
  assertEquals(await f.invoke(undefined, { code: 1, err: 'syntax error' }), {
    landed: 'sha',
    root: '/repo',
    commits: [],
  })
  assert(f.commands().includes('commit --amend --no-edit --allow-empty'))
  assert(f.said.join('\n').includes('syntax error'))
})

let manifests = (tracked = 'pnpm-lock.yaml\n') => ({
  'diff --raw -z --no-renames --diff-filter=ACDMT main...HEAD': {
    out: ':100644 100644 old new M\0packages/a/package.json\0',
  },
  'ls-files -- pnpm-lock.yaml': { out: tracked },
  '--literal-pathspecs diff --quiet -- packages/a/package.json pnpm-lock.yaml':
    { code: 1 },
})

test('a changed package.json lands with the lockfile pnpm resolves from it', async () => {
  let f = fixture(manifests())
  await f.invoke()
  assertEquals(f.locks, ['/work'])
  let commands = f.commands()
  let add = commands.indexOf(
    '--literal-pathspecs add -- packages/a/package.json pnpm-lock.yaml',
  )
  let amend = commands.indexOf('commit --amend --no-edit --allow-empty')
  assert(add >= 0 && add < amend)
  assert(amend < commands.indexOf('merge --ff-only work'))
})

test('a landing that changes no manifest never starts pnpm', async () => {
  let f = fixture(formatting)
  await f.invoke()
  assertEquals(f.locks, [])
})

test('a checkout without a tracked lockfile never starts pnpm', async () => {
  let f = fixture(manifests(''))
  await f.invoke()
  assertEquals(f.locks, [])
})

test('a pnpm failure is reported and the landing goes on', async () => {
  let f = fixture(manifests())
  assertEquals(
    await f.invoke(undefined, {}, { code: 1, err: 'ERR_PNPM_FETCH_404' }),
    { landed: 'sha', root: '/repo', commits: [] },
  )
  assertEquals(f.reports.map((r) => r.tags), [{ step: 'land: lock' }])
  assert(f.said.join('\n').includes('ERR_PNPM_FETCH_404'))
})

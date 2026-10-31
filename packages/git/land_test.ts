// Landing's decisions through its Git boundary, without a process or repository.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { land, LandError, type Ran, reverts, type Run } from './land.ts'

type Answer = Partial<Ran>
let fixture = (answers: Record<string, Answer> = {}) => {
  let calls: { args: string[]; cwd: string }[] = []
  let said: string[] = []
  let formats: { files: string[]; cwd: string }[] = []
  let moved = false
  let values: Record<string, Answer> = {
    'rev-parse --show-toplevel': { out: '/work' },
    'symbolic-ref -q --short HEAD': { out: 'work' },
    'worktree list --porcelain': {
      out:
        'worktree /repo\nbranch refs/heads/main\n\nworktree /work\nbranch refs/heads/work\n',
    },
    'rev-parse HEAD': { out: 'sha' },
    'rev-parse --abbrev-ref main@{u}': { out: 'origin/main' },
    ...answers,
  }
  let run: Run = (args, cwd) => {
    calls.push({ args, cwd })
    let value = values[args.join(' ')] ?? {}
    if (args[0] == 'merge' && value.code) moved = true
    if (args[0] == 'merge-base' && moved && values.raced) value = { code: 1 }
    let code = value.code ?? 0
    return Promise.resolve({ out: '', err: '', ...value, code, ok: code == 0 })
  }
  let invoke = (allow?: string[], formatted: Answer = {}) =>
    land({
      cwd: '/work',
      run,
      format: (files, cwd) => {
        formats.push({ files, cwd })
        let code = formatted.code ?? 0
        return Promise.resolve({
          out: '',
          err: '',
          ...formatted,
          code,
          ok: code == 0,
        })
      },
      allow,
      write: (text) => said.push(text),
    })
  return {
    invoke,
    calls,
    formats,
    said,
    commands: () => calls.map((c) => c.args.join(' ')),
  }
}

test('land fast-forwards and publishes the base while preserving its worktree', async () => {
  let f = fixture()
  assertEquals(await f.invoke(), { landed: 'sha', root: '/repo' })
  assert(
    f.calls.some((c) =>
      c.cwd == '/repo' && c.args.join(' ') == 'merge --ff-only work'
    ),
  )
  assert(f.commands().includes('worktree unlock /work'))
  assert(f.commands().includes('push --quiet origin main:main'))
  assert(!f.calls.some((c) => c.args.includes('remove')))
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
  assertEquals(await f.invoke(), { landed: 'sha', root: '/repo' })
})

test('a base without an upstream lands without a push', async () => {
  let f = fixture({ 'rev-parse --abbrev-ref main@{u}': { code: 1 } })
  assertEquals(await f.invoke(), { landed: 'sha', root: '/repo' })
  assert(!f.calls.some((c) => c.args[0] == 'push'))
})

test('a failed push leaves the landing in place without retrying', async () => {
  let f = fixture({
    'push --quiet origin main:main': { code: 1, err: 'network unavailable' },
  })
  assertEquals(await f.invoke(), { landed: 'sha', root: '/repo' })
  assertEquals(f.calls.filter((c) => c.args[0] == 'push').length, 1)
  assert(f.said.join('\n').includes('landed locally, publish separately'))
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
  assertEquals(await f.invoke(['base.txt']), { landed: 'sha', root: '/repo' })
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
  'diff --raw -z --no-renames --diff-filter=ACMT main...HEAD': {
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
  })
  assert(f.commands().includes('commit --amend --no-edit --allow-empty'))
  assert(f.said.join('\n').includes('syntax error'))
})

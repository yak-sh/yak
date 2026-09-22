// What a citation's status is derived from, proved twice: against a stubbed
// git, where the interesting part is which question git is asked, and against
// a disposable repository, where the interesting part is that git's answer
// means what this module says it means.
//
// The repository cases cost git processes and a temp directory, so they run
// under TASKS_SLOW; everything else stays in the fast tier.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import type { Ran, Run } from './land.ts'
import { status } from './cites.ts'

let slow = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, ignore: !Deno.env.get('TASKS_SLOW') })

// A git that answers whatever the case wants and remembers what it was asked.
let fake = (answer: (args: string[]) => Partial<Ran> = () => ({})) => {
  let asked: string[][] = []
  let run: Run = (args) => {
    asked.push(args)
    let said = answer(args)
    let ok = said.ok ?? true
    return Promise.resolve({
      ok,
      code: ok ? 0 : 128,
      out: '',
      err: '',
      ...said,
    })
  }
  return { run, asked }
}

let AT = '2026-09-22T12:00:00.000Z'
let COMMIT = 'aaaaaaaa11112222333344445555666677778888'

let cite = (extra: Partial<Bundle> = {}): Bundle => ({
  entity: { eid: 'edge-1' },
  edge: { from: 'doc-1', to: 'file-1' },
  cites: {},
  verified: { at: AT },
  revision: { commit: COMMIT },
  ...extra,
})

let file: Bundle = {
  entity: { eid: 'file-1' },
  file: { path: 'src/db.ts', repository: 'repo-1' },
}

let design: Bundle = { entity: { eid: 'design-1' }, doc: { title: 'D' } }

let logArgs = (asked: string[][]) => asked.find((a) => a[0] == 'log') ?? []

Deno.test('a citation nobody has checked is unverified, and asks git nothing', async () => {
  let git = fake()
  let cited = cite()
  delete cited.verified
  assertEquals(await status(cited, file, { cwd: '.', run: git.run }), {
    state: 'unverified',
  })
  assertEquals(git.asked, [])
})

Deno.test('a definition narrows the log to the commits that touched it', async () => {
  let git = fake()
  let got = await status(cite({ symbol: { name: 'open' } }), file, {
    cwd: '.',
    run: git.run,
  })
  assertEquals(got, { state: 'current' })
  assert(logArgs(git.asked).includes('-L'))
  assert(logArgs(git.asked).includes(':open:src/db.ts'))
})

Deno.test('a line range narrows to those lines, and one line is a range of itself', async () => {
  let git = fake()
  await status(cite({ lines: { start: 3, end: 9 } }), file, {
    cwd: '.',
    run: git.run,
  })
  assert(logArgs(git.asked).includes('3,9:src/db.ts'))
  let one = fake()
  await status(cite({ lines: { start: 4 } }), file, {
    cwd: '.',
    run: one.run,
  })
  assert(logArgs(one.asked).includes('4,4:src/db.ts'))
})

Deno.test('a citation of a whole file passes the path as a pathspec', async () => {
  let git = fake()
  await status(cite(), file, { cwd: '.', run: git.run })
  assertEquals(logArgs(git.asked), [
    'log',
    '-s',
    '--format=%h',
    `${COMMIT}..HEAD`,
    '--',
    'src/db.ts',
  ])
})

Deno.test('commits after the revision mean the citation moved, and name themselves', async () => {
  let git = fake((args) =>
    args[0] == 'log' ? { out: 'b8b0f89\n0c9c68a\n' } : {}
  )
  assertEquals(await status(cite(), file, { cwd: '.', run: git.run }), {
    state: 'moved',
    changes: ['b8b0f89', '0c9c68a'],
  })
})

Deno.test('a commit this checkout does not have reads unknown, never current', async () => {
  let git = fake((args) => args[0] == 'cat-file' ? { ok: false } : {})
  assertEquals(await status(cite(), file, { cwd: '.', run: git.run }), {
    state: 'unknown',
    why: 'commit aaaaaaaa is not in this checkout',
  })
  // And it never asked the question it could not have trusted the answer to.
  assertEquals(logArgs(git.asked), [])
})

Deno.test('a mark with no commit beside it reads unknown', async () => {
  let git = fake()
  let cited = cite()
  delete cited.revision
  assertEquals(await status(cited, file, { cwd: '.', run: git.run }), {
    state: 'unknown',
    why: 'verified against no commit',
  })
})

Deno.test('git failing to answer reads unknown, in git own words', async () => {
  let git = fake((args) =>
    args[0] == 'log'
      ? { ok: false, err: "fatal: -L parameter 'gone': no match\nusage: …" }
      : {}
  )
  assertEquals(
    await status(cite({ symbol: { name: 'gone' } }), file, {
      cwd: '.',
      run: git.run,
    }),
    { state: 'unknown', why: "fatal: -L parameter 'gone': no match" },
  )
})

Deno.test('a citation of an entity asks the journal what changed after the mark', async () => {
  let asked: [string, string][] = []
  let changed = (target: string, after: string) => {
    asked.push([target, after])
    return ['#41 doc.body']
  }
  assertEquals(
    await status(cite(), design, { cwd: '.', run: fake().run, changed }),
    { state: 'moved', changes: ['#41 doc.body'] },
  )
  assertEquals(asked, [['design-1', AT]])
  assertEquals(
    await status(cite(), design, {
      cwd: '.',
      run: fake().run,
      changed: () => [],
    }),
    { state: 'current' },
  )
})

Deno.test('a citation of an entity with no journal to read reads unknown', async () => {
  let git = fake()
  let got = await status(cite(), design, { cwd: '.', run: git.run })
  assertEquals(got.state, 'unknown')
  assertEquals(git.asked, [])
})

// ---- against a repository ---------------------------------------------------

let command = async (cwd: string, ...args: string[]) => {
  let r = await new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  let out = new TextDecoder().decode(r.stdout).trim()
  if (r.code) throw new Error(`git ${args.join(' ')}: ${out}`)
  return out
}

// A file with two independent places in it: a constant at the top and a
// function below. The first commit is what a citation was verified at; the
// second touches only the function.
let setup = async () => {
  let cwd = Deno.makeTempDirSync({ prefix: 'yaks-cites-' })
  await command(cwd, 'init', '-q', '--initial-branch=main')
  await command(cwd, 'config', 'user.email', 'test@example.com')
  await command(cwd, 'config', 'user.name', 'Test')
  let write = (body: string) => Deno.writeTextFileSync(`${cwd}/f.js`, body)
  write('let cap = 1\n\nfunction greet() {\n  return 1\n}\n')
  await command(cwd, 'add', 'f.js')
  await command(cwd, 'commit', '-qm', 'one')
  let at = await command(cwd, 'rev-parse', 'HEAD')
  write('let cap = 1\n\nfunction greet() {\n  return 2\n}\n')
  await command(cwd, 'commit', '-qam', 'two')
  return { cwd, at }
}

slow(
  'a definition somebody edited moved; the line above it did not',
  async () => {
    let { cwd, at } = await setup()
    let f = { ...file, file: { path: 'f.js' } }
    let of = (extra: Partial<Bundle>) =>
      status(cite({ revision: { commit: at }, ...extra }), f, { cwd })

    let moved = await of({ symbol: { name: 'greet' } })
    assertEquals(moved.state, 'moved')
    assertEquals((moved as { changes: string[] }).changes.length, 1)
    // The line the second commit did not touch is still where it was said to be.
    assertEquals(await of({ lines: { start: 1, end: 1 } }), {
      state: 'current',
    })
    // With no place named, the whole file is the place, and it moved.
    assertEquals((await of({})).state, 'moved')
    await Deno.remove(cwd, { recursive: true })
  },
)

slow('a commit rebased out of the repository reads unknown', async () => {
  let { cwd } = await setup()
  let gone = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
  let got = await status(
    cite({ revision: { commit: gone } }),
    { ...file, file: { path: 'f.js' } },
    { cwd },
  )
  assertEquals(got, {
    state: 'unknown',
    why: 'commit deadbeef is not in this checkout',
  })
  await Deno.remove(cwd, { recursive: true })
})

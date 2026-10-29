// Citation status through the injected Git command boundary and graph content.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { fileDoc } from '@yaks/file/vocab'
import { kernelDoc, verify } from '@yaks/kernel'
import { keyDoc, keyKeywords } from '@yaks/key'
import { loadVocab } from '@yaks/vocab'
import { machineDoc } from '@yaks/machine/vocab'
import { gitDoc } from './comp.ts'
import type { Ran, Run } from './land.ts'
import { type Checkout, status, tracked } from './cites.ts'

let vocab = loadVocab(
  [kernelDoc, docDoc, edgeDoc, keyDoc, machineDoc, fileDoc, gitDoc],
  [edgeKeywords, keyKeywords],
)

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

let repo: Bundle = { entity: { eid: 'repo-1' }, repository: {} }

let file: Bundle = {
  entity: { eid: 'file-1' },
  file: { path: 'src/db.ts', root: 'repo-1' },
}

// The checkout of repo-1 a stubbed git answers for.
let ops = (
  run: Run,
  checkout: Checkout = { cwd: '.', repository: 'repo-1' },
) => ({ checkout, vocab, run })

let design: Bundle = { entity: { eid: 'design-1' }, doc: { title: 'D' } }

// A definition in that file, as @yaks/code reads one: a citation points at
// it, and the file is passed beside it.
let def = (name: string): Bundle => ({
  entity: { eid: `sym-${name}` },
  symbol: { module: 'file-1', name },
})

// Some lines of that file: a citation of them points at the place.
let place = (start: number, end?: number): Bundle => ({
  entity: { eid: `place-${start}` },
  lines: { file: 'file-1', start, ...end ? { end } : {} },
  content: { body: 'let cap = 1' },
})

let logArgs = (asked: string[][]) => asked.find((a) => a[0] == 'log') ?? []
let placeArgs = (asked: string[][]) =>
  asked.find((a) => a[0] == 'log' && a.includes('-L')) ?? []

// A file one commit touched: the coarse question is answered yes, so the
// narrowing question gets asked.
let stirred = (narrowed = '') =>
  fake((args) =>
    args[0] != 'log' ? {} : args.includes('-L') ? { out: narrowed } : {
      out: 'b8b0f89\n',
    }
  )

test('a citation is checked in Git against the file of a repository it names', () => {
  let volume = { entity: { eid: 'volume-1' }, volume: { mount: '/' } }
  let disk = {
    entity: { eid: 'file-2' },
    file: { path: 'a.md', root: 'volume-1' },
  }
  let rows = new Map([repo, file, volume, disk].map((b) => [b.entity.eid, b]))
  let get = (eid: string) => rows.get(eid)
  let entry = {
    entity: { eid: 'entry-1' },
    lines: { file: 'file-2', start: 9 },
  }
  for (
    let [to, want] of [
      [file, 'file-1'],
      [def('open'), 'file-1'],
      [place(3, 9), 'file-1'],
      [disk, undefined],
      [entry, undefined],
      [design, undefined],
      [{ ...def('lost'), symbol: { module: 'gone' } }, undefined],
    ] as const
  ) assertEquals(tracked(to, get)?.entity.eid, want, to.entity.eid)
})

test('a citation nobody has checked is unverified, and asks git nothing', async () => {
  let git = fake()
  let cited = cite()
  delete cited.verified
  assertEquals(await status(cited, file, ops(git.run), file), {
    state: 'unverified',
  })
  assertEquals(git.asked, [])
})

test('a file nothing touched is current, and the place is never asked about', async () => {
  let git = fake()
  let got = await status(cite(), def('open'), ops(git.run), file)
  assertEquals(got, { state: 'current' })
  // The coarse question only, as a pathspec: `-L` refuses an empty range.
  assertEquals(logArgs(git.asked), [
    'log',
    '--format=%h',
    `${COMMIT}..HEAD`,
    '--',
    'src/db.ts',
  ])
  assertEquals(placeArgs(git.asked), [])
})

test('a definition narrows a file that moved to the commits that touched it', async () => {
  let git = stirred()
  let got = await status(cite(), def('open'), ops(git.run), file)
  assertEquals(got, { state: 'current' })
  assertEquals(placeArgs(git.asked), [
    'log',
    '-s',
    '--format=%h',
    '-L',
    ':open:src/db.ts',
    `${COMMIT}..HEAD`,
  ])
})

test('a place narrows to its lines, and one line is a range of itself', async () => {
  for (
    let [at, range] of [
      [place(3, 9), '3,9:src/db.ts'],
      [place(4), '4,4:src/db.ts'],
    ] as const
  ) {
    let git = stirred()
    await status(cite(), at, ops(git.run), file)
    assert(placeArgs(git.asked).includes(range), range)
  }
})

test('a citation naming no place moves with the whole file', async () => {
  let git = stirred()
  assertEquals(await status(cite(), file, ops(git.run), file), {
    state: 'moved',
    changes: ['b8b0f89'],
  })
  assertEquals(placeArgs(git.asked), [])
})

test('commits touching the place mean the citation moved, and name themselves', async () => {
  let git = stirred('b8b0f89\n0c9c68a\n')
  assertEquals(await status(cite(), def('open'), ops(git.run), file), {
    state: 'moved',
    changes: ['b8b0f89', '0c9c68a'],
  })
})

test('a file read nowhere it can be checked reads unknown, and asks git nothing', async () => {
  for (
    let [checkout, why] of [
      [undefined, 'this citation names a file, and no checkout was given'],
      [
        { cwd: '.', repository: 'repo-2' },
        'the cited file is in another repository than this checkout',
      ],
    ] as const
  ) {
    let git = fake()
    assertEquals(
      await status(cite(), file, { checkout, vocab, run: git.run }, file),
      { state: 'unknown', why },
    )
    assertEquals(git.asked, [])
  }
})

test('a commit this checkout does not have reads unknown, never current', async () => {
  let git = fake((args) => args[0] == 'cat-file' ? { ok: false } : {})
  assertEquals(await status(cite(), file, ops(git.run), file), {
    state: 'unknown',
    why: 'commit aaaaaaaa is not in this checkout',
  })
  // And it never asked the question it could not have trusted the answer to.
  assertEquals(logArgs(git.asked), [])
})

test('a mark with no commit beside it reads unknown', async () => {
  let git = fake()
  let cited = cite()
  delete cited.revision
  assertEquals(await status(cited, file, ops(git.run), file), {
    state: 'unknown',
    why: 'verified against no commit',
  })
})

test('git failing to answer reads unknown, in git own words', async () => {
  let git = fake((args) =>
    args[0] != 'log'
      ? {}
      : args.includes('-L')
      ? { ok: false, err: "fatal: -L parameter 'gone': no match\nusage: …" }
      : { out: 'b8b0f89\n' }
  )
  assertEquals(await status(cite(), def('gone'), ops(git.run), file), {
    state: 'unknown',
    why: "fatal: -L parameter 'gone': no match",
  })
})

test('a citation of an entity compares its verified content', async () => {
  let git = fake()
  let checked = { ...cite(), ...verify(cite(), design, vocab) }
  assertEquals(await status(checked, design, ops(git.run)), {
    state: 'current',
  })
  assertEquals(
    await status(checked, {
      ...design,
      doc: { title: 'changed' },
    }, ops(git.run)),
    { state: 'moved' },
  )
  assertEquals(git.asked, [])
})

test('a symbol without its file cannot appear current as a graph entity', async () => {
  let checked = { ...cite(), ...verify(cite(), def('lost'), vocab) }
  assertEquals(await status(checked, def('lost'), { vocab }), {
    state: 'unknown',
    why: 'the cited symbol has no file to check',
  })
})

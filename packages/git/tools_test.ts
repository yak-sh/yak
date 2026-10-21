// The citation tools, handed a call the way a runner hands it over. A tool
// is a function from its call to bundles: nothing here opens a store, and what
// the answer lands as is the runner's, tested where the runner is.
//
// The cases that need Git each build a repository. A graph entity's content
// is checked without a checkout or subprocess.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { fileDoc } from '@yaks/file/vocab'
import { content, kernelDoc } from '@yaks/kernel'
import { keyDoc, keyKeywords } from '@yaks/key'
import { machineDoc } from '@yaks/machine/vocab'
import { loadVocab } from '@yaks/vocab'
import { gitDoc } from './comp.ts'
import { filesystemEid, repositoryEid } from './host.ts'
import { runs } from './tools.ts'
import { git, template } from './testing.ts'

let tools = runs()
let vocab = loadVocab(
  [kernelDoc, docDoc, edgeDoc, keyDoc, machineDoc, fileDoc, gitDoc],
  [edgeKeywords, keyKeywords],
)

// A call made from `cwd` (none, where it is empty), and a graph over a fixed
// set of bundles: `read` answers the citations among them, or this computer
// when asked for it, and `get` answers by id, which is all these two tools
// ask for.
let asked = (
  args: Record<string, unknown>,
  bundles: Bundle[],
  cwd = '',
): [Bundle, Graph] => [
  {
    entity: { eid: 'call-1' },
    call: { args },
    ...(cwd ? { process: { cwd } } : {}),
  },
  {
    vocab,
    read: (q: unknown) =>
      Promise.resolve(
        bundles.filter((b) => typeof q == 'string' ? b.machine : b.cites),
      ),
    address: (ids: string[]) => new Map(ids.map((i) => [i, i])),
    get: (eids: string[]) =>
      Promise.resolve(bundles.filter((b) => eids.includes(b.entity.eid))),
  } as unknown as Graph,
]

let body = (answer: Bundle[]) => String((answer[0].content as Bundle).body)

let doc = (eid: string, num: number): Bundle => ({
  entity: { eid, num },
  doc: { title: 'a document' },
})

let repository = (eid: string): Bundle => ({ entity: { eid }, repository: {} })

let fileAt = (eid: string, path: string, root = 'repo-1'): Bundle => ({
  entity: { eid, num: 2 },
  file: { path, root },
})

let place = (eid: string, file: string, start: number, end: number) => ({
  entity: { eid },
  lines: { file, start, end },
  content: { body: 'let cap = 1' },
})

let cite = (from: string, to: string, extra: Partial<Bundle> = {}): Bundle => ({
  entity: { eid: `cite-${from}-${to}` },
  edge: { from, to },
  cites: {},
  ...extra,
})

test('every git tool is declared and implemented', () => {
  assertEquals(loadTools(gitDoc, tools).map((t) => t.name).sort(), [
    'cites_check',
    'cites_verify',
    'land',
  ])
})

test('a citation nobody has checked is a warning naming the place it points', async () => {
  let bundles = [
    doc('doc-1', 1),
    repository('repo-1'),
    fileAt('file-1', 'src/db.ts'),
    { entity: { eid: 'sym-1' }, symbol: { module: 'file-1', name: 'open' } },
    cite('doc-1', 'sym-1'),
  ]
  let answer = await tools.cites_check!(...asked({}, bundles))
  let said = body(answer)
  assert(said.includes('src/db.ts:open'), said)
  assert(said.includes('never checked'), said)
  assertEquals((answer[0].finding as Bundle)?.level, 'warn')
})

test('a citation of an entity reports changed content without a checkout', async () => {
  let hash = content(vocab)(doc('design-1', 9))
  let bundles = [
    doc('doc-1', 1),
    { ...doc('design-1', 9), doc: { title: 'changed' } },
    cite('doc-1', 'design-1', {
      verified: { at: '2026-09-22T00:00:00Z' },
      cites: { hash },
    }),
  ]
  let answer = await tools.cites_check!(...asked({}, bundles))
  assert(body(answer).includes('cited content changed'), body(answer))
  assertEquals((answer[0].finding as Bundle)?.level, 'fail')
})

test('a citation of a removed entity is a failed check', async () => {
  let answer = await tools.cites_check!(...asked({}, [
    doc('doc-1', 1),
    cite('doc-1', 'gone', { verified: {}, cites: { hash: 'old' } }),
  ]))
  assert(body(answer).includes('cited entity is gone'), body(answer))
  assertEquals((answer[0].finding as Bundle)?.level, 'fail')
})

test('a place reads as its lines, and a citation of the file itself is the whole file', async () => {
  let bundles = [
    doc('doc-1', 1),
    doc('doc-2', 2),
    repository('repo-1'),
    fileAt('file-1', 'src/db.ts'),
    place('place-1', 'file-1', 3, 9),
    cite('doc-1', 'place-1'),
    cite('doc-2', 'file-1'),
  ]
  let said = body(await tools.cites_check!(...asked({}, bundles)))
  assert(said.includes('src/db.ts:3-9'), said)
  assert(said.includes('cites src/db.ts —'), said)
})

test('check is scoped by the entity citing, and by the file cited, its lines or its symbols', async () => {
  let bundles = [
    doc('doc-1', 1),
    doc('doc-2', 2),
    doc('doc-3', 3),
    repository('repo-1'),
    fileAt('file-1', 'src/db.ts'),
    fileAt('file-2', 'src/cli.ts'),
    place('place-1', 'file-2', 1, 2),
    cite('doc-1', 'file-1'),
    cite('doc-2', 'file-2'),
    cite('doc-3', 'place-1'),
  ]
  let mine = body(await tools.cites_check!(...asked({ of: 'doc-1' }, bundles)))
  assert(mine.includes('src/db.ts'), mine)
  assert(!mine.includes('src/cli.ts'), mine)
  let one = body(
    await tools.cites_check!(...asked({ path: 'src/cli.ts' }, bundles)),
  )
  assert(one.includes('cites src/cli.ts —'), one)
  assert(one.includes('src/cli.ts:1-2'), one)
  assert(!one.includes('src/db.ts'), one)
})

test('a check with nothing to report still answers, and reports no fault', async () => {
  let answer = await tools.cites_check!(...asked({}, [doc('doc-1', 1)]))
  assert(body(answer).includes('nothing to report'), body(answer))
  assertEquals(answer[0].finding, undefined)
})

test('verify refuses an id that cites nothing, before it asks git anything', async () => {
  let bundles = [doc('doc-1', 1)]
  await assertRejects(
    () =>
      Promise.resolve(
        tools.cites_verify!(...asked({ cite: 'doc-1' }, bundles, '.')),
      ),
    Error,
    'not a citation',
  )
  await assertRejects(
    () => Promise.resolve(tools.cites_verify!(...asked({}, bundles, '.'))),
    Error,
    'verify needs a citation',
  )
})

test('a graph citation verifies without a checkout', async () => {
  let bundles = [doc('doc-1', 1), doc('design-1', 9), cite('doc-1', 'design-1')]
  let [written] = await tools.cites_verify!(
    ...asked({ cite: 'cite-doc-1-design-1' }, bundles),
  )
  assertEquals(written.cites, {
    hash: content(vocab)(doc('design-1', 9)),
  })
  assertEquals(written.verified, {})
  let checked = bundles.map((b) =>
    b.entity.eid == written.entity.eid ? { ...b, ...written } : b
  )
  let answer = await tools.cites_check!(...asked({}, checked))
  assert(body(answer).includes('nothing to report'), body(answer))
})

test('verify refuses a symbol whose file is missing', async () => {
  let bundles = [doc('doc-1', 1), {
    entity: { eid: 'sym-1' },
    symbol: { module: 'gone', name: 'open' },
  }, cite('doc-1', 'sym-1')]
  await assertRejects(
    () =>
      Promise.resolve(
        tools.cites_verify!(...asked({ cite: 'cite-doc-1-sym-1' }, bundles)),
      ),
    Error,
    'has no file to check',
  )
})

// ---- against a repository ---------------------------------------------------

// `f.js` committed twice: a citation verified at the first commit, `at`.
let made = template(async (cwd) => {
  await git(cwd, 'init', '-q', '--initial-branch=main')
  await git(cwd, 'config', 'user.email', 'test@example.com')
  await git(cwd, 'config', 'user.name', 'Test')
  Deno.writeTextFileSync(`${cwd}/f.js`, 'let cap = 1\n')
  await git(cwd, 'add', 'f.js')
  await git(cwd, 'commit', '-qm', 'one')
  Deno.writeTextFileSync(`${cwd}/f.js`, 'let cap = 2\n')
  await git(cwd, 'commit', '-qam', 'two')
})

// A copy of it, the repository it is a checkout of on this computer, and the
// rows a host that has run before holds: this computer, its filesystem, and
// that repository.
let repo = async () => {
  let cwd = await made()
  let filesystem = filesystemEid('computer')
  let root = repositoryEid(`${cwd}/.git`, filesystem)
  return {
    cwd,
    at: await git(cwd, 'rev-parse', 'HEAD~'),
    root,
    here: [
      { entity: { eid: 'computer' }, machine: { address: 'local://' } },
      {
        entity: { eid: filesystem },
        workspace: { machine: 'computer', root: '/' },
      },
      repository(root),
      doc('doc-1', 1),
    ],
  }
}

test(
  'a citation whose file moved since it was verified fails the check',
  async () => {
    let { cwd, at, root, here } = await repo()
    let checked = {
      verified: { at: '2026-09-22T00:00:00Z' },
      revision: { commit: at },
    }
    let bundles = [
      ...here,
      fileAt('file-1', 'f.js', root),
      cite('doc-1', 'file-1', checked),
      // The same path in another repository is not this checkout's to answer
      // for, nor a file `--path` names here.
      doc('doc-2', 2),
      repository('repo-2'),
      fileAt('file-2', 'f.js', 'repo-2'),
      cite('doc-2', 'file-2', checked),
    ]
    let answer = await tools.cites_check!(...asked({}, bundles, cwd))
    assert(body(answer).includes('moved by'), body(answer))
    assert(body(answer).includes('in another repository'), body(answer))
    assertEquals((answer[0].finding as Bundle)?.level, 'fail')
    let named = body(
      await tools.cites_check!(...asked({ path: 'f.js' }, bundles, cwd)),
    )
    assert(named.includes('moved by'), named)
    assert(!named.includes('another repository'), named)
    await Deno.remove(cwd, { recursive: true })
  },
)

test(
  'verify marks the citation and moves its revision to the commit checked out',
  async () => {
    let { cwd, at, root, here } = await repo()
    let head = await git(cwd, 'rev-parse', 'HEAD')
    let bundles = [
      ...here,
      fileAt('file-1', 'f.js', root),
      place('place-1', 'file-1', 1, 1),
      cite('doc-1', 'file-1', { revision: { commit: at } }),
      cite('doc-1', 'place-1'),
      doc('doc-2', 2),
      repository('repo-2'),
      fileAt('file-2', 'f.js', 'repo-2'),
      cite('doc-2', 'file-2'),
    ]
    let [written] = await tools.cites_verify!(
      ...asked({ cite: 'cite-doc-1-file-1' }, bundles, cwd),
    )
    assertEquals(written.entity.eid, 'cite-doc-1-file-1')
    // Empty: at, by and via are the graph's to stamp, so a citation records who
    // checked it and cannot claim otherwise.
    assertEquals(written.verified, {})
    assertEquals(written.revision, { commit: head })

    // An entity verifies every citation it makes, in one answer: a place in a
    // file as well as the file.
    let all = await tools.cites_verify!(...asked({ of: 'doc-1' }, bundles, cwd))
    assertEquals(all.map((b) => [b.entity.eid, b.revision]), [
      ['cite-doc-1-file-1', { commit: head }],
      ['cite-doc-1-place-1', { commit: head }],
    ])
    // A file of another repository is verified in a checkout of its own.
    await assertRejects(
      () =>
        Promise.resolve(
          tools.cites_verify!(...asked({ of: 'doc-2' }, bundles, cwd)),
        ),
      Error,
      'another repository',
    )
    await Deno.remove(cwd, { recursive: true })
  },
)

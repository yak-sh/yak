// The citation tools, handed a call the way a runner hands it over. A tool
// is a function from its call to bundles: nothing here opens a store, and what
// the answer lands as is the runner's, tested where the runner is.
//
// A graph entity's content is checked without a checkout or subprocess.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadTools } from '@yaks/graph/tools'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { fileDoc } from '@yaks/file/vocab'
import { content, kernel, kernelDoc } from '@yaks/kernel'
import { keyDoc, keyKeywords } from '@yaks/key'
import { machineDoc } from '@yaks/machine/vocab'
import { loadVocab } from '@yaks/vocab'
import { gitDoc } from './comp.ts'
import { runs } from './tools.ts'

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

// A graph holding a citation and a verify of it, so the check reads the marks
// back through a query, the way a host's graph answers one.
let held = graph({ storage: ram(vocab), vocab, plugins: [kernel()] })
let ofDoc = asked({ of: 'doc-1' }, [])[0]
await held.apply([
  doc('doc-1', 1),
  doc('design-1', 9),
  cite('doc-1', 'design-1'),
])
await held.apply(await tools.cites_verify!(ofDoc, held))

test('a citation verified in a graph reads as checked there', async () => {
  let said = body(await tools.cites_check!(ofDoc, held))
  assert(said.includes('nothing to report'), said)
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

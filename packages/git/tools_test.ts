// The citation tools, handed a call the way a runner hands it over. A tool
// is a function from its call to bundles: nothing here opens a store, and what
// the answer lands as is the runner's, tested where the runner is.
//
// The cases that need Git run under TASKS_SLOW, since each builds a
// repository. The rest reach no subprocess at all: a citation nobody has
// checked, and a citation of an entity with no journal to read, are both
// answered before Git is asked anything.

import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { gitDoc } from './comp.ts'
import { git as vocab } from './testing.ts'
import { runs } from './tools.ts'

let tools = runs()

let slow = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, ignore: !Deno.env.get('TASKS_SLOW') })

// A call made from `cwd` (none, where it is empty), and a graph over a fixed
// set of bundles: `read` answers the citations among them, and `get` answers
// by id, which is all these two tools ask for.
let asked = (
  args: Record<string, unknown>,
  bundles: Bundle[],
  cwd = '.',
): [Bundle, Graph] => [
  {
    entity: { eid: 'call-1' },
    call: { args },
    ...(cwd ? { process: { cwd } } : {}),
  },
  {
    vocab,
    read: () => Promise.resolve(bundles.filter((b) => b.cites)),
    address: (ids: string[]) => new Map(ids.map((i) => [i, i])),
    storage: {
      tx: <T>(fn: (tx: { get: (eids: string[]) => Bundle[] }) => T) =>
        Promise.resolve(
          fn({
            get: (eids) => bundles.filter((b) => eids.includes(b.entity.eid)),
          }),
        ),
    },
  } as unknown as Graph,
]

let body = (answer: Bundle[]) => String((answer[0].content as Bundle).body)

let doc = (eid: string, num: number): Bundle => ({
  entity: { eid, num },
  doc: { title: 'a document' },
})

let fileAt = (eid: string, path: string): Bundle => ({
  entity: { eid, num: 2 },
  file: { path, repository: 'repo-1' },
})

let cite = (from: string, to: string, extra: Partial<Bundle> = {}): Bundle => ({
  entity: { eid: `cite-${from}-${to}` },
  edge: { from, to },
  cites: {},
  ...extra,
})

Deno.test('every git tool is declared and implemented', () => {
  assertEquals(loadTools(gitDoc, tools).map((t) => t.name).sort(), [
    'cites_check',
    'cites_verify',
    'land',
  ])
})

Deno.test('a citation nobody has checked is a warning naming the place it points', async () => {
  let bundles = [
    doc('doc-1', 1),
    fileAt('file-1', 'src/db.ts'),
    { entity: { eid: 'sym-1' }, symbol: { module: 'file-1', name: 'open' } },
    cite('doc-1', 'sym-1'),
  ]
  let answer = await tools.cites_check!(...asked({}, bundles))
  let said = body(answer)
  assert(said.includes('src/db.ts:open'), said)
  assert(said.includes('never checked'), said)
  assertEquals((answer[0].error as Bundle)?.code, 'warn')
})

Deno.test('a citation of an entity with no journal to read says so rather than passing', async () => {
  let bundles = [
    doc('doc-1', 1),
    doc('design-1', 9),
    cite('doc-1', 'design-1', { verified: { at: '2026-09-22T00:00:00Z' } }),
  ]
  let said = body(await tools.cites_check!(...asked({}, bundles)))
  assert(said.includes('no answer'), said)
  assert(said.includes('journal'), said)
})

Deno.test('a line range reads as a range, and a citation with no place named is the whole file', async () => {
  let bundles = [
    doc('doc-1', 1),
    fileAt('file-1', 'src/db.ts'),
    cite('doc-1', 'file-1', { lines: { start: 3, end: 9 } }),
    cite('doc-2', 'file-1'),
    doc('doc-2', 2),
  ]
  let said = body(await tools.cites_check!(...asked({}, bundles)))
  assert(said.includes('src/db.ts:3-9'), said)
  assert(said.includes('cites src/db.ts —'), said)
})

Deno.test('check is scoped by the entity citing, and by the file cited', async () => {
  let bundles = [
    doc('doc-1', 1),
    doc('doc-2', 2),
    fileAt('file-1', 'src/db.ts'),
    fileAt('file-2', 'src/cli.ts'),
    cite('doc-1', 'file-1'),
    cite('doc-2', 'file-2'),
  ]
  let mine = body(await tools.cites_check!(...asked({ of: 'doc-1' }, bundles)))
  assert(mine.includes('src/db.ts'), mine)
  assert(!mine.includes('src/cli.ts'), mine)
  let one = body(
    await tools.cites_check!(...asked({ path: 'src/cli.ts' }, bundles)),
  )
  assert(one.includes('src/cli.ts'), one)
  assert(!one.includes('src/db.ts'), one)
})

Deno.test('a check with nothing to report still answers, and reports no fault', async () => {
  let answer = await tools.cites_check!(...asked({}, [doc('doc-1', 1)]))
  assert(body(answer).includes('nothing to report'), body(answer))
  assertEquals(answer[0].error, undefined)
})

Deno.test('verify refuses an id that cites nothing, before it asks git anything', async () => {
  let bundles = [doc('doc-1', 1)]
  await assertRejects(
    () =>
      Promise.resolve(
        tools.cites_verify!(...asked({ cite: 'doc-1' }, bundles)),
      ),
    Error,
    'not a citation',
  )
  await assertRejects(
    () => Promise.resolve(tools.cites_verify!(...asked({}, bundles))),
    Error,
    'verify needs a citation',
  )
})

Deno.test('neither tool runs where the graph stands in no checkout', async () => {
  await assertRejects(
    () => Promise.resolve(tools.cites_check!(...asked({}, [], ''))),
    Error,
    'nowhere in particular',
  )
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

let repo = async () => {
  let cwd = Deno.makeTempDirSync({ prefix: 'yaks-cites-tools-' })
  await command(cwd, 'init', '-q', '--initial-branch=main')
  await command(cwd, 'config', 'user.email', 'test@example.com')
  await command(cwd, 'config', 'user.name', 'Test')
  Deno.writeTextFileSync(`${cwd}/f.js`, 'let cap = 1\n')
  await command(cwd, 'add', 'f.js')
  await command(cwd, 'commit', '-qm', 'one')
  let at = await command(cwd, 'rev-parse', 'HEAD')
  Deno.writeTextFileSync(`${cwd}/f.js`, 'let cap = 2\n')
  await command(cwd, 'commit', '-qam', 'two')
  return { cwd, at }
}

slow(
  'a citation whose file moved since it was verified fails the check',
  async () => {
    let { cwd, at } = await repo()
    let bundles = [
      doc('doc-1', 1),
      fileAt('file-1', 'f.js'),
      cite('doc-1', 'file-1', {
        verified: { at: '2026-09-22T00:00:00Z' },
        revision: { commit: at },
      }),
    ]
    let answer = await tools.cites_check!(...asked({}, bundles, cwd))
    assert(body(answer).includes('moved by'), body(answer))
    assertEquals((answer[0].error as Bundle)?.code, 'fail')
    await Deno.remove(cwd, { recursive: true })
  },
)

slow(
  'verify marks the citation and moves its revision to the commit checked out',
  async () => {
    let { cwd, at } = await repo()
    let head = await command(cwd, 'rev-parse', 'HEAD')
    let bundles = [
      doc('doc-1', 1),
      fileAt('file-1', 'f.js'),
      cite('doc-1', 'file-1', { revision: { commit: at } }),
    ]
    let [written] = await tools.cites_verify!(
      ...asked({ cite: 'cite-doc-1-file-1' }, bundles, cwd),
    )
    assertEquals(written.entity.eid, 'cite-doc-1-file-1')
    // Empty: at, by and via are the graph's to stamp, so a citation records who
    // checked it and cannot claim otherwise.
    assertEquals(written.verified, {})
    assertEquals(written.revision, { commit: head })

    // An entity verifies every citation it makes, in one answer.
    let all = await tools.cites_verify!(...asked({ of: 'doc-1' }, bundles, cwd))
    assertEquals(all.map((b) => b.entity.eid), ['cite-doc-1-file-1'])
    await Deno.remove(cwd, { recursive: true })
  },
)

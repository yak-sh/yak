// The persona files: which files a graph says its checkouts hold, and a sync
// that writes them.

import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { memo, sync } from '@yaks/mirror'
import { checkout, fleet } from './testing.ts'
import { personaFiles, personaMirror } from './files.ts'

let then = (g: Graph, ...batch: Bundle[]): Graph => (g.apply(batch), g)

let texts = async (g: Graph) =>
  new Map((await personaFiles(g)).files.map((f) => [f.path, f.text]))

Deno.test('the common persona is AGENTS.md; a specialist says only what it adds', async () => {
  let by = await texts(fleet('/r'))
  assertEquals([...by.keys()], [
    '/r/.tasks/AGENTS.md',
    '/r/.tasks/personas/coder.md',
  ])
  let common = by.get('/r/.tasks/AGENTS.md')!
  assertMatch(common, /^<!-- GENERATED from N-\d+ \(common\) — edit it in/)
  assert(common.includes('for everyone') && common.includes('first'), common)
  let coder = by.get('/r/.tasks/personas/coder.md')!
  assert(
    coder.startsWith('---\nname: coder\ndescription: "Coder"\n---\n<!-- '),
    coder,
  )
  assert(coder.includes('second') && !coder.includes('first'), coder)
})

Deno.test('what the files say is every persona and document in them', async () => {
  let { said } = await personaFiles(fleet('/r'))
  assertEquals([...said].sort(), ['m1', 'm2', 'n1', 'n2'])
})

Deno.test('a specialist with no name is named for its id', async () => {
  let g = then(fleet('/r'), { entity: { eid: 'k1' }, key: null, alias: null })
  assertMatch([...(await texts(g)).keys()][1], /\/personas\/n-\d+\.md$/)
})

Deno.test('an archived project keeps what it last had', async () => {
  let archived = then(fleet('/r'), { entity: { eid: 'p1' }, archived: {} })
  assertEquals((await personaFiles(archived)).files, [])
})

Deno.test('a sync keeps the main checkout current, never a linked worktree', async () => {
  let root = Deno.makeTempDirSync()
  try {
    // A worktree cut by hand, which nothing marks, and first by path.
    let g = then(
      fleet(`${root}/main`),
      checkout('w3', `${root}/a`, `${root}/main/.git/worktrees/a`),
    )
    let mem = memo(`${root}/memo.json`)
    let synced = async () => sync((await personaMirror(g, mem)).binding)
    await synced()
    then(g, { entity: { eid: 'm1' }, doc: { body: 'first, revised' } })
    let file = `${root}/main/.tasks/AGENTS.md`
    assertEquals((await synced()).wrote, [file])
    assertMatch(Deno.readTextFileSync(file), /first, revised/)
    assertThrows(() => Deno.statSync(`${root}/a`))
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
})

Deno.test('a sync writes the files, removes a stale one, then has nothing to do', async () => {
  let root = Deno.makeTempDirSync()
  try {
    Deno.mkdirSync(`${root}/.tasks/personas`, { recursive: true })
    Deno.writeTextFileSync(`${root}/.tasks/personas/gone.md`, 'old\n')
    let g = fleet(root)
    let mem = memo(`${root}/memo.json`)
    let first = await sync((await personaMirror(g, mem)).binding)
    assertEquals(first.wrote.length, 2)
    assertEquals(first.removed, [`${root}/.tasks/personas/gone.md`])
    let again = await sync((await personaMirror(g, mem)).binding)
    assertEquals([again.wrote, again.removed], [[], []])
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
})

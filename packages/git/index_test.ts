// The index: a manifest in, git's own objects out, and the rows a pack walks.
// Constants: ./harness.ts.

import { assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { keyEid } from '@yaks/key'
import { COMPAT } from './comp.ts'
import { entryEid } from './index.ts'
import { DIR, FILE } from './tree.ts'
import {
  AUTHOR,
  COMMITTER,
  file,
  fixture,
  HELLO,
  HELLO_OID,
  HELLO_OID256,
  LIB_OID,
  ONE_OID,
  ROOT_OID,
  ROOT_OID256,
  TWO_OID,
  X,
} from './harness.ts'

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

// The two files of every fixture, in a store, as a deploy manifest names them.
let deployed = (bytes: Parameters<typeof file>[0]) => ({
  'hello.txt': file(bytes, HELLO),
  'lib/a.txt': file(bytes, X),
})

Deno.test('a manifest becomes the trees git would build', async () => {
  let { git, bytes } = fixture()
  let root = await git.files(deployed(bytes))
  assertEquals(root, { oid: ROOT_OID, oid256: ROOT_OID256 })
})

Deno.test('an object row is its type, its size and its bytes', async () => {
  let { g, git, bytes } = fixture()
  let sha = deployed(bytes)['hello.txt']
  await git.files(deployed(bytes))
  let [row] = await g.read(`.gitobj.type=blob&.blob.sha=${sha}`)
  assertEquals(row.entity.eid, HELLO_OID)
  assertEquals(comp(row, 'gitobj'), { type: 'blob', size: 6 })
})

Deno.test('the SHA-256 name is a key off the SHA-1 one', async () => {
  let { g, git, bytes } = fixture()
  await git.files(deployed(bytes))
  let [key] = await g.read(`.compat!&.key.of=${HELLO_OID}`)
  assertEquals(key.entity.eid, keyEid(COMPAT, HELLO_OID256))
  assertEquals(comp(key, 'key'), { of: HELLO_OID, value: HELLO_OID256 })
})

Deno.test('a tree links to each child under the name it holds it by', async () => {
  let { g, git, bytes } = fixture()
  await git.files(deployed(bytes))
  let rows = await g.read(`.entry!&.edge.from=${ROOT_OID}&.order=ord`)
  assertEquals(
    rows.map((
      r,
    ) => [comp(r, 'entry').name, comp(r, 'entry').mode, comp(r, 'edge').to]),
    [['hello.txt', FILE, HELLO_OID], ['lib', DIR, LIB_OID]],
  )
  assertEquals(rows[0].entity.eid, entryEid(ROOT_OID, 'hello.txt'))
})

Deno.test('one blob under two names is two entries', async () => {
  let { g, git, bytes } = fixture()
  let sha = file(bytes, HELLO)
  let root = await git.files({ 'a.txt': sha, 'b.txt': sha })
  let rows = await g.read(`.entry!&.edge.from=${root.oid}`)
  assertEquals(rows.map((r) => comp(r, 'entry').name).sort(), [
    'a.txt',
    'b.txt',
  ])
  assertEquals(
    new Set(rows.map((r) => comp(r, 'edge').to)),
    new Set([HELLO_OID]),
  )
})

Deno.test('a manifest written twice writes one graph and reads no bytes again', async () => {
  let { g, git, bytes } = fixture()
  let manifest = deployed(bytes)
  await git.files(manifest)
  let once = (await g.read('.gitobj!')).length
  let reads = bytes.reads()
  await git.files(manifest)
  assertEquals((await g.read('.gitobj!')).length, once)
  assertEquals(bytes.reads(), reads)
})

Deno.test('bytes nothing stored are refused by name', async () => {
  let { git } = fixture()
  await assertRejects(
    () => git.files({ 'gone.txt': 'ff'.repeat(32) }),
    Error,
    'no bytes stored under',
  )
})

Deno.test('a commit chain is the ids git takes, and a parent walk', async () => {
  let { g, git, bytes } = fixture()
  let tree = await git.files(deployed(bytes))
  let one = await git.commit({
    tree,
    author: AUTHOR,
    committer: COMMITTER,
    message: 'deploy 1',
  })
  assertEquals(one.oid, ONE_OID)
  let at = { at: 1757000060000 }
  let two = await git.commit({
    tree,
    parents: [one],
    author: { ...AUTHOR, ...at },
    committer: { ...COMMITTER, ...at },
    message: 'deploy 2',
  })
  assertEquals(two.oid, TWO_OID)
  let [edge] = await g.read(`.parent!&.edge.from=${two.oid}`)
  assertEquals(comp(edge, 'edge').to, one.oid)
  assertEquals(comp(edge, 'edge').ord, 0)
})

Deno.test('a commit body is in the store, verbatim', async () => {
  let { g, git, bytes } = fixture()
  let tree = await git.files(deployed(bytes))
  let one = await git.commit({
    tree,
    author: AUTHOR,
    committer: COMMITTER,
    message: 'deploy 1',
  })
  let [row] = await g.read(`.gitobj.type=commit`)
  let body = await bytes.get(String(comp(row, 'blob').sha))
  assertEquals(row.entity.eid, one.oid)
  assertEquals(comp(row, 'gitobj').size, body!.length)
  assertEquals(
    new TextDecoder().decode(body).split('\n')[0],
    `tree ${ROOT_OID}`,
  )
})

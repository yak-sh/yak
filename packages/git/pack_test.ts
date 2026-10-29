// Pack bytes and object reachability over a graph and byte store.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { objects } from './objects.ts'
import { entry, head, pack } from './pack.ts'
import { hex } from './oid.ts'
import {
  AUTHOR,
  COMMITTER,
  file,
  fixture,
  HELLO,
  HELLO_OID,
  LIB_OID,
  ONE_OID,
  ROOT_OID,
  X,
  X_OID,
} from './testing.ts'

let utf8 = new TextEncoder()
let text = new TextDecoder()

let all = async (
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await new Response(stream).arrayBuffer())

// The two files of the fixture, as a deploy manifest names them.
let deployed = (bytes: Parameters<typeof file>[0]) => ({
  'hello.txt': file(bytes, HELLO),
  'lib/a.txt': file(bytes, X),
})

// One commit over those two files, and the reader over the graph that holds it.
let deploy = async () => {
  let { g, git: index, bytes } = fixture()
  let tree = await index.files(deployed(bytes))
  let one = await index.commit({
    tree,
    author: AUTHOR,
    committer: COMMITTER,
    message: 'deploy 1',
  })
  return { one, tree, index, bytes, g, git: objects(g, bytes) }
}

test('a packed blob preserves its body and authenticates all preceding bytes', async () => {
  let bytes = await all(pack(1, [{ type: 'blob', bytes: utf8.encode(HELLO) }]))
  assertEquals([...bytes.subarray(0, 12)], [...head(1)])
  assertEquals(bytes[12], 0x36)
  let body = new Blob([bytes.subarray(13, -20)]).stream()
    .pipeThrough(new DecompressionStream('deflate'))
  assertEquals(text.decode(await all(body)), HELLO)
  assertEquals(
    hex(bytes.subarray(-20)),
    hex(
      new Uint8Array(
        await crypto.subtle.digest('SHA-1', bytes.subarray(0, -20)),
      ),
    ),
  )
})

test('the objects are named once, commits before trees before blobs', async () => {
  let { git: from } = await deploy()
  assertEquals(await from.reach([ONE_OID]), [
    ONE_OID,
    ROOT_OID,
    LIB_OID,
    HELLO_OID,
    X_OID,
  ])
})

test('a have is subtracted, however it was reached', async () => {
  let { git: from, index, tree, one } = await deploy()
  let at = { at: 1757000060000 }
  let two = await index.commit({
    tree,
    parents: [one],
    author: { ...AUTHOR, ...at },
    committer: { ...COMMITTER, ...at },
    message: 'deploy 2',
  })
  // The second commit shares its whole tree with the first, so a client that
  // has the first needs exactly one object.
  assertEquals(await from.reach([two.oid], [ONE_OID]), [two.oid])
  // A have nothing here has ever seen is not a reason to fail.
  assertEquals((await from.reach([two.oid], ['ff'.repeat(20)])).length, 6)
})

test('a want this graph never had is refused', async () => {
  let { git: from } = await deploy()
  await assertRejects(
    () => from.reach(['ff'.repeat(20)]),
    Error,
    'no object',
  )
})

test('a pack of nothing is its header and the name of it', async () => {
  let bytes = await all(pack(0, []))
  assertEquals(bytes.length, 32)
  assertEquals(text.decode(bytes.subarray(0, 4)), 'PACK')
  assertEquals(
    hex(bytes.subarray(12)),
    hex(new Uint8Array(await crypto.subtle.digest('SHA-1', head(0)))),
  )
})

test('an entry states its type and its unpacked size', () => {
  assertEquals([...entry('blob', 6)], [0x36])
  // 1000 = 62 * 16 + 8: four bits under the type, the rest seven at a time.
  assertEquals([...entry('blob', 1000)], [0xb8, 0x3e])
  assertEquals([...entry('commit', 0)], [0x10])
})

test('a pack that promised more than it wrote breaks rather than lies', async () => {
  await assertRejects(
    () => all(pack(2, [{ type: 'blob', bytes: utf8.encode(HELLO) }])),
    Error,
    'said 2 objects and wrote 1',
  )
})

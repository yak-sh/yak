// The pack, judged by git itself: a fixture repository indexes it, walks every
// object in it, and prints back the commit we wrote.
//
// `git index-pack` is the whole of the format's checking in one command — the
// header, the count, each entry's type and unpacked size, every zlib stream,
// and the SHA-1 trailer over all of it. `git rev-list --objects` then proves
// the pack is COMPLETE, because it cannot walk a tree that is not there.

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
} from './harness.ts'

let utf8 = new TextEncoder()
let text = new TextDecoder()

let all = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> =>
  new Uint8Array(await new Response(stream).arrayBuffer())

// git, in a directory, with the exit code as the assertion.
let git = async (
  dir: string,
  args: string[],
  stdin?: Uint8Array,
): Promise<string> => {
  let run = new Deno.Command('git', {
    args: ['-C', dir, ...args],
    stdin: stdin ? 'piped' : 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  if (stdin) {
    let to = run.stdin.getWriter()
    await to.write(stdin)
    await to.close()
  }
  let { code, stdout, stderr } = await run.output()
  assertEquals(code, 0, `git ${args.join(' ')}: ${text.decode(stderr)}`)
  return text.decode(stdout)
}

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
  return { one, tree, index, bytes, git: objects(g, bytes) }
}

Deno.test('git indexes the pack and walks every object in it', async () => {
  let { git: from } = await deploy()
  let bytes = await all(await from.pack([ONE_OID]))
  let dir = await Deno.makeTempDir({ prefix: 'yaks-git-' })
  try {
    await git(dir, ['init', '--bare', '--quiet'])
    // `index-pack` answers `pack\t<sha>` — what git named the pack we wrote.
    let name = (await git(dir, ['index-pack', '--stdin'], bytes)).trim()
      .split('\t')[1]
    // `verify-pack` prints `<oid> <type> <size> …` — the unpacked size each
    // entry header stated, read back out of the index git built from it.
    let listed = (await git(dir, [
      'verify-pack',
      '-v',
      `objects/pack/pack-${name}.idx`,
    ])).split('\n')
    assertEquals(
      listed.find((l) => l.startsWith(HELLO_OID))?.split(/ +/).slice(1, 3),
      ['blob', '6'],
    )
    // Every object, reached from the commit alone — a missing tree or blob
    // stops this walk, so passing it is the pack being complete.
    let walked = (await git(dir, ['rev-list', '--objects', ONE_OID]))
      .trim().split('\n').map((l) => l.split(' ')[0])
    assertEquals(
      walked.sort(),
      [ONE_OID, HELLO_OID, LIB_OID, ROOT_OID, X_OID]
        .sort(),
    )
    let commit = await git(dir, ['cat-file', '-p', ONE_OID])
    assertEquals(commit.split('\n')[0], `tree ${ROOT_OID}`)
    assertEquals(commit.trimEnd().split('\n').pop(), 'deploy 1')
    assertEquals(await git(dir, ['cat-file', 'blob', HELLO_OID]), HELLO)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('the objects are named once, commits before trees before blobs', async () => {
  let { git: from } = await deploy()
  assertEquals(await from.reach([ONE_OID]), [
    ONE_OID,
    ROOT_OID,
    LIB_OID,
    HELLO_OID,
    X_OID,
  ])
})

Deno.test('a have is subtracted, however it was reached', async () => {
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

Deno.test('a want this graph never had is refused', async () => {
  let { git: from } = await deploy()
  await assertRejects(
    () => from.reach(['ff'.repeat(20)]),
    Error,
    'no object',
  )
})

Deno.test('a pack of nothing is its header and the name of it', async () => {
  let bytes = await all(pack(0, []))
  assertEquals(bytes.length, 32)
  assertEquals(text.decode(bytes.subarray(0, 4)), 'PACK')
  assertEquals(
    hex(bytes.subarray(12)),
    hex(new Uint8Array(await crypto.subtle.digest('SHA-1', head(0)))),
  )
})

Deno.test('an entry states its type and its unpacked size', () => {
  assertEquals([...entry('blob', 6)], [0x36])
  // 1000 = 62 * 16 + 8: four bits under the type, the rest seven at a time.
  assertEquals([...entry('blob', 1000)], [0xb8, 0x3e])
  assertEquals([...entry('commit', 0)], [0x10])
})

Deno.test('a pack that promised more than it wrote breaks rather than lies', async () => {
  await assertRejects(
    () => all(pack(2, [{ type: 'blob', bytes: utf8.encode(HELLO) }])),
    Error,
    'said 2 objects and wrote 1',
  )
})

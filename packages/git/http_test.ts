// Git protocol requests and responses in process over a graph and byte store.

import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { advertise, CAPS, type Refs, uploadPack } from './http.ts'
import { objects } from './objects.ts'
import { DELIM, FLUSH, mark, pkt } from './pkt.ts'
import {
  AUTHOR,
  COMMITTER,
  file,
  fixture,
  HELLO,
  ONE_OID,
  TWO_OID,
  X,
} from './testing.ts'

let text = new TextDecoder()
let V2 = { 'git-protocol': 'version=2' }

// The two commits of the fixture, and the pair a door is mounted over.
let repo = async () => {
  let { g, git: index, bytes } = fixture()
  let tree = await index.files({
    'hello.txt': file(bytes, HELLO),
    'lib/a.txt': file(bytes, X),
  })
  let one = await index.commit({
    tree,
    author: AUTHOR,
    committer: COMMITTER,
    message: 'deploy 1',
  })
  let at = { at: AUTHOR.at + 60000 }
  await index.commit({
    tree,
    parents: [one],
    author: { ...AUTHOR, ...at },
    committer: { ...COMMITTER, ...at },
    message: 'deploy 2',
  })
  let refs: Refs = {
    list: () => Promise.resolve([{ name: 'refs/heads/main', oid: TWO_OID }]),
  }
  return { refs, from: objects(g, bytes) }
}

let post = (body: Uint8Array[]) =>
  new Request('http://x/a.git/git-upload-pack', {
    method: 'POST',
    headers: V2,
    body: new Uint8Array([...body.flatMap((b) => [...b])]),
  })

let command = async (name: string, args: string[], over?: Refs) => {
  let { refs, from } = await repo()
  let res = await uploadPack(
    post([
      pkt(`command=${name}\n`),
      mark(DELIM),
      ...args.map((a) => pkt(a + '\n')),
      mark(FLUSH),
    ]),
    over ?? refs,
    from,
  )
  return { res, said: text.decode(new Uint8Array(await res.arrayBuffer())) }
}

test('the advertisement is the service line and what we implement', async () => {
  let res = advertise(
    new Request('http://x/a.git/info/refs?service=git-upload-pack', {
      headers: V2,
    }),
  )
  assertEquals(
    res.headers.get('content-type'),
    'application/x-git-upload-pack-advertisement',
  )
  assertEquals(
    await res.text(),
    '001e# service=git-upload-pack\n0000' +
      '000eversion 2\n000fagent=yaks\n000cls-refs\n000afetch\n' +
      '0017object-format=sha1\n0012server-option\n0000',
  )
  // Nothing shallow, filtered, or sha256 is promised, because none is written.
  assertEquals(
    CAPS.some((c) => /shallow|filter|sha256|wait-for-done/.test(c)),
    false,
  )
})

test('a client that cannot say v2, and a service we do not serve', async () => {
  let one = advertise(
    new Request('http://x/a.git/info/refs?service=git-upload-pack'),
  )
  assertEquals(one.status, 400)
  assertStringIncludes(await one.text(), 'protocol v2 only')
  let two = advertise(
    new Request('http://x/a.git/info/refs?service=git-receive-pack', {
      headers: V2,
    }),
  )
  assertEquals(two.status, 404)
})

test('ls-refs answers HEAD as a symbolic ref, then the refs', async () => {
  let { said } = await command('ls-refs', [
    'peel',
    'symrefs',
    'ref-prefix HEAD',
    'ref-prefix refs/',
  ])
  assertEquals(
    said,
    `0050${TWO_OID} HEAD symref-target:refs/heads/main\n` +
      `003d${TWO_OID} refs/heads/main\n0000`,
  )
})

test('a fetch still negotiating is told nothing is common', async () => {
  let { said } = await command('fetch', [
    `want ${TWO_OID}`,
    `have ${'0'.repeat(40)}`,
  ])
  assertEquals(said, '0014acknowledgments\n0008NAK\n0000')
})

test('a want a ref reaches is served, though it is no tip itself', async () => {
  let { said } = await command('fetch', [`want ${ONE_OID}`, 'done'])
  assertStringIncludes(said, '000dpackfile\n')
})

test('a want no ref reaches is refused, and no pack is written', async () => {
  // The refs say only the first commit, so the second is an object this graph
  // holds and will not serve: unpublished, and named only by guessing its id.
  let { said } = await command('fetch', [`want ${TWO_OID}`, 'done'], {
    list: () => Promise.resolve([{ name: 'refs/heads/main', oid: ONE_OID }]),
  })
  assertEquals(said, `0049ERR upload-pack: not our ref ${TWO_OID}`)
})

test('a want of something we never had is not our ref either', async () => {
  let { said } = await command('fetch', [`want ${'f'.repeat(40)}`, 'done'])
  assertStringIncludes(said, `ERR upload-pack: not our ref ${'f'.repeat(40)}`)
})

test('a command we do not have, and a hash we do not serve', async () => {
  assertStringIncludes(
    (await command('object-info', [])).said,
    'unknown command object-info',
  )
  let { refs, from } = await repo()
  let res = await uploadPack(
    post([
      pkt('command=fetch\n'),
      pkt('object-format=sha256\n'),
      mark(DELIM),
      mark(FLUSH),
    ]),
    refs,
    from,
  )
  assertStringIncludes(
    text.decode(new Uint8Array(await res.arrayBuffer())),
    'only sha1',
  )
})

test('the packfile section is side-band framed, band 1', async () => {
  let { said } = await command('fetch', [
    `want ${TWO_OID}`,
    'done',
    'no-progress',
  ])
  assertStringIncludes(said, '000dpackfile\n')
  assertStringIncludes(said, '\x01PACK')
  assertEquals(said.endsWith('0000'), true)
})

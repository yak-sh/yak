// The wire, checked twice: against the spec's own bytes, and against git.
//
// The byte tests are the ones that catch a format mistake by name — the
// advertisement git reads before it trusts anything, and the answers to the
// two commands. The last test is the whole thing at once: a real `git clone`
// over a real socket, then `git log` and `git fsck` in what it wrote, which is
// the only judge of a clone that cannot be argued with.

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
} from './harness.ts'

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

Deno.test('the advertisement is the service line and what we implement', async () => {
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

Deno.test('a client that cannot say v2, and a service we do not serve', async () => {
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

Deno.test('ls-refs answers HEAD as a symbolic ref, then the refs', async () => {
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

Deno.test('a fetch still negotiating is told nothing is common', async () => {
  let { said } = await command('fetch', [
    `want ${TWO_OID}`,
    `have ${'0'.repeat(40)}`,
  ])
  assertEquals(said, '0014acknowledgments\n0008NAK\n0000')
})

Deno.test('a want a ref reaches is served, though it is no tip itself', async () => {
  let { said } = await command('fetch', [`want ${ONE_OID}`, 'done'])
  assertStringIncludes(said, '000dpackfile\n')
})

Deno.test('a want no ref reaches is refused, and no pack is written', async () => {
  // The refs say only the first commit, so the second is an object this graph
  // holds and will not serve: unpublished, and named only by guessing its id.
  let { said } = await command('fetch', [`want ${TWO_OID}`, 'done'], {
    list: () => Promise.resolve([{ name: 'refs/heads/main', oid: ONE_OID }]),
  })
  assertEquals(said, `0049ERR upload-pack: not our ref ${TWO_OID}`)
})

Deno.test('a want of something we never had is not our ref either', async () => {
  let { said } = await command('fetch', [`want ${'f'.repeat(40)}`, 'done'])
  assertStringIncludes(said, `ERR upload-pack: not our ref ${'f'.repeat(40)}`)
})

Deno.test('a command we do not have, and a hash we do not serve', async () => {
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

Deno.test('the packfile section is side-band framed, band 1', async () => {
  let { said } = await command('fetch', [
    `want ${TWO_OID}`,
    'done',
    'no-progress',
  ])
  assertStringIncludes(said, '000dpackfile\n')
  assertStringIncludes(said, '\x01PACK')
  assertEquals(said.endsWith('0000'), true)
})

// git itself, with the exit code as the assertion and no config of the
// machine's own in scope.
let run = async (...args: string[]) => {
  let { code, stdout, stderr } = await new Deno.Command('git', {
    args,
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    },
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  assertEquals(code, 0, `git ${args.join(' ')}: ${text.decode(stderr)}`)
  return text.decode(stdout)
}

// The two doors on a socket of their own, cloned into a temp directory, and
// both taken down however the test ends.
let cloned = async (
  refs: Refs,
  from: ReturnType<typeof objects>,
  check: (dir: string, git: typeof run) => Promise<void>,
) => {
  let server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    let path = new URL(req.url).pathname
    if (path == '/a.git/info/refs') return advertise(req)
    if (path == '/a.git/git-upload-pack') return uploadPack(req, refs, from)
    return new Response('no', { status: 404 })
  })
  let dir = await Deno.makeTempDir({ prefix: 'yaks-clone-' })
  try {
    let url = `http://127.0.0.1:${server.addr.port}/a.git`
    await run('-c', 'protocol.version=2', 'clone', '--quiet', url, `${dir}/a`)
    await check(`${dir}/a`, run)
  } finally {
    await server.shutdown()
    await Deno.remove(dir, { recursive: true })
  }
}

// The whole door, judged by git: clone it, read the history, check the objects.
Deno.test('git clones it, and finds nothing wrong with what it got', async () => {
  let { refs, from } = await repo()
  await cloned(refs, from, async (at, git) => {
    assertEquals(
      await git('-C', at, 'log', '--format=%s'),
      'deploy 2\ndeploy 1\n',
    )
    assertEquals(await Deno.readTextFile(`${at}/lib/a.txt`), X)
    assertEquals(await git('-C', at, 'rev-parse', 'HEAD'), TWO_OID + '\n')
    assertEquals(
      await git('-C', at, 'symbolic-ref', 'HEAD'),
      'refs/heads/main\n',
    )
    await git('-C', at, 'fsck', '--strict')
  })
})

// A pack past one packet, which is where a hand-written side-band goes wrong:
// the last chunk is short, the ones before it are exactly BAND, and a client
// that reassembles them off by one byte gets a corrupt pack rather than an
// error. Incompressible bytes, so the pack is as big as the file.
Deno.test('a pack too big for one packet arrives whole', async () => {
  let { g, git: index, bytes } = fixture()
  // 64k is all the entropy one call gives, and hex of random bytes deflates to
  // about half its length — so four of them is a pack of a few packets.
  let big = Array.from({ length: 4 }, () =>
    Array.from(
      crypto.getRandomValues(new Uint8Array(65536)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')).join('')
  let tree = await index.files({ 'big.txt': file(bytes, big) })
  let head = await index.commit({
    tree,
    author: AUTHOR,
    committer: COMMITTER,
    message: 'one big file',
  })
  let refs: Refs = {
    list: () => Promise.resolve([{ name: 'refs/heads/main', oid: head.oid }]),
  }
  await cloned(refs, objects(g, bytes), async (at, git) => {
    assertEquals(await Deno.readTextFile(`${at}/big.txt`), big)
    await git('-C', at, 'fsck', '--strict')
  })
})

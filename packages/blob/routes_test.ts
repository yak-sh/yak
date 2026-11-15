import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { derivedEid, type Graph, graph } from '@yaks/graph'
import { type Authenticate, type Route, routed } from '@yaks/api'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { tally } from '@yaks/sql'
import { type Blobs, memoryBlobs } from './store.ts'
import { ram } from '@yaks/ram'
import { addressOf, type Artifact, artifactDoc } from './artifact.ts'
import { mem, memoryBucket } from './testing.ts'
import { bucketObjects, objectBlobs } from './object.ts'
import { memoryMultipart } from './parts.ts'
import { fold, START } from './sha256.ts'
import { type Backend, type Options, PREFIX, routes } from './routes.ts'
import { useOf } from './upload.ts'
import { blobSchema, sqliteBlobs } from './sqlite.ts'
import { representations } from './representation_rules.ts'

let ANA = derivedEid('fixture:ana')

// The spine, which no package's own document declares: a host composes it from
// its kernel, and a test needs the two properties a bundle is addressed by.
let spine: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A host's provenance marks, so a test can ask who an upload was by.
    // Both of them: the stamp rules ensure `updated` on any entity that
    // already wears `created`, so declaring one without the other is a
    // vocabulary no host has.
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', stamped: true },
        by: { type: 'string', stamped: true },
      },
    },
    updated: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', stamped: true },
        by: { type: 'string', stamped: true },
      },
    },
  },
}

let vocab = loadVocab([spine, artifactDoc])

// A host as `routes` reads one: a blob store and a graph. The driver stays
// outside the host, available only for assertions about the stored bytes.
let host = () => {
  let sql = mem()
  let db = storage(sql, vocab)
  for (let stmt of [...db.ddl(), ...blobSchema()]) sql.query(stmt)
  return {
    driver: sql,
    blobs: sqliteBlobs(db.statements),
    graph: graph({ storage: db, vocab, plugins: [representations()] }),
  }
}

let door = (
  h: { blobs?: Blobs; graph: Graph; who?: Authenticate; artifacts?: Blobs },
  options?: Options,
) => {
  let table: Route[] = routes(h, options)
  return (request: Request) => {
    let path = new URL(request.url).pathname
    let route = table.find((r) => routed(r, request.method, path))
    assert(route, `nothing answers ${request.method} ${path}`)
    return route.handle(request)
  }
}

let at = (sha: string) => `http://host${PREFIX}${sha}`

let put = (sha: string, body: BodyInit, mime?: string) =>
  new Request(at(sha), {
    method: 'PUT',
    body,
    headers: mime ? { 'content-type': mime } : {},
  })

let text = new TextEncoder().encode('a long essay')
// A PNG's header: not valid UTF-8, which is what a text table cannot keep.
let png = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  13,
  0x49,
  0x48,
  0x44,
  0x52,
  ...new Array(21).fill(0),
])

let pngAddress = await addressOf(png)
let suppliedBlobs = memoryBlobs()
let suppliedGraph = graph({
  storage: ram(vocab),
  vocab,
  provenance: false,
  plugins: [representations()],
})
let suppliedDoor = door({ blobs: suppliedBlobs, graph: suppliedGraph })
let suppliedUpload = put(pngAddress, png, 'image/png')

test('a PUT to an address stores the bytes and mints the artifact', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  let made = await ask(put(sha, text, 'text/plain; charset=utf-8'))
  assertEquals(made.status, 200)
  // The media type is kept without its parameters — it becomes a header.
  let file = await made.json()
  let use = await useOf(sha)
  assertEquals(file, {
    eid: sha,
    attachment: use,
    url: made.headers.get('location'),
    mime: 'text/plain',
    bytes: text.length,
  })
  let [row] = await h.graph.read(`.entity.eid=${sha}`)
  assertEquals((row.artifact as Artifact).size, text.length)
  // …and beside the artifact, its use: what it is called and what it is.
  let [named] = await h.graph.read(`.entity.eid=${use}`)
  assertEquals(named.attachment, { artifact: sha, media_type: 'text/plain' })

  let versioned = new URL(file.url, at(sha)).href
  let alias = await ask(new Request(at(sha)))
  assertEquals(alias.status, 302)
  assertEquals(alias.headers.get('location'), versioned)
  assertEquals(alias.headers.get('cache-control'), 'private, max-age=604800')
  let got = await ask(new Request(versioned))
  assertEquals(got.status, 200)
  assertEquals(new Uint8Array(await got.arrayBuffer()), text)
  // The snapshot, rather than the editable artifact row, names the headers.
  assertEquals(got.headers.get('content-type'), 'text/plain')
  assertEquals(
    got.headers.get('cache-control'),
    'private, max-age=31536000, immutable',
  )
  let part = await ask(
    new Request(versioned, {
      headers: { range: 'bytes=2-5' },
    }),
  )
  assertEquals(part.status, 206)
  assertEquals(part.headers.get('content-range'), `bytes 2-5/${text.length}`)
  assertEquals(new Uint8Array(await part.arrayBuffer()), text.slice(2, 6))
  let head = await ask(new Request(versioned, { method: 'HEAD' }))
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('content-length'), String(text.length))
})

// Supply the bytes at load: each case checks one door, not an upload and
// subsequent download charged to the same timer.
let suppliedMade = await suppliedDoor(suppliedUpload)
let suppliedLocation = new URL(
  suppliedMade.headers.get('location')!,
  at(pngAddress),
)
test('the default backend uploads through supplied blobs without a SQL host', async () => {
  assertEquals(suppliedMade.status, 200)
  assertEquals(await suppliedBlobs.get(pngAddress), png)
})
test('the default backend serves supplied blobs without a SQL host', async () => {
  let got = await suppliedDoor(new Request(suppliedLocation))
  assertEquals(new Uint8Array(await got.arrayBuffer()), png)
})

test('the same upload twice is one object and one row', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  await ask(put(sha, text, 'text/plain'))
  let again = await ask(put(sha, text, 'text/plain'))
  assertEquals(again.status, 200)
  assertEquals(tally(h.driver, 'blob_text'), 1)
  assertEquals((await h.graph.read('.artifact')).length, 1)
  assertEquals((await h.graph.read('.representation')).length, 1)
})

test('a changed text type gets a new URL without changing the old one', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  let plain = await ask(put(sha, text, 'text/plain'))
  let markdown = await ask(put(sha, text, 'text/markdown'))
  let old = new URL(plain.headers.get('location')!, at(sha)).href
  let next = new URL(markdown.headers.get('location')!, at(sha)).href
  assert(old != next)
  assertEquals((await ask(new Request(at(sha)))).headers.get('location'), next)
  assertEquals(
    (await ask(new Request(old))).headers.get('content-type'),
    'text/plain',
  )
  assertEquals(
    (await ask(new Request(next))).headers.get('content-type'),
    'text/markdown',
  )
  let id = old.split('/').pop()!
  await assertRejects(
    async () => await h.graph.apply([{ entity: { eid: id }, $delete: true }]),
    Error,
    'cannot be deleted',
  )
  await assertRejects(
    async () => await h.graph.apply([{ entity: { eid: id }, tombstone: {} }]),
    Error,
    'cannot be deleted',
  )
  assertEquals((await ask(new Request(old))).status, 200)
  await assertRejects(
    async () =>
      await h.graph.apply([{
        entity: { eid: id },
        representation: { media_type: 'application/javascript' },
      }], { trusted: true }),
    Error,
    'cannot change',
  )
})

test('an existing bare address gains a stable type on its first read', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  h.blobs.put(sha, text)
  await h.graph.apply([{
    entity: { eid: sha },
    artifact: { address: sha, media_type: 'text/markdown', size: text.length },
  }])
  let alias = await ask(new Request(at(sha)))
  assertEquals(alias.status, 302)
  let versioned = alias.headers.get('location')!
  let got = await ask(new Request(versioned))
  assertEquals(got.headers.get('content-type'), 'text/markdown')
  assertEquals(new Uint8Array(await got.arrayBuffer()), text)
  assertEquals((await h.graph.read('.representation')).length, 1)
  assertEquals(
    (await ask(new Request(at(sha)))).headers.get('location'),
    versioned,
  )
})

test('bytes that do not hash to their address are refused, and nothing lands', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  let res = await ask(put(sha, 'something else', 'text/plain'))
  assertEquals(res.status, 400)
  assert((await res.json()).message.startsWith('these bytes address '))
  assertEquals((await h.graph.read(`.entity.eid=${sha}`)).length, 0)
  assertEquals(tally(h.driver, 'blob_text'), 0)
})

test('an address is 64 hex digits, whichever way the request points', async () => {
  let h = host(), ask = door(h)
  assertEquals((await ask(new Request(at('etc/passwd')))).status, 404)
  assertEquals((await ask(new Request(at(`${'a'.repeat(63)}Z`)))).status, 404)
  assertEquals((await ask(put('nonsense', text))).status, 400)
})

test('an upload past the limit is refused', async () => {
  let h = host(), ask = door(h, { limit: 4 })
  let sha = await addressOf(text)
  let res = await ask(put(sha, text, 'text/plain'))
  assertEquals(res.status, 413)
  assertEquals((await h.graph.read('.artifact')).length, 0)
})

test('a text store that cannot keep the bytes says so at the write', async () => {
  let h = host(), ask = door(h)
  let sha = pngAddress
  let res = await ask(put(sha, png, 'image/png'))
  assertEquals(res.status, 500)
  // and the store kept nothing: an address that answered mangled bytes is the
  // one thing content addressing promises never happens
  assertEquals(tally(h.driver, 'blob_text'), 0)
  assertEquals((await ask(new Request(at(sha)))).status, 404)
  // and no row names an object nothing holds
  assertEquals((await h.graph.read('.artifact')).length, 0)
})

test('the store a host names is where the bytes land', async () => {
  let { bucket, held: cells } = memoryBucket()
  let h = host()
  let ask = door(h, { store: { via: 'object', bucket, prefix: 'art/' } })
  let sha = pngAddress
  let made = await ask(put(sha, png, 'image/png'))
  assertEquals(made.status, 200)
  assertEquals([...cells.keys()], [`art/${sha}`])
  let got = await ask(
    new Request(new URL(made.headers.get('location')!, at(sha))),
  )
  assertEquals(new Uint8Array(await got.arrayBuffer()), png)
  assertEquals(got.headers.get('content-type'), 'image/png')
  // and the database kept nothing but the row
  assertEquals(tally(h.driver, 'blob_text'), 0)
})

test('the bound is on the bytes, not on what a header claimed', async () => {
  let h = host(), ask = door(h, { limit: 4 })
  let streamed = new Request(at(await addressOf(text)), {
    method: 'PUT',
    // a body with no content-length at all
    body: new ReadableStream<Uint8Array>({
      start: (c) => (c.enqueue(text), c.close()),
    }),
    duplex: 'half',
  } as RequestInit)
  assertEquals(streamed.headers.get('content-length'), null)
  assertEquals((await ask(streamed)).status, 413)
})

test('a store nobody can build mounts no door, and says why', () => {
  let h = host()
  let warned: unknown[] = []
  let warn = console.warn
  console.warn = (...said: unknown[]) => warned.push(said[0])
  try {
    // Missing config never stops the host: there is simply no door, so an
    // upload is refused where it is attempted rather than answered into
    // nothing.
    assertEquals(routes(h, { store: { via: 'file' } as Backend }), [])
    assertEquals(
      routes(h, { store: { via: 'bucket' } as unknown as Backend }),
      [],
    )
  } finally {
    console.warn = warn
  }
  assert(String(warned[0]).includes('needs `dir`'), String(warned[0]))
  assert(
    String(warned[1]).includes('no store called "bucket"'),
    String(warned[1]),
  )
})

test('an upload is by whoever the door says is calling', async () => {
  let h = host()
  // The host's own answer to "who is this", as `@yaks/cli` composes it from
  // the plugins: a route reads it rather than writing as nobody.
  let ask = door({ ...h, who: () => ({ by: ANA }) })
  let sha = await addressOf(text)
  assertEquals((await ask(put(sha, text))).status, 200)
  let [row] = await h.graph.read(`.entity.eid=${sha}`)
  assertEquals((row.created as { by: string }).by, ANA)
})

test('a door that knows nobody uploads as nobody, not as the caller', async () => {
  let h = host()
  let ask = door({ ...h, who: () => null })
  let sha = await addressOf(text)
  assertEquals((await ask(put(sha, text))).status, 200)
  let [row] = await h.graph.read(`.entity.eid=${sha}`)
  assertEquals((row.created as { by?: string }).by, undefined)
})

// A door over a bucket in memory, which takes uploads in parts of 64 bytes.
let bucketed = (options: Options = {}) => {
  let { bucket, held } = memoryBucket()
  let g = graph({
    storage: ram(vocab),
    vocab,
    provenance: false,
    plugins: [representations()],
  })
  let ask = door({ graph: g, artifacts: objectBlobs(bucket, 'app/') }, {
    parts: {
      objects: bucketObjects(bucket),
      bucket: memoryMultipart(bucket.put),
      prefix: 'app/',
      ledger: 'ledger/',
      part: 64,
    },
    ...options,
  })
  return { ask, held, g }
}

let sent = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://host/blob', { method: 'POST', body, headers })

test('bytes handed to the door are kept as named and typed, once', async () => {
  let { ask, g } = bucketed()
  let name = { 'x-yak-name': encodeURIComponent('ça.png') }
  let made = await ask(sent(png, { 'content-type': 'image/png', ...name }))
  let file = await made.json()
  assertEquals([file.eid, file.attachment, file.mime, file.bytes], [
    pngAddress,
    await useOf(pngAddress),
    'image/png',
    png.length,
  ])
  // The same bytes with no name, and no type, are the same file as named.
  let again = await (await ask(sent(png))).json()
  assertEquals([again.eid, again.url], [file.eid, file.url])
  let uses = await g.read('.attachment')
  assertEquals(uses.map((r) => r.attachment), [{
    artifact: pngAddress,
    media_type: 'image/png',
    name: 'ça.png',
  }])
  let got = await ask(new Request(`http://host${file.url}`))
  assertEquals(new Uint8Array(await got.arrayBuffer()), png)
  let none = await ask(sent(new Uint8Array()))
  assertEquals([none.status, (await none.json()).code], [400, 'no_bytes'])
})

test('every upload is held to what the store takes', async () => {
  for (
    let [options, status, code, says] of [
      [{ limit: 4 }, 413, 'too_large', 'a file is at most 4 B here'],
      [
        { accepts: { maxLength: 4 } },
        413,
        'too_large',
        'this app takes files of at most 4 B',
      ],
      [
        { accepts: { contentMediaType: 'image/*' } },
        415,
        'unsupported_media_type',
        'this app takes image/*, and this file is text/plain',
      ],
      [{ room: () => 'ada is full' }, 413, 'space_full', 'ada is full'],
    ] as [Options, number, string, string][]
  ) {
    let { ask, held, g } = bucketed(options)
    let sha = await addressOf(text)
    for (
      let refused of [
        await ask(sent(text, { 'content-type': 'text/plain' })),
        await ask(put(sha, text, 'text/plain')),
      ]
    ) {
      let { code: said, message } = await refused.json()
      assertEquals([refused.status, said, message], [status, code, says])
    }
    assertEquals([held.size, (await g.read('.attachment')).length], [0, 0])
  }
})

// Part n of `bytes` as a page sends it: its bytes, and where the hash stood.
let part = (sha: string, bytes: Uint8Array, n: number) => {
  let body = bytes.slice((n - 1) * 64, n * 64)
  return new Request(`http://host/blob/${sha}/${n}`, {
    method: 'PUT',
    body,
    headers: {
      'x-yak-state': fold(START, bytes.slice(0, (n - 1) * 64)),
      'content-length': String(body.length),
    },
  })
}

// Where an upload in parts of `bytes` bytes stands, asked as a page asks.
let stand = (ask: ReturnType<typeof door>, sha: string, said: object) =>
  ask(
    new Request(`http://host/blob/${sha}`, {
      method: 'POST',
      body: JSON.stringify(said),
    }),
  )

test('an upload in parts lands whole once its parts chain to its address', async () => {
  let { ask, g } = bucketed()
  let bytes = new Uint8Array(150).map((_, i) => i)
  let sha = await addressOf(bytes)
  let said = { bytes: 150, name: 'run.bin' }
  assertEquals(await (await stand(ask, sha, said)).json(), {
    part: 64,
    need: [1, 2, 3],
  })
  assertEquals(await (await ask(part(sha, bytes, 2))).json(), { n: 2 })
  assertEquals((await (await stand(ask, sha, said)).json()).need, [1, 3])
  for (let n of [1, 3]) await ask(part(sha, bytes, n))
  let file = await (await stand(ask, sha, said)).json()
  assertEquals([file.eid, file.bytes], [sha, 150])
  let [use] = await g.read('.attachment')
  assertEquals((use.attachment as { name: string }).name, 'run.bin')
  let got = await ask(new Request(`http://host${file.url}`))
  assertEquals(new Uint8Array(await got.arrayBuffer()), bytes)
})

test('a whole in parts the store does not take is let go of again', async () => {
  let { ask, held } = bucketed({ accepts: { contentMediaType: 'image/*' } })
  let sha = await addressOf(text)
  let said = { bytes: text.length }
  await stand(ask, sha, said)
  await ask(part(sha, text, 1))
  assertEquals((await stand(ask, sha, said)).status, 415)
  assert(!held.has(`app/${sha}`))
  assertEquals((await (await stand(ask, sha, said)).json()).need, [1])
})

test('a door with no bucket for parts refuses them', async () => {
  let ask = door(host(), { limit: 64 })
  let sha = 'a'.repeat(64)
  assertEquals((await stand(ask, sha, { bytes: 65 })).status, 413)
  assertEquals((await stand(ask, sha, { bytes: 64 })).status, 501)
})

test('bytes no row names any more are not served', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  let file = await (await ask(put(sha, text, 'text/plain'))).json()
  let read = () => ask(new Request(`http://host${file.url}`))
  assertEquals((await read()).status, 200)
  await h.graph.apply([
    { entity: { eid: sha }, artifact: null },
    { entity: { eid: file.attachment }, attachment: null },
  ])
  assertEquals((await read()).status, 404)
  assertEquals((await ask(new Request(at(sha)))).status, 404)
})

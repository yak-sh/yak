import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Graph, graph } from '@yaks/graph'
import { type Authenticate, type Route, routed } from '@yaks/api'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { type Driver, tally } from '@yaks/sql'
import { addressOf, type Artifact, artifactDoc } from './artifact.ts'
import { mem } from './testing.ts'
import type { Bucket } from './object.ts'
import { type Backend, type Options, PREFIX, routes } from './routes.ts'
import { blobSchema, sqliteBlobs } from './sqlite.ts'
import { representations } from './representation_rules.ts'

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

// A host as `routes` reads one: a connection, and a graph over it.
let host = (): { sql: Driver; graph: Graph } => {
  let sql = mem()
  let db = storage(sql, vocab)
  for (let stmt of [...db.ddl(), ...blobSchema()]) sql.query(stmt)
  return {
    sql,
    graph: graph({ storage: db, vocab, plugins: [representations()] }),
  }
}

let door = (
  h: { sql: Driver; graph: Graph; who?: Authenticate },
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

test('a PUT to an address stores the bytes and mints the artifact', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  let made = await ask(put(sha, text, 'text/plain; charset=utf-8'))
  assertEquals(made.status, 200)
  // The media type is kept without its parameters — it becomes a header.
  assertEquals(await made.json(), {
    address: sha,
    media_type: 'text/plain',
    size: text.length,
  })
  let [row] = await h.graph.read(`.entity.eid=${sha}`)
  assertEquals((row.artifact as Artifact).size, text.length)

  let versioned = new URL(made.headers.get('location')!, at(sha)).href
  let alias = await ask(new Request(at(sha)))
  assertEquals(alias.status, 302)
  assertEquals(alias.headers.get('location'), versioned)
  assertEquals(alias.headers.get('cache-control'), 'public, no-cache')
  let got = await ask(new Request(versioned))
  assertEquals(got.status, 200)
  assertEquals(new Uint8Array(await got.arrayBuffer()), text)
  // The snapshot, rather than the editable artifact row, names the headers.
  assertEquals(got.headers.get('content-type'), 'text/plain')
  assertEquals(
    got.headers.get('cache-control'),
    'public, max-age=31536000, immutable',
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

test('the same upload twice is one object and one row', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  await ask(put(sha, text, 'text/plain'))
  let again = await ask(put(sha, text, 'text/plain'))
  assertEquals(again.status, 200)
  assertEquals(tally(h.sql, 'blob_text'), 1)
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
  sqliteBlobs(h.sql).put(sha, text)
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
  assertEquals(tally(h.sql, 'blob_text'), 0)
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
  let sha = await addressOf(png)
  let res = await ask(put(sha, png, 'image/png'))
  assertEquals(res.status, 500)
  // and the store kept nothing: an address that answered mangled bytes is the
  // one thing content addressing promises never happens
  assertEquals(tally(h.sql, 'blob_text'), 0)
  assertEquals((await ask(new Request(at(sha)))).status, 404)
  // and no row names an object nothing holds
  assertEquals((await h.graph.read('.artifact')).length, 0)
})

test('the store a host names is where the bytes land', async () => {
  let cells = new Map<string, Uint8Array>()
  let bucket: Pick<Bucket, 'head' | 'get' | 'put'> = {
    head: (key) => {
      let bytes = cells.get(key)
      return Promise.resolve(
        bytes ? { size: bytes.byteLength, etag: key } : null,
      )
    },
    get: (key, options) => {
      let found = cells.get(key)
      let at = options?.range.offset ?? 0
      let end = at + (options?.range.length ?? found?.byteLength ?? 0)
      let part = found?.slice(at, end)
      return Promise.resolve(
        part
          ? {
            etag: key,
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(part)
                controller.close()
              },
            }),
            arrayBuffer: () => Promise.resolve(part.buffer as ArrayBuffer),
          }
          : null,
      )
    },
    put: (key, value) => {
      cells.set(key, new Uint8Array(value as Uint8Array))
      return Promise.resolve()
    },
  }
  let h = host()
  let ask = door(h, { store: { via: 'object', bucket, prefix: 'art/' } })
  let sha = await addressOf(png)
  let made = await ask(put(sha, png, 'image/png'))
  assertEquals(made.status, 200)
  assertEquals([...cells.keys()], [`art/${sha}`])
  let got = await ask(
    new Request(new URL(made.headers.get('location')!, at(sha))),
  )
  assertEquals(new Uint8Array(await got.arrayBuffer()), png)
  assertEquals(got.headers.get('content-type'), 'image/png')
  // and the database kept nothing but the row
  assertEquals(tally(h.sql, 'blob_text'), 0)
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
  let ask = door({ ...h, who: () => ({ by: 'ana' }) })
  let sha = await addressOf(text)
  assertEquals((await ask(put(sha, text))).status, 200)
  let [row] = await h.graph.read(`.entity.eid=${sha}`)
  assertEquals((row.created as { by: string }).by, 'ana')
})

test('a door that knows nobody uploads as nobody, not as the caller', async () => {
  let h = host()
  let ask = door({ ...h, who: () => null })
  let sha = await addressOf(text)
  assertEquals((await ask(put(sha, text))).status, 200)
  let [row] = await h.graph.read(`.entity.eid=${sha}`)
  assertEquals((row.created as { by: string | null }).by, null)
})

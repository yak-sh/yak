import { assert, assertEquals, assertThrows } from '@std/assert'
import { type Graph, graph } from '@yaks/graph'
import { type Route, routed } from '@yaks/api'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { addressOf, type Artifact, artifactDoc } from './artifact.ts'
import type { Driver } from './driver.ts'
import { mem } from './harness.ts'
import type { Bucket } from './object.ts'
import { type Backend, type Options, PREFIX, routes } from './routes.ts'
import { blobSchema } from './sqlite.ts'

// The spine, which no package's own document declares: a host composes it
// from its kernel, and a test needs the two columns a bundle is addressed by.
let spine: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}

let vocab = loadVocab([spine, artifactDoc])

// A host as `routes` reads one: a connection, and a graph over it.
let host = (): { sql: Driver; graph: Graph } => {
  let sql = mem()
  let db = storage(sql, vocab)
  for (let stmt of [...db.ddl(), ...blobSchema()]) sql.exec(stmt)
  return { sql, graph: graph({ storage: db, vocab, plugins: [] }) }
}

let door = (h: { sql: Driver; graph: Graph }, options?: Options) => {
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
// A PNG's first bytes: not valid UTF-8, which is what a text table cannot keep.
let png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

Deno.test('a PUT to an address stores the bytes and mints the artifact', async () => {
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
  let [row] = await h.graph.read(`.eid=${sha}`)
  assertEquals((row.artifact as Artifact).size, text.length)

  let got = await ask(new Request(at(sha)))
  assertEquals(got.status, 200)
  assertEquals(new Uint8Array(await got.arrayBuffer()), text)
  // The row is what the answer knows these bytes are.
  assertEquals(got.headers.get('content-type'), 'text/plain')
  assertEquals(
    got.headers.get('cache-control'),
    'public, max-age=31536000, immutable',
  )
})

Deno.test('the same upload twice is one object and one row', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  await ask(put(sha, text, 'text/plain'))
  let again = await ask(put(sha, text, 'text/plain'))
  assertEquals(again.status, 200)
  assertEquals(h.sql.query('select count(*) as n from blob_text', []), [{
    n: 1,
  }])
  assertEquals((await h.graph.read('.artifact')).length, 1)
})

Deno.test('bytes that do not hash to their address are refused, and nothing lands', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(text)
  let res = await ask(put(sha, 'something else', 'text/plain'))
  assertEquals(res.status, 400)
  assert((await res.json()).message.startsWith('these bytes address '))
  assertEquals((await h.graph.read(`.eid=${sha}`)).length, 0)
  assertEquals(h.sql.query('select count(*) as n from blob_text', []), [{
    n: 0,
  }])
})

Deno.test('an address is 64 hex digits, whichever way the request points', async () => {
  let h = host(), ask = door(h)
  assertEquals((await ask(new Request(at('etc/passwd')))).status, 404)
  assertEquals((await ask(new Request(at(`${'a'.repeat(63)}Z`)))).status, 404)
  assertEquals((await ask(put('nonsense', text))).status, 400)
})

Deno.test('an upload past the limit is refused', async () => {
  let h = host(), ask = door(h, { limit: 4 })
  let sha = await addressOf(text)
  let res = await ask(put(sha, text, 'text/plain'))
  assertEquals(res.status, 413)
  assertEquals((await h.graph.read('.artifact')).length, 0)
})

Deno.test('a text store that cannot keep the bytes says so at the write', async () => {
  let h = host(), ask = door(h)
  let sha = await addressOf(png)
  let res = await ask(put(sha, png, 'image/png'))
  assertEquals(res.status, 500)
  // and the store kept nothing: an address that answered mangled bytes is the
  // one thing content addressing promises never happens
  assertEquals(h.sql.query('select count(*) as n from blob_text', []), [{
    n: 0,
  }])
  assertEquals((await ask(new Request(at(sha)))).status, 404)
  // and no row names an object nothing holds
  assertEquals((await h.graph.read('.artifact')).length, 0)
})

Deno.test('the store a host names is where the bytes land', async () => {
  let cells = new Map<string, Uint8Array>()
  let bucket: Bucket = {
    head: (key) => Promise.resolve(cells.get(key) ?? null),
    get: (key) => {
      let found = cells.get(key)
      return Promise.resolve(
        found
          ? { arrayBuffer: () => Promise.resolve(found.slice().buffer) }
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
  assertEquals((await ask(put(sha, png, 'image/png'))).status, 200)
  assertEquals([...cells.keys()], [`art/${sha}`])
  let got = await ask(new Request(at(sha)))
  assertEquals(new Uint8Array(await got.arrayBuffer()), png)
  assertEquals(got.headers.get('content-type'), 'image/png')
  // and the database kept nothing but the row
  assertEquals(h.sql.query('select count(*) as n from blob_text', []), [{
    n: 0,
  }])
})

Deno.test('the bound is on the bytes, not on what a header claimed', async () => {
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

Deno.test('a store nobody can build refuses at compose, not at a request', () => {
  let h = host()
  assertThrows(
    () => routes(h, { store: { via: 'file' } as Backend }),
    Error,
    'needs `dir`',
  )
  assertThrows(
    () => routes(h, { store: { via: 'bucket' } as unknown as Backend }),
    Error,
    'no store called "bucket"',
  )
})

import { assert, assertEquals } from '@std/assert'
import { sha256 } from '@yaks/graph'
import { address, decode, encode } from './store.ts'
import { sqliteBlobs } from './sqlite.ts'
import { hydrate } from './hydrate.ts'
import { blog, mem } from './harness.ts'
import { blobSchema } from './sqlite.ts'

Deno.test('an address is the SHA-256 of the text, and nothing else', () => {
  assertEquals(address('a long essay'), sha256('a long essay'))
  assertEquals(address(''), sha256(''))
  assert(address('one') != address('two'))
})

Deno.test('text round-trips through the byte encoding', () => {
  for (let s of ['', 'plain', 'héllo — ✓', 'a\nb\tc']) {
    assertEquals(decode(encode(s)), s)
  }
})

let store = () => {
  let driver = mem()
  for (let stmt of blobSchema()) driver.exec(stmt)
  return sqliteBlobs(driver)
}

Deno.test('the sqlite backend stores, finds and answers for what it holds', () => {
  let s = store()
  let sha = address('a long essay')
  assertEquals(s.has(sha), false)
  assertEquals(s.get(sha), undefined)
  s.put(sha, encode('a long essay'))
  assertEquals(s.has(sha), true)
  assertEquals(decode(s.get(sha) as Uint8Array), 'a long essay')
  // writing the same address twice writes the same bytes twice
  s.put(sha, encode('a long essay'))
  assertEquals(decode(s.get(sha) as Uint8Array), 'a long essay')
})

Deno.test('a layout points the backend at a table it did not make', () => {
  let driver = mem()
  let layout = { table: 'body_text', key: 'entity', value: 'text' }
  for (let stmt of blobSchema(layout)) driver.exec(stmt)
  let s = sqliteBlobs(driver, layout)
  s.put('abc', encode('hello'))
  assertEquals(
    driver.query('select text from body_text where entity = ?', ['abc']),
    [{ text: 'hello' }],
  )
})

Deno.test('hydrate resolves a gathered bundle through any backend', async () => {
  let s = store()
  let sha = address('a long essay')
  s.put(sha, encode('a long essay'))
  let out = await hydrate(blog, s, [
    { entity: { eid: 'p1' }, post: { title: 'one', body: sha } },
    // an address nobody stored is left alone rather than lost
    { entity: { eid: 'p2' }, post: { body: 'deadbeef' } },
    // a bundle with no body column at all passes straight through
    { entity: { eid: 't1' }, tag: { label: 'x' } },
  ])
  assertEquals((out[0].post as Record<string, unknown>).body, 'a long essay')
  assertEquals((out[0].post as Record<string, unknown>).title, 'one')
  assertEquals((out[1].post as Record<string, unknown>).body, 'deadbeef')
  assertEquals(out[2], { entity: { eid: 't1' }, tag: { label: 'x' } })
})

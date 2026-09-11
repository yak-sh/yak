import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph'
import { address } from './store.ts'
import { blog, fixture } from './harness.ts'
import { blobs } from './plugin.ts'

let post = (b: Bundle) => b.post as Record<string, unknown>

Deno.test('a body goes in as text and comes back as text', () => {
  let { g, db } = fixture()
  let out = g.apply([
    { entity: { eid: 'p1' }, post: { title: 'one', body: 'a long essay' } },
  ]) as Bundle[]
  // what apply() returns is what the caller wrote — the swap is undone
  assertEquals(post(out[0]).body, 'a long essay')
  // and so is what a read gathers
  assertEquals(post(db.read('.post!')[0]).body, 'a long essay')
  assertEquals(post(db.read('.post!')[0]).title, 'one')
})

Deno.test('the row holds the address and the store holds the bytes', () => {
  let { g, driver } = fixture()
  g.apply([{ entity: { eid: 'p1' }, post: { body: 'a long essay' } }])
  let sha = address('a long essay')
  assertEquals(
    driver.query('select body from post', []),
    [{ body: sha }],
  )
  assertEquals(
    driver.query('select value from blob_text where sha = ?', [sha]),
    [{ value: 'a long essay' }],
  )
})

Deno.test('the same value written twice is stored once', () => {
  let { g, driver } = fixture()
  g.apply([
    { entity: { eid: 'p1' }, post: { body: 'shared' } },
    { entity: { eid: 'p2' }, post: { body: 'shared' } },
    { entity: { eid: 'p3' }, post: { body: 'other' } },
  ])
  assertEquals(driver.query('select count(*) as n from blob_text', []), [{
    n: 2,
  }])
})

for (let async of [false, true]) {
  Deno.test(`equal bodies are interned once per batch (${async ? 'async' : 'sync'})`, async () => {
    let { g, blobs: store, db } = fixture()
    let seen: string[] = [], references: string[] = []
    let plugin = blobs(blog, {
      ...store,
      has: (sha) => {
        seen.push(sha)
        return async ? Promise.resolve(store.has(sha)) : store.has(sha)
      },
      put: (sha, bytes) => {
        let result = store.put(sha, bytes)
        return async ? Promise.resolve(result) : result
      },
    }, {
      reference: (sha) => {
        references.push(sha)
        return async ? Promise.resolve(sha) : sha
      },
    })
    g.plugins.splice(0, g.plugins.length, plugin)
    // Empty text and independently constructed equal strings are values too.
    let values = ['', '', 'large '.repeat(10000), Array(10001).join('large ')]
    let result = g.apply(values.map((body, i) => ({
      entity: { eid: 'p' + i },
      post: { body },
    })))
    assertEquals(result instanceof Promise, async)
    assertEquals((await result).map((b) => post(b).body), values)
    let hashes = [address(values[0]), address(values[2])]
    assertEquals(seen, hashes)
    assertEquals(references, hashes)
    assertEquals(post(db.read('.eid=p3')[0]).body, values[3])
    // A second transaction checks its own store, rather than trusting a cache
    // retained by a previous successful hook invocation.
    await g.apply([{ entity: { eid: 'next' }, post: { body: values[2] } }])
    assertEquals(seen, [...hashes, hashes[1]])
    assertEquals(references, seen)
  })
}

Deno.test('interned references do not survive a rolled-back batch', () => {
  let { g, driver, db } = fixture()
  let fail = true
  g.plugins.push({
    name: 'refuse-after-blob-write',
    hooks: {
      commit: (bundles) => {
        if (fail) throw new Error('rollback')
        return bundles
      },
    },
  })
  let rows = () =>
    ['p1', 'p2'].map((eid) => ({
      entity: { eid },
      post: { body: 'shared' },
    }))
  assertThrows(() => g.apply(rows()), Error, 'rollback')
  assertEquals(driver.query('select count(*) as n from blob_text', []), [{
    n: 0,
  }])
  fail = false
  g.apply(rows())
  assertEquals(db.read('.post!').map((b) => post(b).body), ['shared', 'shared'])
  assertEquals(driver.query('select count(*) as n from blob_text', []), [{
    n: 1,
  }])
})

Deno.test('a bundle that names no body column is untouched', () => {
  let { g, db } = fixture()
  g.apply([
    { entity: { eid: 'p1' }, post: { title: 'one', body: 'first' } },
    { entity: { eid: 't1' }, tag: { label: 'x' } },
  ])
  // a patch that touches only the title leaves the body where it was
  g.apply([{ entity: { eid: 'p1' }, post: { title: 'two' } }])
  let one = db.read('.post!')[0]
  assertEquals([post(one).title, post(one).body], ['two', 'first'])
  assertEquals(db.read('.tag!').length, 1)
})

Deno.test('a body reads back through a query predicate too', () => {
  let { g, db } = fixture()
  g.apply([
    { entity: { eid: 'p1' }, post: { body: 'the rain in spain' } },
    { entity: { eid: 'p2' }, post: { body: 'nothing like it' } },
  ])
  // the filter resolves the address the same way the gather does, so a saved
  // query over a body column means one thing in both readers
  assertEquals(db.rows('.body~=spain').map((r) => r.eid), ['p1'])
  assertEquals(db.rows('.body="the rain in spain"').map((r) => r.eid), ['p1'])
})

Deno.test('the $was guard is hashed over the text, not the address', () => {
  let { g } = fixture()
  g.apply([{ entity: { eid: 'p1' }, post: { body: 'first' } }])
  // a writer that read 'first' may write over it
  g.apply([{
    entity: { eid: 'p1' },
    post: { body: 'second' },
    $was: { post: { body: token('first') } },
  }])
  let { g: g2 } = fixture()
  g2.apply([{ entity: { eid: 'p1' }, post: { body: 'first' } }])
  let stale = false
  try {
    g2.apply([{
      entity: { eid: 'p1' },
      post: { body: 'second' },
      $was: { post: { body: token('somebody else wrote this') } },
    }])
  } catch (e) {
    stale = (e as Error).name == 'Stale'
  }
  assert(stale, 'a guard on a moved body refuses the batch')
})

Deno.test('clearing a body clears the column, not the store', () => {
  let { g, db, driver } = fixture()
  g.apply([{ entity: { eid: 'p1' }, post: { body: 'a long essay' } }])
  g.apply([{ entity: { eid: 'p1' }, post: { body: null } }])
  assertEquals(post(db.read('.post!')[0]).body, null)
  // the bytes stay: another row may address them, and they cost one row
  assertEquals(driver.query('select count(*) as n from blob_text', []), [{
    n: 1,
  }])
})

Deno.test('a backend may address bodies by integer keys while echoing text', async () => {
  let { blobs } = await import('./plugin.ts')
  let { blog } = await import('./harness.ts')
  let { g, driver, blobs: store } = fixture()
  g.plugins.splice(
    0,
    g.plugins.length,
    blobs(blog, store, { reference: () => 42 }),
  )
  let out = g.apply([{
    entity: { eid: 'p' },
    post: { body: 'text' },
  }]) as Bundle[]
  assertEquals(post(out[0]).body, 'text')
  assertEquals(driver.query('select body from post', []), [{ body: '42' }])
  assertEquals(driver.query('select value from blob_text', []), [{
    value: 'text',
  }])
})

Deno.test('zero is a reusable backend reference, not a cache miss', () => {
  let { g, driver, blobs: store } = fixture()
  let calls = 0
  g.plugins.splice(
    0,
    g.plugins.length,
    blobs(blog, store, {
      reference: () => {
        calls++
        return 0
      },
    }),
  )
  let out = g.apply(['p1', 'p2'].map((eid) => ({
    entity: { eid },
    post: { body: 'shared' },
  }))) as Bundle[]
  assertEquals(calls, 1)
  assertEquals(out.map((b) => post(b).body), ['shared', 'shared'])
  assertEquals(driver.query('select body from post', []), [{ body: '0' }, {
    body: '0',
  }])
})

Deno.test('column selection leaves inline body columns alone', async () => {
  let { blobs } = await import('./plugin.ts')
  let { blog } = await import('./harness.ts')
  let { g, driver, blobs: store } = fixture()
  g.plugins.splice(0, g.plugins.length, blobs(blog, store, { columns: [] }))
  let out = g.apply([{
    entity: { eid: 'p' },
    post: { body: 'inline' },
  }]) as Bundle[]
  assertEquals(post(out[0]).body, 'inline')
  assertEquals(driver.query('select body from post', []), [{ body: 'inline' }])
  assertEquals(driver.query('select count(*) as n from blob_text', []), [{
    n: 0,
  }])
})

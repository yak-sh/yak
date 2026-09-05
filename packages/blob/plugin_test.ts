import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph'
import { address } from './store.ts'
import { fixture } from './harness.ts'

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
  assertEquals(db.rows('.body=the rain in spain').map((r) => r.eid), ['p1'])
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

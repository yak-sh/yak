// A body that lives in the store is still findable by its words. The row holds
// an address, so an index built straight over the column would hold hashes and
// a search would match titles alone; `blobText` is what a full-text index is
// handed so both its triggers and the view it reads back through resolve the
// address first.
//
// This is the composition an application makes — @yaks/blob's plugin over
// @yaks/sqlite's rows, @yaks/fts's index over the same tables — driven the way
// an application drives it: text in through `apply()`, words out through a
// search.

import { assert, assertEquals } from '@std/assert'
import { fields, find, schema } from '@yaks/fts'
import { blobText } from './sqlite.ts'
import { blog, fixture } from './harness.ts'

let text = fields(blog)

let shelf = () => {
  let f = fixture()
  for (let stmt of schema(text, blobText(blog))) f.driver.exec(stmt)
  return f
}

Deno.test('a body in the store is found by a word only the body says', () => {
  let { g, driver } = shelf()
  g.apply([{
    entity: { eid: 'p1' },
    post: { title: 'On lemons', body: 'three lemons and a drizzle of syrup' },
  }])
  // The row kept the address; the index kept the words.
  let [row] = driver.query(`select body from post where entity = 1`, [])
  assertEquals(String(row.body).includes('drizzle'), false)
  assertEquals(find(driver, text, 'drizzle').map((h) => h.entity), ['p1'])
  // The title still matches, and the snippet reads as prose rather than a hash.
  assertEquals(find(driver, text, 'lemons').map((h) => h.entity), ['p1'])
  assert(find(driver, text, 'drizzle')[0].snippet.includes('drizzle'))
})

Deno.test('a body written in the same batch as the row is indexed with it', () => {
  // The bytes go in on `precondition`, before the row that names them, so the
  // trigger resolving the address in the same transaction finds them there.
  let { g, driver } = shelf()
  g.apply([
    { entity: { eid: 'a' }, post: { body: 'a burglar meets a dragon' } },
    { entity: { eid: 'b' }, post: { body: 'riders defend a world' } },
  ])
  assertEquals(find(driver, text, 'dragon').map((h) => h.entity), ['a'])
  assertEquals(find(driver, text, 'riders').map((h) => h.entity), ['b'])
})

Deno.test('a rewritten body swaps its words, and a dead one takes them away', () => {
  let { g, driver } = shelf()
  g.apply([{ entity: { eid: 'p1' }, post: { body: 'a cook writes it down' } }])
  assertEquals(find(driver, text, 'cook').length, 1)
  g.apply([{ entity: { eid: 'p1' }, post: { body: 'a baker writes it down' } }])
  assertEquals(find(driver, text, 'cook').length, 0)
  assertEquals(find(driver, text, 'baker').map((h) => h.entity), ['p1'])
  // The component dropped: the delete side resolves the address the insert
  // side did, so the index is left holding nothing.
  g.apply([{ entity: { eid: 'p1' }, post: null }])
  assertEquals(find(driver, text, 'baker'), [])
})

Deno.test('the words are indexed on every write path, not just the plugin', () => {
  // A row written straight into the table — a restore, a repair, a migration —
  // goes through the same triggers, so the index holds prose for it too.
  let { driver } = shelf()
  driver.query(`insert into entity (id, eid, num) values (1, 'p1', 1)`, [])
  driver.query(`insert into blob_text (sha, value) values ('k1', ?)`, [
    'a cook writes down what the nights are like',
  ])
  driver.query(`insert into post (entity, body) values (1, 'k1')`, [])
  assertEquals(find(driver, text, 'nights').map((h) => h.entity), ['p1'])
})

// The schema a vocabulary implies: one identity table, one graveyard, one table
// per component, and the doc view plus its search index.

import { assert, assertEquals } from '@std/assert'
import { schema } from './ddl.ts'
import { shop } from './harness.ts'

let all = schema(shop).join('\n')

Deno.test('the shop vocabulary loads with its kinds and death words', () => {
  assertEquals(shop.all.includes('product'), true)
  assertEquals(shop.deaths('cascade'), [['review', 'product']])
  assertEquals(shop.deaths('detach'), [['product', 'maker']])
  assertEquals(shop.deaths('release'), [['bookmark', 'of']])
})

Deno.test('the spine and the graveyard are always present', () => {
  assert(/create table if not exists entity \(/.test(all), all)
  assert(all.includes('create table if not exists tombstone'), all)
})

Deno.test('every component gets a table keyed by an entity owner', () => {
  for (let comp of ['doc', 'product', 'review', 'bookmark']) {
    assert(
      new RegExp(`create table if not exists "${comp}" \\(`).test(all),
      `${comp} table missing`,
    )
  }
  // The spine component is the identity table, not a component table.
  assert(!all.includes('create table if not exists "entity"'), all)
})

Deno.test('a reference column stores an integer with a foreign key', () => {
  // product.maker is a reference — an integer id pointing at the spine.
  assert(/"maker" integer references entity\(id\)/.test(all), all)
})

Deno.test('a boolean column takes integer affinity, a text column text', () => {
  assert(/"available" integer/.test(all), all)
  assert(/"title" text/.test(all), all)
  assert(/"price" real/.test(all), all)
})

Deno.test('a doc vocabulary gets a doc_value view and a full-text index', () => {
  assert(all.includes('create view if not exists doc_value'), all)
  assert(/using fts5\(\s*"title", "body"/.test(all), all)
})

Deno.test('the statements list in dependency order — spine first', () => {
  let stmts = schema(shop)
  assertEquals(stmts[0].includes('create table if not exists entity ('), true)
})

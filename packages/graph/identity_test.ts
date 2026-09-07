// A component that names its own entity: what `identity` buys (identity.ts).
// The subject is a GUIDE PAGE, because that is what asked for it — a file
// loaded twice must be one entity, with no eid written down anywhere and no
// `$alias` that means anything outside its own batch.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import { Refused } from './admit.ts'
import { identityEid } from './identity.ts'
import { comp, memory } from './harness.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: { type: 'object', kind: true, properties: { title: {} } },
    // A page is its slug: two files with one slug are one page.
    guide: {
      type: 'object',
      kind: true,
      properties: {
        slug: { type: 'string', identity: true },
        brief: { type: 'string' },
      },
    },
    // The composite spelling: an app's release is its app and its version.
    release: {
      type: 'object',
      identity: ['app', 'version'],
      properties: { app: { type: 'string' }, version: { type: 'string' } },
    },
  },
}

let pages = loadVocab(doc)
let g = () => graph({ storage: memory(), vocab: pages })
let sync = (out: Bundle[] | Promise<Bundle[]>) => out as Bundle[]

let page = (alias: string, slug: string, brief: string): Bundle => ({
  entity: { eid: alias },
  doc: { title: slug },
  guide: { slug, brief },
})

Deno.test('a page is its slug: written twice, it is one entity', () => {
  let one = g()
  let first = sync(one.apply([page('$a', 'store', 'the store, from a page')]))
  let eid = identityEid('guide', ['store'])
  assertEquals(first[0].entity.eid, eid)
  assertEquals(first[0].$alias, '$a')

  // The same page again, under an alias that has nothing to do with the first
  // batch — the way a second load of the same file says it.
  let again = sync(one.apply([page('$whatever', 'store', 'said again')]))
  assertEquals(again[0].entity.eid, eid)
  // A patch of the entity that was already there, not a second birth.
  assert(again[0].entity.num == null, 'the second write minted a new entity')
  let [held] = one.storage.tx((tx) => tx.get([eid])) as Bundle[]
  assertEquals(comp(held, 'guide').brief, 'said again')
})

Deno.test('two slugs are two entities, and the id says which', () => {
  let one = g()
  let out = sync(one.apply([
    page('$a', 'store', 'one'),
    page('$b', 'querying', 'two'),
  ]))
  assertEquals(out.length, 2)
  assertEquals(
    out.map((b) => b.entity.eid),
    [identityEid('guide', ['store']), identityEid('guide', ['querying'])],
  )
})

Deno.test('an id that disagrees with the value it names is refused', () => {
  let one = g()
  assertThrows(
    () =>
      one.apply([{
        entity: { eid: '11111111-1111-4111-8111-111111111111' },
        guide: { slug: 'store' },
      }]),
    Refused,
    'an identity names the entity',
  )
})

Deno.test('a rename is refused: the slug is the entity, not a column', () => {
  let one = g()
  sync(one.apply([page('$a', 'store', 'one')]))
  assertThrows(
    () =>
      one.apply([{
        entity: { eid: identityEid('guide', ['store']) },
        guide: { slug: 'shop' },
      }]),
    Refused,
    'an identity names the entity',
  )
})

Deno.test('a patch that says nothing about the slug is ordinary', () => {
  let one = g()
  sync(one.apply([page('$a', 'store', 'one')]))
  let eid = identityEid('guide', ['store'])
  sync(one.apply([{ entity: { eid }, guide: { brief: 'two' } }]))
  let [held] = one.storage.tx((tx) => tx.get([eid])) as Bundle[]
  assertEquals(comp(held, 'guide').brief, 'two')
  assertEquals(comp(held, 'guide').slug, 'store')
})

Deno.test('a minted page with no slug is refused, by name', () => {
  let one = g()
  assertThrows(
    () => one.apply([{ entity: { eid: '$a' }, guide: { brief: 'nameless' } }]),
    Refused,
    'which is what identifies it',
  )
})

Deno.test('a composite identity is the whole tuple, in order', () => {
  let one = g()
  let out = sync(one.apply([{
    entity: { eid: '$r' },
    release: { app: 'recipes', version: '3' },
  }]))
  assertEquals(out[0].entity.eid, identityEid('release', ['recipes', '3']))
  // Order is part of the sentence: the other arrangement is another entity.
  assert(
    identityEid('release', ['recipes', '3']) !=
      identityEid('release', ['3', 'recipes']),
  )
})

Deno.test('an identity is a unique index, said out loud', () => {
  assertEquals(pages.identity('guide'), ['slug'])
  assertEquals(pages.identity('release'), ['app', 'version'])
  assertEquals(pages.identity('doc'), [])
  assertEquals(pages.indexes('guide'), [{ cols: ['slug'], unique: true }])
  assertEquals(pages.indexes('release'), [{
    cols: ['app', 'version'],
    unique: true,
  }])
})

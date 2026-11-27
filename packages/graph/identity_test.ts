// A component that names its own entity: what `identity` buys (identity.ts).
// The subject is a guide page, because that is what asked for it — a file
// loaded twice must be one entity, with no eid written down anywhere and no
// `$alias` that means anything outside its own batch.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import { Refused } from './admit.ts'
import { eidOf, identityEid, mint } from './identity.ts'
import { comp, memory } from './testing.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    // A page is its slug: two files with one slug are one page.
    guide: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        slug: { type: 'string', identity: true },
        brief: { type: 'string' },
      },
    },
    // The composite form: an app's release is its app and its version.
    release: {
      component: true,
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

test('a page is its slug: written twice, it is one entity', () => {
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
  let [held] = one.get([eid]) as Bundle[]
  assertEquals(comp(held, 'guide').brief, 'said again')
})

test('two slugs are two entities, and the id says which', () => {
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

test('an id that disagrees with the value it names is refused', () => {
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

test('a rename is refused: the slug is the entity, not a property', () => {
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

test('a patch that says nothing about the slug is ordinary', () => {
  let one = g()
  sync(one.apply([page('$a', 'store', 'one')]))
  let eid = identityEid('guide', ['store'])
  sync(one.apply([{ entity: { eid }, guide: { brief: 'two' } }]))
  let [held] = one.get([eid]) as Bundle[]
  assertEquals(comp(held, 'guide').brief, 'two')
  assertEquals(comp(held, 'guide').slug, 'store')
})

test('a minted page with no slug is refused, by name', () => {
  let one = g()
  assertThrows(
    () => one.apply([{ entity: { eid: '$a' }, guide: { brief: 'nameless' } }]),
    Refused,
    'which is what identifies it',
  )
})

test('a composite identity is the whole tuple, in order', () => {
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

test('an identity is a unique index, said out loud', () => {
  assertEquals(pages.identity('guide'), ['slug'])
  assertEquals(pages.identity('release'), ['app', 'version'])
  assertEquals(pages.identity('doc'), [])
  assertEquals(pages.indexes('guide'), [{ props: ['slug'], unique: true }])
  assertEquals(pages.indexes('release'), [{
    props: ['app', 'version'],
    unique: true,
  }])
})

let GUIDE = mint()
let named = (label: string, ns = '@test/guide', id = GUIDE): VocabDoc => ({
  label: ns,
  $defs: { [label]: { ...doc.$defs!.guide, $id: `urn:uuid:${id}` } },
})
let writing = (...words: VocabDoc[]) =>
  graph({ storage: memory(), vocab: loadVocab(words) })
let guide = (label: string, eid = '$page', brief = 'one'): Bundle => ({
  entity: { eid },
  [label]: { slug: 'store', brief },
})

test('renaming a component keeps its derived eid', () => {
  let before = named('guide')
  let [one] = sync(writing(before).apply([guide('guide')]))
  let [two] = sync(writing(named('handbook')).apply([guide('handbook')]))
  assertEquals(one.entity.eid, identityEid(GUIDE, ['store']))
  assertEquals(one.entity.eid, eidOf(before, 'guide')('store'))
  assertEquals(two.entity.eid, one.entity.eid)
})

test('equal values in two namespaces with the same label derive distinct eids', () => {
  let other = mint()
  let g = writing(named('guide'), named('guide', '@test/other', other))
  let out = sync(g.apply([
    guide('@test/guide:guide', '$one'),
    guide('@test/other:guide', '$two'),
  ]))
  assertEquals(
    out.map((b) => b.entity.eid),
    [GUIDE, other].map((id) => identityEid(id, ['store'])),
  )
})

test('retrying an identity patches the row at its legacy address', () => {
  let legacy = identityEid('guide', ['store'])
  let current = identityEid(GUIDE, ['store'])
  let g = writing(named('guide'))
  sync(g.apply([guide('guide', legacy)]))
  let [retry] = sync(g.apply([guide('guide', '$retry', 'two')]))
  assertEquals(retry.entity.eid, legacy)
  let [patch] = sync(g.apply([guide('guide', current, 'three')]))
  assertEquals(patch.entity.eid, legacy)
  let held = g.get([legacy, current]) as Bundle[]
  assertEquals(held.map((b) => b.entity.eid), [legacy])
  assertEquals(comp(held[0], 'guide').brief, 'three')
})

test('a batch resolves explicit addresses and an alias for the same identity together', () => {
  let legacy = identityEid('guide', ['store'])
  let current = identityEid(GUIDE, ['store'])
  let g = writing(named('guide'))
  let out = sync(g.apply([
    guide('guide', legacy),
    guide('guide', '$guide'),
    guide('guide', current),
  ]))
  assertEquals(out.map((b) => b.entity.eid), [current])
  assertEquals(out[0].$alias, '$guide')
  assertEquals((g.get([legacy, current]) as Bundle[]).length, 1)
})

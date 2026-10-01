// The vocabulary: what it declares, and the one thing that is a decision
// rather than a detail — `store` is named, never interpreted, so the document
// loads the same with and without @yaks/blob.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { blobKeywords } from '@yaks/blob'
import { BODY, DOC, docDoc, TITLE } from './comp.ts'
import { docs } from './plugin.ts'

let plain = loadVocab([docDoc])
let addressed = loadVocab([docDoc], [blobKeywords])

test('the document loads on its own, and ships one component', () => {
  assertEquals(plain.all, [DOC])
  assertEquals(plain.props(DOC), [TITLE, BODY])
  assertEquals(plain.comp(DOC)!.writable, [TITLE, BODY])
  assertEquals(plain.comp(DOC)!.stamped, [])
})

test('doc is a kind, ordered against nothing it does not ship', () => {
  assertEquals(plain.kinds, [DOC])
  assertEquals(plain.comp(DOC)!.before, [])
})

test('both properties are text', () => {
  for (let prop of [TITLE, BODY]) {
    assertEquals(plain.prop(DOC, prop)!.category, 'scalar')
  }
})

test('store is carried only by whoever registered the keyword', () => {
  assertEquals(plain.prop(DOC, BODY)!.keywords.store, undefined)
  assertEquals(addressed.prop(DOC, BODY)!.keywords.store, 'blob')
  // and it is an ordinary text property either way — where the value lives is
  // @yaks/blob's business, never the meta-model's
  for (let v of [plain, addressed]) {
    assertEquals(v.prop(DOC, BODY)!.scalar, 'text')
    assertEquals(v.prop(DOC, BODY)!.affinity, 'text')
  }
})

test('the plugin is the vocabulary and a name', () => {
  let p = docs()
  assertEquals(p.name, '@yaks/doc')
  assertEquals(p.vocab, [docDoc])
  assert(!p.hooks)
})

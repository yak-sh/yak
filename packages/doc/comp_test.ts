// The vocabulary: what it declares, and the one thing that is a decision
// rather than a detail — `store` is named, never interpreted, so the document
// loads the same with and without @yaks/blob.

import { assert, assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { blobKeywords } from '@yaks/blob'
import { BODY, DOC, docDoc, TITLE } from './comp.ts'
import { docs } from './plugin.ts'

let plain = loadVocab([docDoc])
let addressed = loadVocab([docDoc], [blobKeywords])

Deno.test('the document loads on its own, and ships one component', () => {
  assertEquals(plain.all, [DOC])
  assertEquals(plain.columns(DOC), [TITLE, BODY])
  assertEquals(plain.comp(DOC)!.writable, [TITLE, BODY])
  assertEquals(plain.comp(DOC)!.stamped, [])
})

Deno.test('doc is a kind, ordered against nothing it does not ship', () => {
  assertEquals(plain.kinds, [DOC])
  assertEquals(plain.comp(DOC)!.before, [])
})

Deno.test('both columns are text, and both route bare', () => {
  for (let prop of [TITLE, BODY]) {
    assertEquals(plain.column(DOC, prop)!.category, 'scalar')
    assertEquals(plain.route(prop), { comp: DOC, prop })
  }
})

Deno.test('store is carried only by whoever registered the keyword', () => {
  assertEquals(plain.column(DOC, BODY)!.keywords.store, undefined)
  assertEquals(addressed.column(DOC, BODY)!.keywords.store, 'blob')
  // and it is an ordinary text column either way — where the value LIVES is
  // @yaks/blob's business, never the meta-model's
  for (let v of [plain, addressed]) {
    assertEquals(v.column(DOC, BODY)!.scalar, 'text')
    assertEquals(v.column(DOC, BODY)!.affinity, 'text')
  }
})

Deno.test('the plugin is the vocabulary and a name', () => {
  let p = docs()
  assertEquals(p.name, '@yaks/doc')
  assertEquals(p.vocab, [docDoc])
  assert(!p.hooks)
})

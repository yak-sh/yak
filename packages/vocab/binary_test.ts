import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  changed,
  fromBundles,
  loadVocab,
  storable,
  toBundles,
  type VocabDoc,
} from './mod.ts'

import { meta } from './testing.ts'

let doc: VocabDoc = {
  $defs: {
    document: {
      component: true,
      type: 'object',
      properties: { bytes: { type: 'string', contentEncoding: 'base64' } },
    },
  },
}

test('a binary declaration describes bytes independently of their transport', () => {
  assert(meta().check(doc))
  assertEquals(storable(doc), [])
  let v = loadVocab(doc)
  assertEquals(v.prop('document', 'bytes')?.scalar, 'binary')
  assertEquals(v.prop('document', 'bytes')?.affinity, 'blob')
  for (let bytes of [new Uint8Array(), new Uint8Array([0, 255, 128, 10])]) {
    assertEquals(v.check('document', { bytes }), [])
  }
  for (let bytes of ['AP8=', [0, 255], { 0: 0, 1: 255 }]) {
    assert(v.check('document', { bytes }).length > 0)
  }
  assertEquals(v.check('document', { bytes: null }), [])
  let back = fromBundles(
    toBundles(doc, (comp, v) => `${comp}:${Object.values(v).join('.')}`),
  )[0]
  assertEquals(back.$defs!.document.properties!.bytes.contentEncoding, 'base64')
})

test('changing a string to bytes changes its stored type', () => {
  let text = structuredClone(doc)
  delete text.$defs!.document.properties!.bytes.contentEncoding
  assertEquals(changed(text, doc).retyped, ['document.bytes'])
  assertEquals(changed(doc, text).retyped, ['document.bytes'])
})

test('bytes cannot acquire string defaults or prose indexes', () => {
  for (
    let extra of [{ default: 'AP8=' }, { search: true }, { ref: 'entity' }, {
      enum: ['AP8='],
    }]
  ) {
    let invalid = structuredClone(doc)
    Object.assign(invalid.$defs!.document.properties!.bytes, extra)
    assert(storable(invalid).length > 0)
  }
})

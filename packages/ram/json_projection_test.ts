/// <reference lib="deno.ns" />
// Sparse JSON projections carry the same values through both storage adapters.
import { assertEquals, assertThrows } from '@std/assert'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { test } from '@yaks/testing'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { ram } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    record: {
      component: true,
      properties: {
        object: { type: 'object' },
        array: { type: 'array' },
        union: { type: ['string', 'number', 'object'] },
      },
    },
    link: {
      component: true,
      properties: { target: { type: 'string', ref: 'record' } },
    },
  },
})
let value = {
  object: { title: 'Label', nested: [null, true, { n: 3 }] },
  array: [{ name: 'one' }, 'two', 3],
  union: '"quoted"',
}
for (
  let [name, s] of [['RAM', ram(vocab)], [
    'SQL',
    storage(mem(), vocab),
  ]] as const
) {
  s.install()
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'value' }, record: value },
      { entity: { eid: 'empty' }, record: {} },
      { entity: { eid: 'link' }, link: { target: 'value' } },
      { entity: { eid: 'unset' }, link: {} },
    ])
  )
  let fields = '.fields=record.object,record.array,record.union'
  let projected = {
    eid: 'value',
    'record.object': value.object,
    'record.array': value.array,
    'record.union': value.union,
  }
  let direct = parse(`.entity.eid=value ${fields}`)
  let page = parse(`.entity.eid=value ${fields} .limit=1`)
  let reference = parse(
    '.link .fields=link.target.record.object,link.target.record.union',
  )
  let absent = parse(`.entity.eid=empty ${fields}`)
  test(`${name}: direct JSON projections return objects, arrays and union scalars`, () =>
    assertEquals(s.rows(direct), [projected]))
  test(`${name}: a limited JSON projection keeps the same typed values`, () =>
    assertEquals(s.rows(page), [projected]))
  test(`${name}: JSON projections follow references and retain missing values`, () =>
    assertEquals(
      s.rows(reference),
      [
        {
          eid: 'link',
          'link.target.record.object': value.object,
          'link.target.record.union': value.union,
        },
        {
          eid: 'unset',
          'link.target.record.object': null,
          'link.target.record.union': null,
        },
      ],
    ))
  test(`${name}: a projected absent JSON property answers null`, () =>
    assertEquals(s.rows(absent), [{
      eid: 'empty',
      'record.object': null,
      'record.array': null,
      'record.union': null,
    }]))
  for (
    let q of ['.record.object=x', '.order=record.object', '.tally=record.array']
  ) {
    let query = parse(q)
    test(`${name}: JSON scalar directives still refuse ${q}`, () =>
      assertThrows(() => s.rows(query)))
  }
}

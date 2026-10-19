// Selection observes fresh bundles and registry replacements; view pools only
// remove repeated metadata scans, including those for fallback and tab asks.
import { equal, test } from '@yaks/testing'
import { assertStrictEquals } from '@std/assert'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { applicable, define, extend, resolve } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    doc: {
      component: true,
      properties: { title: { type: 'string' } },
    },
  },
}])
let face = (view: string, q: string | true) => ({
  view,
  match: q === true ? true as const : parse(q),
})
let bundle = { entity: { eid: 'same' }, doc: { title: 'yes' } }
let yes = face('Tile', '.doc.title=yes')
let no = face('Tile', '.doc.title=no')
let json = face('JSON', true)
let unknown = face('Tile', '.unavailable.title=yes')
let prop = face('Edit', '.prop.type=string')
let rows = [unknown, yes, no, json, prop]

test('named pools retest changed values and component removal on the same eid', () => {
  let reg = define(rows)
  let b = { ...bundle, doc: { title: 'yes' } }
  assertStrictEquals(resolve(reg, b, 'Board.List.Tile', vocab), yes)
  b.doc.title = 'no'
  assertStrictEquals(resolve(reg, b, 'Board.List.Tile', vocab), no)
  equal(applicable(reg, b, vocab), ['Tile', 'JSON'])
  assertStrictEquals(resolve(reg, { entity: b.entity }, 'Tile', vocab), json)
  equal(applicable(reg, { entity: b.entity }, vocab), ['JSON'])
})

test('replacement and restoring an overlaid array refresh named and property picks', () => {
  let reg = define(rows)
  let ctx = { comp: 'doc', prop: 'title' }
  assertStrictEquals(resolve(reg, bundle, 'Edit', vocab, ctx), prop)
  assertStrictEquals(resolve(reg, bundle, 'Tile', vocab), yes)
  let prior = reg.renderers
  let tie = face('Tile', '.doc.title=yes')
  let editor = face('Edit', '.prop.type=string')
  extend(reg, [tie, editor])
  assertStrictEquals(resolve(reg, bundle, 'Tile', vocab), tie)
  assertStrictEquals(resolve(reg, bundle, 'Edit', vocab, ctx), editor)
  reg.renderers = [no]
  equal(resolve(reg, bundle, 'Tile', vocab), undefined)
  equal(resolve(reg, bundle, 'Edit', vocab, ctx), undefined)
  equal(applicable(reg, bundle, vocab), [])
  reg.renderers = prior
  assertStrictEquals(resolve(reg, bundle, 'Tile', vocab), yes)
  assertStrictEquals(resolve(reg, bundle, 'Edit', vocab, ctx), prop)
})

test('unnamed ties follow registration order, while tabs follow configured order', () => {
  let a = face('A', '.doc')
  let b = face('B', '.doc')
  let reg = define([a, b, json], { views: ['B', 'A', 'B', 'Missing'] })
  assertStrictEquals(resolve(reg, bundle, undefined, vocab), a)
  equal(applicable(reg, bundle, vocab), ['B', 'A', 'B'])
  reg.views = ['B']
  assertStrictEquals(resolve(reg, bundle, undefined, vocab), b)
  equal(applicable(reg, bundle, vocab), ['B'])
  reg.views = []
  assertStrictEquals(resolve(reg, bundle, undefined, vocab), json)
  equal(applicable(reg, bundle, vocab), [])
  // Eligibility controls unnamed requests only, never named fallback.
  assertStrictEquals(resolve(reg, bundle, 'Parent.A', vocab), a)
})

let reads = 0
let counted = Array.from({ length: 80 }, (_, i) => ({
  get view() {
    reads++
    return `Other${i}`
  },
  match: true as const,
}))
let measured = define([...counted, yes, no, json])
resolve(measured, bundle, 'Tile', vocab)

test('warm named fallback and applicability do not rescan unrelated registrations', () => {
  reads = 0
  assertStrictEquals(resolve(measured, bundle, 'Board.List.Tile', vocab), yes)
  equal(applicable(measured, bundle, vocab).length, 82)
  equal(reads, 0)
})

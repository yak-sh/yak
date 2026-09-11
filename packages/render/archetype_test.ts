// Archetype selection is independent of projected component bodies; value
// predicates, columns and registry overlays retain their existing semantics.
import { assertEquals, assertStrictEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { and, or, parse, present } from '@yaks/query'
import { applicable, type Bundle, define, extend, resolve } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    doc: { type: 'object', properties: { title: { type: 'string' } } },
    task: { type: 'object', properties: {} },
  },
}])
let tables = Object.freeze(['doc', 'task'])
let archetypes = (id: string) => id == 'shape' ? tables : undefined
let r = (name: string, q: string | true, view = 'Tile') => ({
  name,
  view,
  match: q === true ? true as const : q ? parse(q) : and(),
})

Deno.test('archetype presence never touches bodies, caches false and true; ties and extend', () => {
  let entries = [
    r('missing', '.missing'),
    r('specific', '.doc .task'),
    r('tie', '.doc .task'),
    r('doc', '.doc'),
    r('empty', ''),
    r('any', true),
  ]
  let reg = define(entries, { archetypes })
  let b = new Proxy({ entity: { eid: 'a', archetype: 'shape' } }, {
    get: (target, key) => {
      if (key !== 'entity') throw Error('body read: ' + String(key))
      return target.entity
    },
  }) as Bundle
  for (let i = 0; i < 3; i++) {
    assertStrictEquals(resolve(reg, b, 'Board.Tile', vocab), entries[1])
    assertEquals(applicable(reg, b, vocab), ['Tile'])
  }
  let override = r('terminal', '.doc .task')
  extend(reg, [override])
  assertStrictEquals(resolve(reg, b, 'Tile', vocab), override)
  reg.renderers = entries.slice(4)
  assertStrictEquals(resolve(reg, b, 'Tile', vocab), entries[4])
})

Deno.test('archetype groups, missing/unknown descriptors, moves and value conditions', () => {
  let group = {
    ...r('group', '.doc'),
    match: and(or(present('doc'), present('task'))),
  }
  let value = r('value', '.doc.title=yes')
  let absent = r('absent', '.task=')
  let reg = define([value, group, absent, r('any', true)], { archetypes })
  let b = { entity: { eid: 'a', archetype: 'shape' }, doc: { title: 'yes' } }
  assertStrictEquals(resolve(reg, b, undefined, vocab), value)
  b.doc.title = 'no'
  assertStrictEquals(resolve(reg, b, undefined, vocab), group)
  b.entity.archetype = 'unknown'
  delete (b as Partial<typeof b>).doc
  assertStrictEquals(resolve(reg, b, undefined, vocab), absent)
  b.entity.archetype = 'shape'
  assertStrictEquals(resolve(reg, b, undefined, vocab), group)
})

Deno.test('value-only selection does not request a lazy archetype descriptor', () => {
  let value = r('value', '.doc.title=yes')
  let reg = define([value, r('any', true)], {
    archetypes: () => {
      throw Error('unnecessary descriptor read')
    },
  })
  let b = {
    entity: { eid: 'projected', archetype: 'not-loaded' },
    doc: { title: 'yes' },
  }
  assertStrictEquals(resolve(reg, b, 'Tile', vocab), value)
})

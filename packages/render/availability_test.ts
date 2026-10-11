import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { actions, applicable, define, type Renderer, resolve } from './mod.ts'

let absent = loadVocab([{
  $defs: {
    other: { component: true, properties: { note: { type: 'string' } } },
  },
}])
let available = loadVocab([{
  $defs: {
    note: { component: true, properties: { title: { type: 'string' } } },
  },
}])
let face: Renderer = {
  view: 'Tile',
  match: parse('.note.title=hello'),
  render: (_b, h) => h('span', null, 'hello'),
}
let open = { name: 'open', run: () => ({}) }
let registry = define([face], {
  views: ['Tile'],
  actions: [{ match: face.match, acts: () => [open] }],
})
let bundle = { entity: { eid: 'note' }, note: { title: 'hello' } }
let archetypeFace = { ...face, match: parse('.note') }
let tables = ['note']
let archetypeRegistry = define([archetypeFace], {
  views: ['Tile'],
  archetypes: () => tables,
  actions: [{ match: archetypeFace.match, acts: () => [open] }],
})
let projected = { entity: { eid: 'note', archetype: 'shape' } }

test('a view unavailable to one vocabulary is selectable by another', () => {
  equal(resolve(registry, bundle, 'Tile', absent), undefined)
  equal(applicable(registry, bundle, absent), [])
  equal(actions(registry, bundle, absent), [])
  equal(resolve(registry, bundle, 'Tile', available), face)
  equal(applicable(registry, bundle, available), ['Tile'])
  equal(actions(registry, bundle, available), [open])
})

test('an archetype view unavailable to one vocabulary is selectable by another', () => {
  equal(resolve(archetypeRegistry, projected, 'Tile', absent), undefined)
  equal(applicable(archetypeRegistry, projected, absent), [])
  equal(actions(archetypeRegistry, projected, absent), [])
  equal(resolve(archetypeRegistry, projected, 'Tile', available), archetypeFace)
  equal(applicable(archetypeRegistry, projected, available), ['Tile'])
  equal(actions(archetypeRegistry, projected, available), [open])
})

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { preparedStore, snapshot } from './testing.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: {
      component: true,
      properties: { archetype: { type: 'string', ref: 'archetype' } },
    },
    name: { component: true, properties: { text: { type: 'string' } } },
    pref: { component: true, properties: { value: { type: 'string' } } },
  },
}])
let store = preparedStore(vocab, {}, snapshot(vocab))
let g = graph({
  storage: store,
  vocab,
  plugins: [archetypes(), {
    name: 'owner',
    scope: (ctx) =>
      ctx.opts.person === undefined
        ? undefined
        : { components: { pref: '.entity.eid=alice' } },
  }],
})
g.apply([
  {
    entity: { eid: 'alice' },
    name: { text: 'Alice' },
    pref: { value: 'mine' },
  },
  { entity: { eid: 'bob' }, name: { text: 'Bob' }, pref: { value: 'secret' } },
  { entity: { eid: 'public' }, name: { text: 'Public' } },
])
let pointer = (g.get(['bob']) as Bundle[])[0].entity.archetype!
let publicPointer = (g.get(['public']) as Bundle[])[0].entity.archetype!
let opts = { person: 'alice' }
test('an owner can select their private component on a public entity', () =>
  assertEquals(g.rows('.pref', opts), [{ eid: 'alice' }]))
test('private component archetypes cannot be selected through entity metadata', () =>
  assertEquals(
    g.rows(`.entity.eid=bob .entity.archetype=${pointer}`, opts),
    [],
  ))
test('private component archetypes cannot be dereferenced through entity metadata', () =>
  assertEquals(
    g.rows('.entity.eid=bob .fields=entity.archetype.archetype.tables', opts),
    [
      { eid: 'bob', 'entity.archetype.archetype.tables': null },
    ],
  ))
test('public component archetype projection agrees with its getter', () =>
  assertEquals(g.rows('.entity.eid=public .fields=entity.archetype', opts), [
    { eid: 'public', 'entity.archetype': publicPointer },
  ]))

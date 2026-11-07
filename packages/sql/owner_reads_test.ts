// A derived property that reads a row's owner, joined on the row's `entity`,
// and the shape that owner names, reads them with the row: a scope keyed to
// the owner admits both where it admits the row, through a query and through a
// gather alike. A reference joined the same way is screened as its own entity.
import { equal, test } from '@yaks/testing'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { preparedDriver, snapshot } from '../sqlite/testing.ts'
import { storage } from '../sqlite/mod.ts'
import { col, cross, eq, fn, lit, op, select, sub, table } from './mod.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: { component: true, type: 'object' },
    topic: {
      component: true,
      properties: {
        notes: { type: 'string', computed: true },
        cited: { type: 'string', computed: true },
      },
    },
    note: {
      component: true,
      properties: {
        topic: { type: 'string', ref: 'entity' },
        cite: { type: 'string', ref: 'entity' },
      },
    },
    hidden: { component: true },
  },
}])
// The eids the notes of a topic name in `on`, each with the shape of the
// entity it names.
let names = (on: 'entity' | 'cite') => ({
  tag: 'text' as const,
  expr: (owner: ReturnType<typeof col>) =>
    sub(select({
      cols: [fn(
        'group_concat',
        op('||', col('eid', 'o'), lit(':'), col('tables', 's')),
        lit(';'),
      )],
      from: table('note', 'n'),
      joins: [
        {
          ...cross(table('entity', 'o')),
          on: eq(col('id', 'o'), col(on, 'n')),
        },
        {
          ...cross(table('archetype', 's')),
          on: eq(col('entity', 's'), col('archetype', 'o')),
        },
      ],
      where: eq(col('topic', 'n'), owner),
    })),
})
let derived = { 'topic.notes': names('entity'), 'topic.cited': names('cite') }
let store = storage(preparedDriver(snapshot(vocab, { derived })), vocab, {
  derived,
  schemaReady: () => true,
})
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
await g.apply([
  { entity: { eid: 't' }, topic: {} },
  { entity: { eid: 'open' }, note: {} },
  { entity: { eid: 'secret' }, note: {}, hidden: {} },
  { entity: { eid: 'seen' }, note: { topic: 't', cite: 'secret' } },
  { entity: { eid: 'plain' }, note: { topic: 't', cite: 'open' } },
  { entity: { eid: 'kept' }, note: { topic: 't', cite: 'open' }, hidden: {} },
])

// Each topic's names, in a stable order.
let read = (rows: Bundle[]) =>
  rows.map((b) => {
    let t = b.topic as { notes?: string; cited?: string }
    let sorted = (s?: string) => String(s).split(';').sort().join(';')
    return [sorted(t.notes), sorted(t.cited)]
  })
let NOTE = '["note"]', HIDDEN = '["hidden","note"]'
let scopes = [
  ['no scope', undefined, [
    `kept:${HIDDEN};plain:${NOTE};seen:${NOTE}`,
    `open:${NOTE};open:${NOTE};secret:${HIDDEN}`,
  ]],
  ['an absent component', '!hidden', [
    `plain:${NOTE};seen:${NOTE}`,
    `open:${NOTE}`,
  ]],
] as const
for (let [name, entity, want] of scopes) {
  let opts = entity ? { visibility: { entity } } : {}
  test(`a row's owner and its shape are read with the row under ${name}, through a query`, () =>
    equal(
      read(
        store.read(
          '.entity.eid=t .fields=topic.notes,topic.cited',
          opts,
        ) as Bundle[],
      ),
      [[...want]],
    ))
  test(`a row's owner and its shape are read with the row under ${name}, through a gather`, () =>
    equal(read(store.get(['t'], ['topic'], opts) as Bundle[]), [[...want]]))
}

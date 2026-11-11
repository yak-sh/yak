// An entity scope that asks only which components an entity wears screens the
// rows a derived property reads by their owners, through a query and through a
// gather alike: a hidden entity's row counts for nobody, and every other row
// still counts.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { preparedDriver, snapshot } from '../sqlite/testing.ts'
import { storage } from '../sqlite/mod.ts'
import { col, eq, fn, lit, select, sub, table } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    topic: {
      component: true,
      properties: {
        notes: { type: 'string', computed: true },
        named: { type: 'string', computed: true },
      },
    },
    note: {
      component: true,
      properties: {
        topic: { type: 'string', ref: 'entity' },
        text: { type: 'string' },
      },
    },
    hidden: { component: true },
  },
})
// The texts of the notes on a topic, read through the alias `as`: `named`
// names its rows as the scope's own component is named.
let texts = (as: string) => ({
  tag: 'text' as const,
  expr: (owner: ReturnType<typeof col>) =>
    sub(select({
      cols: [fn('group_concat', col('text', as), lit(','))],
      from: table('note', as),
      where: eq(col('topic', as), owner),
    })),
})
let derived = { 'topic.notes': texts('n'), 'topic.named': texts('hidden') }
let store = storage(preparedDriver(snapshot(vocab, { derived })), vocab, {
  derived,
  schemaReady: () => true,
})
let g = graph({ storage: store, vocab })
await g.apply([
  { entity: { eid: 't' }, topic: {} },
  { entity: { eid: 'seen' }, note: { topic: 't', text: 'seen' } },
  { entity: { eid: 'kept' }, note: { topic: 't', text: 'kept' }, hidden: {} },
  { entity: { eid: 'gone' }, note: { topic: 't', text: 'gone' } },
])
await g.apply([{ entity: { eid: 'gone' }, $delete: true }])

// Each topic row's notes, in a stable order, as both properties read them.
let notes = (rows: Bundle[]) =>
  rows.flatMap((b) => {
    let t = b.topic as Record<string, string | undefined>
    return ['notes', 'named'].map((p) =>
      String(t?.[p]).split(',').sort().join(',')
    )
  })
let scopes = [
  ['no scope', undefined, 'kept,seen'],
  ['an absent component', '!hidden', 'seen'],
] as const
for (let [name, entity, want] of scopes) {
  let opts = entity ? { visibility: { entity } } : {}
  test(`a derived read follows ${name} on its rows' owners, through a query`, () =>
    equal(
      notes(
        store.read(
          '.entity.eid=t .fields=topic.notes,topic.named',
          opts,
        ) as Bundle[],
      ),
      [want, want],
    ))
  test(`a derived read follows ${name} on its rows' owners, through a gather`, () =>
    equal(notes(store.get(['t'], ['topic'], opts) as Bundle[]), [want, want]))
}

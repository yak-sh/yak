// The journal read as entities. Its vocabulary declares two computed
// components (vocab.json): `_tx`, a committed transaction, and `_change`, one
// component a transaction wrote or removed. No table holds them. These are
// their backings (@yaks/sql `Backing`): the journal's own rows, renamed to the
// components' properties, which a store reads as it reads a component table —
// so an entity's history is `._change.target=T-5`, a session's writes are
// `._tx.via=S-7`, and nothing is copied, nor journaled, to answer either.
//
// A reference column already holds what a component table holds, the
// referent's integer id: `target`, `by` and `via` point into the entity table,
// and `tx` at a transaction's own id. `comp` is the `_comp` entity describing
// the component (@yaks/vocab), joined by its unique name; a graph that does not
// describe its vocabulary, or no longer describes a component the journal
// names, has none to point at. A join rather than a lookup per change, so a
// filter on it (a component's recent writes, `._change.comp=<_comp>`) starts
// from that one `_comp` row and reads its changes through the index on
// `component` (./log.ts `ddl`), where a lookup per change read all of them. A
// change's `value` is its after-image, the properties it wrote as one object,
// read from its field rows; a removal has none. A property the store keeps in
// another form, the address @yaks/blob keeps in place of a body, reads back
// through the store's `text` (@yaks/sql `Derived`), so a change says the text
// a reader of the graph read; where that text is no longer kept, it says what
// was recorded.

import {
  and,
  as,
  col,
  type Derived,
  eq,
  type Expr,
  fn,
  left,
  lit,
  select,
  sub,
  table,
  when,
} from '@yaks/sql/core'
import type { Backings } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'

let jc = (c: string) => col(c, 'jc')
let jf = (c: string) => col(c, 'jf')
let cc = (c: string) => col(c, 'cc')

// The address a field recorded: its value, or, as the journal once recorded
// content, the eid of the entity holding it (`ref`).
let address = fn(
  'coalesce',
  fn('json_extract', jf('value'), lit('$')),
  sub(select({
    cols: [col('eid', 'jr')],
    from: table('entity', 'jr'),
    where: eq(col('id', 'jr'), jf('ref')),
  })),
)

// One field's value as JSON: through its property's `text` where the store
// keeps it in another form, and as recorded otherwise.
let fieldOf = (derived: Derived): Expr => {
  let recorded = fn('json', jf('value'))
  let texts = Object.entries(derived).flatMap(([key, d]) =>
    d.text ? [[key.split('.'), d.text] as const] : []
  )
  return texts.length
    ? when(
      texts.map(([[comp, prop], text]) => [
        and(eq(jc('component'), lit(comp)), eq(jf('field'), lit(prop))),
        fn('coalesce', fn('json_quote', text(address)), recorded),
      ]),
      recorded,
    )
    : recorded
}

// The `_comp` a change's component names, where the graph has one: its
// column, and the join that reads it.
let described = (vocab: Vocab) =>
  vocab.comp('_comp')
    ? {
      comp: cc('entity'),
      joins: [left(table('_comp', 'cc'), eq(cc('name'), jc('component')))],
    }
    : { comp: lit(null), joins: [] }

// One change's present after-images as one object. The field rows are read in
// the order they were written, through their (change, ordinal) index.
let valueOf = (derived: Derived) =>
  when([[
    eq(jc('operation'), lit('upsert')),
    sub(select({
      cols: [fn('json_group_object', jf('field'), fieldOf(derived))],
      from: table('journal_field', 'jf'),
      where: and(eq(jf('change'), jc('id')), eq(jf('present'), lit(1))),
    })),
  ]])

// What each record tells of, by the record's own id (`id` for a change, `tx`
// for a transaction): every change's entity and component. A scoped read sees
// a change when it may see that component of that entity, and a transaction
// when it may see one of its changes.
let tells = (id: string) =>
  select({
    cols: [
      as(jc(id), 'entity'),
      as(jc('entity'), 'about'),
      as(jc('component'), 'component'),
    ],
    from: table('journal_change', 'jc'),
  })

/** The rows `_tx` and `_change` are read from: the journal's tables, a value
 * the store keeps in another form read through `derived`, the store's read
 * overrides. */
export let backed = (vocab: Vocab, derived: Derived = {}): Backings => {
  let { comp, joins } = described(vocab)
  let value = valueOf(derived)
  return {
    _tx: {
      about: tells('tx'),
      rows: select({
        cols: [
          as(col('id'), 'entity'),
          as(col('id'), 'seq'),
          as(col('ts'), 'at'),
          as(col('actor'), 'by'),
          as(col('via'), 'via'),
          as(col('host'), 'host'),
          as(col('trace'), 'note'),
        ],
        from: table('journal_tx'),
      }),
    },
    _change: {
      about: tells('id'),
      rows: select({
        cols: [
          as(jc('id'), 'entity'),
          as(jc('tx'), 'tx'),
          as(jc('entity'), 'target'),
          as(comp, 'comp'),
          as(value, 'value'),
        ],
        from: table('journal_change', 'jc'),
        joins,
      }),
    },
  }
}

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
// read from its field rows; a removal has none.

import {
  and,
  as,
  type Backings,
  col,
  eq,
  fn,
  left,
  lit,
  select,
  sub,
  table,
  when,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'

let jc = (c: string) => col(c, 'jc')
let jf = (c: string) => col(c, 'jf')
let cc = (c: string) => col(c, 'cc')

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
let value = when([[
  eq(jc('operation'), lit('upsert')),
  sub(select({
    cols: [fn('json_group_object', jf('field'), fn('json', jf('value')))],
    from: table('journal_field', 'jf'),
    where: and(eq(jf('change'), jc('id')), eq(jf('present'), lit(1))),
  })),
]])

/** The rows `_tx` and `_change` are read from: the journal's tables. */
export let backed = (vocab: Vocab): Backings => {
  let { comp, joins } = described(vocab)
  return {
    _tx: {
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

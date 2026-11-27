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
// the component (@yaks/vocab), the entity whose eid is the component's
// identity, which is what the row recorded (./names.ts); a graph that does not
// describe its vocabulary, or no longer describes a component the journal
// names, has none to point at. A row recorded by label before identities
// points at the `_comp` row that label has now.
//
// `component` is the component's label, and a change's `value` its after-image
// keyed by its properties' labels, as the vocabulary reads the identities the
// rows recorded: a reader reads history in the words it reads the graph in,
// and a renamed word's history under its new label. The value is the
// properties the change wrote as one object, read from its field rows; a
// removal has none. A property the store keeps in another form, the address
// @yaks/blob keeps in place of a body, reads back through the store's `text`
// (@yaks/sql `Derived`), so a change says the text a reader of the graph read;
// where that text is no longer kept, it says what was recorded.

import {
  among,
  and,
  as,
  col,
  type Derived,
  desc,
  eq,
  exists,
  type Expr,
  fn,
  join,
  left,
  lit,
  type Select,
  select,
  sub,
  table,
  when,
} from '@yaks/sql/core'
import type { Backings, Held } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { type Names, names } from './names.ts'

let jc = (c: string) => col(c, 'jc')
let jf = (c: string) => col(c, 'jf')
let cc = (c: string) => col(c, 'cc')

// The address a field row `f` recorded: its value, or, as the journal once
// recorded content, the eid of the entity holding it (`ref`).
let addressOf = (f: (c: string) => Expr) =>
  fn(
    'coalesce',
    fn('json_extract', f('value'), lit('$')),
    sub(select({
      cols: [col('eid', 'jr')],
      from: table('entity', 'jr'),
      where: eq(col('id', 'jr'), f('ref')),
    })),
  )
let address = addressOf(jf)

// Any of the names a row may hold for a word (./names.ts).
let any = (names: string[]) => names.map((n) => lit(n))

// One field's value as JSON: through its property's `text` where the store
// keeps it in another form, and as recorded otherwise.
let fieldOf = (derived: Derived, named: Names): Expr => {
  let recorded = fn('json', jf('value'))
  let texts = Object.entries(derived).flatMap(([key, d]) =>
    d.text ? [[key.split('.'), d.text] as const] : []
  )
  return texts.length
    ? when(
      texts.map(([[comp, prop], text]) => [
        and(
          among(jc('component'), any(named.comps(comp))),
          among(jf('field'), any(named.props(comp, prop))),
        ),
        fn('coalesce', fn('json_quote', text(address)), recorded),
      ]),
      recorded,
    )
    : recorded
}

// The `_comp` a change's component names, where the graph has one: its
// column, and the join that reads it.
let described = (vocab: Vocab, named: Names) =>
  vocab.comp('_comp')
    ? {
      comp: cc('id'),
      joins: [
        left(
          table('entity', 'cc'),
          eq(cc('eid'), named.rowOf(jc('component'))),
        ),
      ],
    }
    : { comp: lit(null), joins: [] }

// One change's present after-images as one object, keyed by label. The field
// rows are read in the order they were written, through their (change,
// ordinal) index.
let valueOf = (derived: Derived, named: Names) =>
  when([[
    eq(jc('operation'), lit('upsert')),
    sub(select({
      cols: [fn(
        'json_group_object',
        named.labelOf(jf('field')),
        fieldOf(derived, named),
      )],
      from: table('journal_field', 'jf'),
      where: and(eq(jf('change'), jc('id')), eq(jf('present'), lit(1))),
    })),
  ]])

// What each record tells of, by the record's own id (`id` for a change, `tx`
// for a transaction): every change's entity and component, by label. A scoped
// read sees a change when it may see that component of that entity, and a
// transaction when it may see one of its changes.
let tells = (id: string, named: Names) =>
  select({
    cols: [
      as(jc(id), 'entity'),
      as(jc('entity'), 'about'),
      as(named.labelOf(jc('component')), 'component'),
    ],
    from: table('journal_change', 'jc'),
  })

// Component `comp` as the journal last told each entity held it (@yaks/sql
// `Backing.held`), which is how a scoped read judges a deleted entity: an
// entity whose newest change to it wrote it, and each property's newest
// after-image, null where that is the tombstone a removal wrote. A reference
// is read back to the referent's integer id, as the component's table keeps
// it. Start with the owner, then seek its latest change: starting with changes
// let a scoped get walk their history or build a bloom filter over the journal
// before testing two owners. This single-table relation also folds into a
// LEFT JOIN without materializing every owner's history.
let heldIn = (named: Names) => (comp: string, props: Held[]): Select => {
  let jn = (c: string) => col(c, 'jn')
  let jl = (c: string) => col(c, 'jl')
  let owner = col('id', '__held')
  let ours = (c: (c: string) => Expr) =>
    and(eq(c('entity'), owner), among(c('component'), any(named.comps(comp))))
  let newest = ({ name, ref }: Held) =>
    sub(select({
      cols: [when([[
        eq(jl('present'), lit(1)),
        ref
          ? sub(select({
            cols: [col('id', 'jr')],
            from: table('entity', 'jr'),
            where: eq(
              col('eid', 'jr'),
              fn('json_extract', jl('value'), lit('$')),
            ),
          }))
          : addressOf(jl),
      ]])],
      from: table('journal_field', 'jl'),
      joins: [join(table('journal_change', 'jn'), eq(jn('id'), jl('change')))],
      where: and(ours(jn), among(jl('field'), any(named.props(comp, name)))),
      order: [desc(jl('id'))],
      limit: lit(1),
    }))
  return select({
    cols: [
      as(owner, 'entity'),
      ...props.map((p) => as(newest(p), p.as)),
    ],
    from: table('entity', '__held'),
    where: exists(select({
      cols: [lit(1)],
      from: table('journal_change', 'jc'),
      where: and(
        eq(jc('operation'), lit('upsert')),
        eq(
          jc('id'),
          sub(select({
            cols: [fn('max', jn('id'))],
            from: table('journal_change', 'jn'),
            where: ours(jn),
          })),
        ),
      ),
    })),
  })
}

/** The rows `_tx` and `_change` are read from: the journal's tables, a value
 * the store keeps in another form read through `derived`, the store's read
 * overrides. `_change` also tells what each entity last held (`held`). One
 * registry per vocabulary and overrides, so every store given them compiles
 * its reads once (@yaks/sql `Backing`). */
export let backed = (vocab: Vocab, derived: Derived = NONE): Backings => {
  let byDerived = registries.get(vocab)
  if (!byDerived) registries.set(vocab, byDerived = new WeakMap())
  let got = byDerived.get(derived)
  if (!got) byDerived.set(derived, got = registry(vocab, derived))
  return got
}
let NONE: Derived = {}
let registries = new WeakMap<Vocab, WeakMap<Derived, Backings>>()

let registry = (vocab: Vocab, derived: Derived): Backings => {
  let named = names(vocab)
  let { comp, joins } = described(vocab, named)
  let value = valueOf(derived, named)
  return {
    _tx: {
      about: tells('tx', named),
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
      about: tells('id', named),
      held: heldIn(named),
      rows: select({
        cols: [
          as(jc('id'), 'entity'),
          as(jc('tx'), 'tx'),
          as(jc('entity'), 'target'),
          as(comp, 'comp'),
          as(named.labelOf(jc('component')), 'component'),
          as(value, 'value'),
        ],
        from: table('journal_change', 'jc'),
        joins,
      }),
    },
  }
}

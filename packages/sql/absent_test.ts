import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import {
  absentDerived,
  col,
  type Derived,
  eq,
  render,
  select,
  sub,
  table,
} from './mod.ts'

let v = loadVocab({
  $defs: {
    note: { component: true, properties: { title: { type: 'string' } } },
  },
})
let titled = select({ cols: [col('title')], from: table('note') })
let derived: Derived = {
  'note.heading': {
    tag: 'text',
    deps: ['note', 'doc'],
    expr: () => sub(titled),
    select: () => titled,
    test: (owner, [value]) => eq(sub(titled), value ?? owner),
  },
}
let reads = (d: Derived) => {
  let p = d['note.heading']
  return [
    p.expr(col('id')),
    p.select!([col('v')])!,
    p.test!(col('id'), [col('v')])!,
  ].map((s) => render(s).sql.includes('from "note"'))
}

test('a prop over an absent table reads none of it, by value, select or test', () => {
  equal(reads(derived), [true, true, true])
  let read = absentDerived(v, derived, ['note'])
  equal(reads(read), [false, false, false])
  equal(read['note.heading'].deps, ['doc'])
})

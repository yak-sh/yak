// A derived owner selector has the same typed equality and presence semantics
// as its scalar expression; projection and unsupported operands retain expr.
import { equal, ok, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { sessionDoc } from '../session/comp.ts'
import { storage } from './mod.ts'
import { mem } from './testing.ts'
import {
  among,
  and,
  col,
  type Derived,
  eq,
  exists,
  select,
  sub,
  table,
} from '@yaks/sql/core'

let v = loadVocab([sessionDoc])
let calls = 0
let registry = (optimized: boolean): Derived =>
  Object.fromEntries([
    ['session.ended', 'session', 'ended', 'bool'],
    ['entry.seq', 'entry', 'seq', 'number'],
  ].map(([path, comp, prop, tag]) => [path, {
    tag,
    expr: (owner) =>
      sub(select({
        cols: [col(prop, 'value')],
        from: table(comp, 'value'),
        where: eq(col('entity', 'value'), owner),
      })),
    ...optimized
      ? {
        test: (owner, values) =>
          exists(select({
            cols: [col('entity', 'value')],
            from: table(comp, 'value'),
            where: and(
              eq(col('entity', 'value'), owner),
              among(col(prop, 'value'), values),
            ),
          })),
        select: (values) => {
          calls++
          return select({
            cols: [col('entity', 'value')],
            from: table(comp, 'value'),
            where: among(col(prop, 'value'), values),
          })
        },
      }
      : {},
  }])) as Derived
let make = (optimized: boolean) => {
  let s = storage(mem(), v, { derived: registry(optimized) })
  s.install()
  let g = graph({ storage: s, vocab: v })
  g.apply([
    { entity: { eid: 'yes' }, session: { id: 'yes', ended: true } },
    { entity: { eid: 'no' }, session: { id: 'no', ended: false } },
    { entity: { eid: 'null' }, session: { id: 'null' } },
    { entity: { eid: 'one' }, entry: { session: 'yes', seq: 1 } },
    { entity: { eid: 'two' }, entry: { session: 'yes', seq: 2 } },
    { entity: { eid: 'absent' } },
  ], { trusted: true })
  return g
}
let optimized = make(true)
let scalar = make(false)
for (
  let predicate of [
    '.session.ended=true',
    '.session.ended=false',
    '.session.ended=true,false',
    '.session.ended=1',
    '.session.ended=bad,true',
    '.session.ended!=true',
    '.entry.seq=1',
    '.entry.seq=1,2',
    '.entry.seq=01,2',
    '.entry.seq=bad,2',
    '.entry.seq>1',
    '.session.ended=true|.entry.seq=2',
    '.entity.eid=yes .session.ended=true',
    '.entity.eid=absent .session.ended=true',
    '.entity.eid=two .entry.seq=2',
    '.entity.eid=two .entry.seq=bad,2',
    '.entity.eid=two .entry.seq>1',
    '.entry.session.session.ended=true',
    '.session .entries.entry.seq=2',
    '.session.id=yes .session.ended=true',
    '.session.id=no,null .session.ended=true,false',
    '.session.id>m .session.ended=false',
  ]
) {
  test(`derived owner selection preserves ${predicate}`, async () => {
    let query = `${predicate} .fields=entity.eid`
    equal(
      (await optimized.rows(query)).map((b) => b.eid).sort(),
      (await scalar.rows(query)).map((b) => b.eid).sort(),
    )
  })
}
test('derived owner selection is used for typed equality, not projection', async () => {
  let before = calls
  equal(
    (await optimized.rows('.entry.seq=2 .fields=entity.eid')).map((b) => b.eid),
    [
      'two',
    ],
  )
  ok(calls > before)
  before = calls
  equal(
    await optimized.rows('.entity.eid=two .fields=entry.seq'),
    await scalar.rows('.entity.eid=two .fields=entry.seq'),
  )
  equal(calls, before)
})
test('a stored value filter beside it tests each row, never every owner', async () => {
  let before = calls
  equal(
    (await optimized.rows(
      '.session.id=yes,no .session.ended=true .fields=entity.eid',
    ))
      .map((b) => b.eid),
    ['yes'],
  )
  equal(calls, before)
})

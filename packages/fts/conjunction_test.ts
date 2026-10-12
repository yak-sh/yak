// A finite membership screen preserves conjunctive text across indexes.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { compile } from '@yaks/sql'
import { driver } from '../sqlite/native.ts'
import { mixed, seed, text, vocab } from '../../workers/yak/fts_cost_fixture.ts'
import { search } from './compile.ts'

let native = new Database(':memory:'), db = driver(native)
seed(db, 1)
mixed(db)
let extension = search(text, db)
for (
  let [query, visibility, expected] of [
    ['needle thread .comment', undefined, ['far', 'near']],
    ['needle needle thread .comment', undefined, ['far', 'near']],
    ['"needle thread" needle .comment', undefined, ['far']],
    ['(needle (thread)) .comment', undefined, ['far', 'near']],
    // mixed() removed dragon from near/far; their mandatory terms cannot
    // erase the OR's separate text condition.
    ['needle (dragon|.entity.eid=other-3)', undefined, ['other-3']],
    ['needle (thread|dragon) .comment', undefined, ['far', 'near']],
    ['needle thread .comment', { components: { extra: '.entity.eid=far' } }, [
      'far',
    ]],
    ['needle .comment', { entity: '.entity.eid=near' }, ['near']],
    ['dragon .comment .limit=2', undefined, ['later-1000001', 'later-1000002']],
    ['"needle thread" .comment', undefined, ['far']],
  ] as const
) {
  let owners = query.startsWith('dragon ')
    ? 'later-1000001,later-1000002'
    : query.includes('other-3')
    ? 'near,far,other-3'
    : 'near,far'
  let statement = compile(parse(`${query} .entity.eid=${owners}`), vocab, {
    visibility,
    exactIds: true,
    extend: [extension],
  })
  let prepared = native.prepare(statement.sql)
  test(`text conjunction: ${query}, ${JSON.stringify(visibility)}`, () => {
    try {
      assertEquals(
        prepared.all(...statement.params).map((r) => String(r.eid)).sort(),
        [...expected],
      )
    } finally {
      prepared.finalize()
    }
  })
}

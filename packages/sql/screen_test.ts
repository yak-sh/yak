// An extension's screen widens its own clauses without changing owner scope.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { driver } from '../sqlite/native.ts'
import { type And, parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import {
  among,
  as,
  type BindOpts,
  col,
  compile,
  eq,
  type Extension,
  insert,
  type Screen,
  select,
  table,
  val,
} from './mod.ts'
import { ownerVocab, seedOwners } from './owner_fixture_test.ts'

let db = driver(new Database(':memory:'))
seedOwners(db)
let captured: Screen | undefined
let extension: Extension = {
  name: 'prose',
  begin: (screen) => captured = screen,
  compile: {
    text: (c, site) =>
      c.kind == 'text'
        ? among(
          site.owner,
          select({
            cols: [col('entity')],
            from: table('post'),
            where: eq(col('title'), val(c.value)),
          }),
        )
        : null,
  },
}
for (
  let [query, expected] of [
    ['.entity.eid=closed (Chosen|Missing)', [2]],
    ['.entity.eid=closed ((Chosen .post)|.person)', [2]],
    ['Chosen|.entity.eid=closed', null],
    ...[false, true].map((not): [And, number[]] => [{
      kind: 'and',
      clauses: [
        ...parse('.entity.eid=target').clauses,
        {
          kind: 'pred',
          path: ['comments'],
          op: '!',
          value: null,
          not,
          where: { kind: 'text', value: 'Chosen' },
        },
      ],
    }, [1]]),
  ] as [string | And, number[] | null][]
) {
  test(`extension screen: ${query}`, () => {
    compile(typeof query == 'string' ? parse(query) : query, ownerVocab, {
      extend: [extension],
    })
    let rest = captured!()
    assertEquals(rest && db.query(rest).map((r) => Number(r.id)), expected)
  })
}

test('a clause receives candidates only for its own root owner scope', () => {
  let seen: (number[] | null)[] = []
  let scoped: Extension = {
    name: 'scoped',
    compile: {
      text: (_c, site) => {
        let rest = site.screen?.()
        seen.push(rest ? db.query(rest).map((r) => Number(r.id)) : null)
        return eq(val(1), val(1))
      },
    },
  }
  compile(
    {
      kind: 'and',
      clauses: [
        ...parse('.entity.eid=target Chosen').clauses,
        {
          kind: 'pred',
          path: ['comments'],
          op: '!',
          value: null,
          where: { kind: 'text', value: 'Chosen' },
        },
      ],
    },
    ownerVocab,
    { extend: [scoped] },
  )
  assertEquals(seen, [[1], null])
})

let bounded: Extension['compile'] = {
  text: (_clause, site) => {
    let screen = site.screen!
    return among(
      site.owner,
      select({
        cols: [col('id')],
        from: site.share(screen()!),
        limit: val(screen.maximum!),
      }),
    )
  },
}
for (let replace of [false, true]) {
  test(`candidate bounds retain context when begin ${replace ? 'replaces' : 'grows'} owners`, () => {
    let eids = ['target']
    let opts: BindOpts = { eids }
    opts.extend = [{
      name: 'growing',
      begin: () => {
        if (replace) opts.eids = ['closed']
        else eids.push('closed')
      },
      compile: bounded,
    }]
    let statement = compile(parse('Chosen'), ownerVocab, opts)
    assertEquals(
      db.query(statement).map((r) => r.eid).sort(),
      replace ? ['target'] : ['closed', 'target'],
    )
  })
}

test('mutually dependent extension screens remain a conservative bound', () => {
  let first: Screen | undefined, second: Screen | undefined
  let extensions: Extension[] = [
    {
      name: 'first',
      begin: (screen) => first = screen,
      compile: {
        text: () => {
          second!()
          return eq(val(1), val(1))
        },
      },
    },
    {
      name: 'second',
      begin: (screen) => second = screen,
      compile: {
        near: () => {
          first!()
          return eq(val(1), val(1))
        },
      },
    },
  ]
  let statement = compile(
    parse('.entity.eid=target Chosen .near=target'),
    ownerVocab,
    { extend: extensions },
  )
  assertEquals(db.query(statement).map((r) => r.eid), ['target'])
})

test('a shared relation binds its values once across clause compilations', () => {
  let owners = select({
    cols: [col('id')],
    from: table('entity'),
    where: eq(col('eid'), val('target')),
  })
  let shared: Extension = {
    name: 'shared',
    compile: {
      text: (_c, site) =>
        among(
          site.owner,
          select({
            cols: [col('id')],
            from: site.share(owners),
          }),
        ),
    },
  }
  let statement = compile(parse('one two three four five'), ownerVocab, {
    extend: [shared],
  })
  assertEquals(db.query(statement).map((r) => r.eid), ['target'])
  assertEquals(statement.params.length, 1)
})

let reserved = '__SHARED_SQLITE_0'
db.query({
  t: 'create table',
  name: reserved,
  cols: [{ name: 'entity', type: 'integer', pk: true }],
})
db.query(insert(reserved, { entity: 1 }))
let namespace = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    [reserved]: { component: true, properties: {} },
  },
})
test('shared relations preserve existing source names across identifier case', () => {
  let owners = select({
    cols: [as(col('entity'), 'id')],
    from: table(reserved),
  })
  let extension: Extension = {
    name: 'names',
    compile: {
      text: (_c, site) =>
        among(
          site.owner,
          select({
            cols: [col('id')],
            from: site.share(owners),
          }),
        ),
    },
  }
  let statement = compile(
    {
      kind: 'and',
      clauses: [
        { kind: 'text', value: 'words' },
        { kind: 'pred', path: [reserved], op: '!', value: null },
      ],
    },
    namespace,
    {
      extend: [extension],
    },
  )
  assertEquals(db.query(statement).map((r) => r.eid), ['target'])
})

for (let eids of [['target'], []]) {
  test(`a text screen retains explicit owners: ${JSON.stringify(eids)}`, () => {
    compile(parse('Chosen'), ownerVocab, { eids, extend: [extension] })
    let rest = captured!()
    assertEquals(
      rest && db.query(rest).map((r) => Number(r.id)),
      eids.length ? [1] : [],
    )
  })
}

let unused = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    unseen: { component: true, computed: true, properties: {} },
  },
})
test('finite owner planning leaves unused computed sources unresolved', () => {
  let statement = compile(parse('.entity.eid=target'), unused)
  assertEquals(db.query(statement).map((r) => r.eid), ['target'])
})

let policies = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    person: { component: true, properties: {} },
  },
})
test('finite owner planning leaves unused visibility sources unopened', () => {
  let statement = compile(parse('.entity.eid=target'), policies, {
    visibility: { components: { person: '.unknown' } },
  })
  assertEquals(db.query(statement).map((r) => r.eid), ['target'])
})

// A narrow ranked search amid unrelated matching text, counted by workerd.
import { driver, type DurableStorage } from '@yaks/durable-object'
import { type Field, find, schema, search } from '@yaks/fts'
import { parse } from '@yaks/query'
import {
  among,
  as,
  col,
  compile,
  type Driver,
  eq,
  fn,
  insert,
  lit,
  lookup,
  not,
  render,
  select,
  table,
  val,
  when,
} from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'

export let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    comment: { component: true, properties: {} },
    prose: {
      component: true,
      properties: { body: { type: 'string', search: true } },
    },
    extra: {
      component: true,
      properties: { body: { type: 'string', search: true } },
    },
  },
})

export let text: Field[] = [
  { comp: 'prose', prop: 'body' },
  { comp: 'extra', prop: 'body' },
]
export let selected = render(select({
  cols: [as(col('entity'), 'id')],
  from: table('selected'),
}))

export let seed = (db: Driver, count: number): void => {
  db.query({
    t: 'create table',
    name: 'entity',
    cols: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'eid', type: 'text', unique: true },
    ],
  })
  for (let name of ['prose', 'extra', 'selected', 'tombstone']) {
    db.query({
      t: 'create table',
      name,
      cols: [
        { name: 'entity', type: 'integer', pk: true },
        ...['prose', 'extra'].includes(name)
          ? [{ name: 'body', type: 'text' as const }]
          : [],
      ],
    })
  }
  for (let statement of schema(text)) db.query(statement)
  db.query(insert('entity', { id: 1, eid: 'near' }, { id: 2, eid: 'far' }))
  db.query(
    insert('prose', {
      entity: 1,
      body: 'dragon dragon dragon needle needle needle',
    }, {
      entity: 2,
      body: 'a dragon among many other things here needle',
    }),
  )
  db.query(
    insert('extra', { entity: 1, body: 'dragon dragon dragon needle' }),
  )
  db.query(insert('selected', { entity: 1 }, { entity: 2 }))
  db.query({ t: 'analyze' })
  // Statistics describe a small index before its unrelated history grows.
  for (let from = 0; from < count; from += 20) {
    let ids = Array.from(
      { length: Math.min(20, count - from) },
      (_, i) => from + i + 3,
    )
    db.query(insert('entity', ...ids.map((id) => ({ id, eid: `other-${id}` }))))
    db.query(insert(
      'prose',
      ...ids.map((entity) => ({
        entity,
        body: 'dragon dragon dragon',
      })),
    ))
    // A broad screen also admits owners whose text does not match. MATCH must
    // walk its postings once, rather than repeating them for every owner.
    let others = ids.map((id) => id + count)
    db.query(
      insert('entity', ...others.map((id) => ({ id, eid: `eligible-${id}` }))),
    )
    db.query(
      insert(
        'prose',
        ...others.map((entity) => ({ entity, body: 'different' })),
      ),
    )
    db.query(insert('selected', ...others.map((entity) => ({ entity }))))
  }
}

// Sparse words in a large component: words can come from different indexes,
// and a matching entity without the required component must stay excluded.
export let mixed = (db: Driver): void => {
  db.query({
    t: 'create table',
    name: 'comment',
    cols: [{ name: 'entity', type: 'integer', pk: true }],
  })
  db.query(insert('comment', { entity: 1 }, { entity: 2 }))
  db.query({ t: 'analyze' })
  for (
    let [entity, body] of [
      [1, 'needle'],
      [2, 'needle thread'],
      [3, 'needle thread'],
    ] as const
  ) {
    db.query({
      t: 'update',
      table: 'prose',
      set: { body: val(body) },
      where: eq(col('entity'), val(entity)),
    })
  }
  db.query({
    t: 'update',
    table: 'extra',
    set: { body: val('thread') },
    where: eq(col('entity'), val(1)),
  })
  db.query({
    t: 'insert',
    or: 'ignore',
    into: 'comment',
    cols: ['entity'],
    q: select({
      cols: [col('id')],
      from: table('entity'),
      where: not(eq(col('id'), val(3))),
    }),
  })
  for (let id of [1000001, 1000002]) {
    db.query(insert('entity', { id, eid: `later-${id}` }))
    db.query(insert('prose', { entity: id, body: 'dragon' }))
    db.query(insert('comment', { entity: id }))
  }
}

// Near the Worker parameter cap: five terms search nineteen indexes, with
// either a few canonical owners or a larger list retaining broad membership.
export let wideMembership = (db: Driver) => {
  let names = Array.from({ length: 19 }, (_, i) => `wide${i}`)
  let ids = Array.from({ length: 33 }, (_, i) => `wide-owner${i}`)
  let vocabulary = loadVocab({
    $defs: {
      entity: { component: true, properties: {} },
      ...Object.fromEntries(names.map((name) => [name, {
        component: true,
        properties: { body: { type: 'string', search: true } },
      }])),
    },
  })
  let prose = names.map((comp) => ({ comp, prop: 'body' }))
  for (let name of names) {
    db.query({
      t: 'create table',
      name,
      cols: [{ name: 'entity', type: 'integer', pk: true }, {
        name: 'body',
        type: 'text',
      }],
    })
  }
  for (let statement of schema(prose)) db.query(statement)
  db.query(insert('entity', ...ids.map((eid, i) => ({ id: 5000 + i, eid }))))
  for (let name of names) {
    db.query(insert(
      name,
      ...ids.map((_eid, i) => ({
        entity: 5000 + i,
        body: 'alpha beta gamma delta epsilon',
      })),
    ))
  }
  let selected = (ids: string[]) => ({
    ids,
    statement: compile(
      parse(`alpha beta gamma delta epsilon .entity.eid=${ids.join(',')}`),
      vocabulary,
      { exactIds: true, extend: [search(prose, db)] },
    ),
  })
  return { ...selected(ids), few: selected(ids.slice(0, 4)) }
}

export let ftsCost = (storage: DurableStorage) => {
  let history = 1000
  let counting = false, read = 0, written = 0
  let db = driver(storage, (s) => {
    if (!counting) return
    read += s.rowsRead
    written += s.rowsWritten
  })
  seed(db, history)
  counting = true
  let rows = find(db, text, 'dragon', { screen: selected, limit: 2 })
  counting = false
  let ranked = { rows, read, written, history }
  read = written = 0
  counting = true
  let narrow = find(db, text, 'needle', { screen: selected, limit: 2 })
  counting = false
  let screened = { rows: narrow, read, written }
  mixed(db)
  let extension = search(text, db)
  let queries: Record<
    string,
    { rows: unknown[]; read: number; written: number }
  > = {}
  for (
    let query of [
      'needle thread .comment .limit=2',
      'dragon needle .comment .limit=2',
      'needle dragon .comment .limit=2',
      'dragon .entity.eid=later-1000001,later-1000002',
      '.comment (needle|thread)',
      'needle .comment !extra',
      'dragon .comment .order=search .limit=1005',
    ]
  ) {
    read = written = 0
    counting = true
    let statement = compile(parse(query), vocab, {
      exactIds: true,
      extend: [extension],
    })
    let rows: unknown[]
    try {
      rows = db.query(statement)
    } catch (error) {
      throw new Error(`${query}: ${statement.sql}`, { cause: error })
    }
    counting = false
    queries[query] = { rows, read, written }
  }
  let lookups: Record<
    string,
    { rows: unknown[]; read: number; written: number }
  > = {}
  let arms = Array.from(
    { length: 1000 },
    (_, i): [number, ReturnType<typeof lit>] => [i + 1, lit(i)],
  )
  let key = col('id', 'entity')
  for (
    let [name, value] of [
      [
        'linear',
        when(arms.map(([n, value]) => [lit(n), value]), lit(1000), key),
      ],
      ['stable', lookup(key, arms, { stable: true }, lit(1000))],
      ['bound', lookup(key, arms, { stable: true }, val(1000))],
    ] as const
  ) {
    read = written = 0
    counting = true
    let rows = db.query(select({
      cols: [as(fn('sum', value), 'n')],
      from: table('entity'),
    }))
    counting = false
    lookups[name] = { rows, read, written }
  }
  read = written = 0
  counting = true
  let prefixRows = db.query(compile(parse('.entity.eid=near..nearg'), vocab))
  counting = false
  let prefix = { rows: prefixRows, read, written }
  // Every text hit in this multi-term query is already a comment: eligibility
  // adds probes but cannot reduce its intermediate owner sets.
  db.query({
    t: 'update',
    table: 'prose',
    set: { body: val('dragon scale') },
    where: among(
      col('entity'),
      select({ cols: [col('entity')], from: table('comment') }),
    ),
  })
  read = written = 0
  counting = true
  let broadRows = db.query(
    compile(parse('dragon scale .comment .limit=2'), vocab, {
      extend: [extension],
    }),
  )
  counting = false
  let broad = { rows: broadRows, read, written }
  let all = db.query(compile(parse('dragon scale .comment .count'), vocab, {
    extend: [extension],
  }))
  let wide = wideMembership(db)
  read = written = 0
  counting = true
  let wideRows = db.query(wide.statement)
  counting = false
  let large = {
    rows: wideRows,
    ids: wide.ids,
    read,
    written,
    parameters: wide.statement.params.length,
  }
  read = written = 0
  counting = true
  let fewRows = db.query(wide.few.statement)
  counting = false
  return {
    ...ranked,
    screened,
    queries,
    lookups,
    prefix,
    broad,
    all,
    wide: large,
    few: {
      rows: fewRows,
      ids: wide.few.ids,
      read,
      written,
      parameters: wide.few.statement.params.length,
    },
  }
}

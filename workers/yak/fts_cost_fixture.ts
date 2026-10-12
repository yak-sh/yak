// A narrow ranked search amid unrelated matching text, counted by workerd.
import { driver, type DurableStorage } from '@yaks/durable-object'
import { type Field, find, schema, search } from '@yaks/fts'
import { parse } from '@yaks/query'
import {
  as,
  col,
  compile,
  type Driver,
  eq,
  insert,
  not,
  render,
  select,
  table,
  val,
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
    insert('prose', { entity: 1, body: 'dragon dragon dragon' }, {
      entity: 2,
      body: 'a dragon among many other things here',
    }),
  )
  db.query(insert('extra', { entity: 1, body: 'dragon dragon dragon' }))
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
  mixed(db)
  let extension = search(text, db)
  let queries: Record<
    string,
    { rows: unknown[]; read: number; written: number }
  > = {}
  for (
    let query of [
      'needle thread .comment .limit=2',
      '.comment (needle|thread)',
      'needle .comment !extra',
      'dragon .comment .order=search .limit=1005',
    ]
  ) {
    read = written = 0
    counting = true
    let rows = db.query(compile(parse(query), vocab, { extend: [extension] }))
    counting = false
    queries[query] = { rows, read, written }
  }
  return { ...ranked, queries }
}

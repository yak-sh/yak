// A narrow ranked search amid unrelated matching text, counted by workerd.
import { driver, type DurableStorage } from '@yaks/durable-object'
import { type Field, find, schema } from '@yaks/fts'
import { as, col, type Driver, insert, render, select, table } from '@yaks/sql'

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
  return { rows, read, written, history }
}

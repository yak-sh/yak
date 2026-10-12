// The adapter's affected rows, and what asking for them bills in workerd.
import { driver, type DurableStorage } from '@yaks/durable-object'
import { col, eq, insert, lit, select, table, val } from '@yaks/sql'

export let sqlRun = (storage: DurableStorage) => {
  let counting = false
  let cost = { read: 0, written: 0 }
  let sql = driver(storage, (s) => {
    if (!counting) return
    cost.read += s.rowsRead
    cost.written += s.rowsWritten
  })
  sql.query({
    t: 'create table',
    name: 'item',
    cols: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'value', type: 'integer' },
    ],
  })
  sql.query({
    t: 'create table',
    name: 'audit',
    cols: [{ name: 'value', type: 'integer' }],
  })
  sql.query({
    t: 'create trigger',
    name: 'edited',
    on: 'item',
    timing: 'after',
    event: 'update',
    body: [{ t: 'insert', into: 'audit', cols: ['value'], rows: [[lit(1)]] }],
  })
  let run = sql.run
  if (!run) {
    throw new Error('Durable Object driver has no affected-row interface')
  }
  let counts = [run(insert('item', { id: 1, value: 1 }))]
  counts.push(run({ ...insert('item', { id: 1 }), or: 'ignore' }))
  let update = {
    t: 'update' as const,
    table: 'item',
    set: { value: val(2) },
    where: eq(col('id'), val(1)),
  }
  counting = true
  counts.push(run(update))
  let changed = { ...cost }
  cost = { read: 0, written: 0 }
  sql.query({ ...update, returning: [col('id')] })
  let returned = { ...cost }
  counting = false
  counts.push(run(update))
  counts.push(run({ ...update, where: eq(col('id'), val(99)) }))
  counts.push(run({ t: 'delete', from: 'item', where: eq(col('id'), val(1)) }))
  counts.push(run({ t: 'delete', from: 'item' }))
  let rolled = false
  try {
    sql.tx!(() => {
      counts.push(run(insert('item', { id: 2, value: 3 })))
      counts.push(run({ ...update, where: eq(col('id'), val(2)) }))
      throw new Error('rollback')
    })
  } catch (e) {
    if (!(e instanceof Error) || e.message != 'rollback') throw e
    rolled = true
  }
  return {
    counts,
    changed,
    returned,
    rolled,
    rows: sql.query(select({ from: table('item') })),
    audits: sql.query(select({ from: table('audit') })).length,
  }
}

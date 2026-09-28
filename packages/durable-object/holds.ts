// Subscription maps too large for a socket attachment live in the object's
// SQLite. The attachment carries their key; serial delivery stays on the
// socket, so acknowledging or relaying a frame never writes this table.

import { col, eq, select, table, val } from '@yaks/sql'
import { driver, type DurableStorage } from './sql.ts'

let NAME = 'socket_subscriptions'

export let holds = (storage: DurableStorage) => {
  let sql = driver(storage)
  sql.query({
    t: 'create table',
    name: NAME,
    ifNot: true,
    cols: [
      { name: 'id', type: 'text', pk: true },
      { name: 'queries', type: 'text', notNull: true },
    ],
  })
  return {
    read: (id: string): Record<string, string | true> => {
      let [row] = sql.query(select({
        cols: [col('queries')],
        from: table(NAME),
        where: eq(col('id'), val(id)),
      }))
      if (!row) throw new Error(`socket subscriptions missing: ${id}`)
      return JSON.parse(String(row.queries))
    },
    write: (id: string, queries: Record<string, string | true>) =>
      void sql.query({
        t: 'insert',
        or: 'replace',
        into: NAME,
        cols: ['id', 'queries'],
        rows: [[val(id), val(JSON.stringify(queries))]],
      }),
    delete: (id: string) =>
      void sql.query({
        t: 'delete',
        from: NAME,
        where: eq(col('id'), val(id)),
      }),
  }
}

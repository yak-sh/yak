import {
  col,
  type CreateTable,
  type Driver,
  eq,
  select,
  table,
  val,
} from '@yaks/sql'
import type {
  RegionalCopyPersistence,
  RegionalCopySnapshot,
} from './regional-serving-copy.ts'

let STATE: CreateTable = {
  t: 'create table',
  name: 'regional_state',
  ifNot: true,
  cols: [{ name: 'id', type: 'integer', pk: true }, {
    name: 'body',
    type: 'text',
  }],
}
let ANSWERS: CreateTable = {
  t: 'create table',
  name: 'regional_answers',
  ifNot: true,
  cols: [
    { name: 'key', type: 'text', pk: true },
    { name: 'body', type: 'text' },
    { name: 'position', type: 'integer' },
  ],
}

/** Route bodies survive eviction; invalidation deletes them with the epoch update. */
export let regionalStorage = (
  sql: Pick<Driver, 'query'> & Required<Pick<Driver, 'tx'>>,
): RegionalCopyPersistence => {
  let position = 0
  return {
    read: () => {
      sql.query(STATE)
      sql.query(ANSWERS)
      let [row] = sql.query(select({
        cols: [col('body')],
        from: table(STATE.name),
        where: eq(col('id'), val(1)),
      }))
      if (!row) return undefined
      let answers = sql.query(select({
        cols: [col('key'), col('body'), col('position')],
        from: table(ANSWERS.name),
        order: [col('position')],
      }))
      position = Number(answers.at(-1)?.position ?? 0)
      return {
        state: JSON.parse(String(row.body)) as RegionalCopySnapshot['state'],
        answers: answers.map(({ key, body }) => [String(key), String(body)]),
      }
    },
    write: ({ state, clear, remove, put }) => {
      let next = (clear ? 0 : position) + (put ? 1 : 0)
      sql.tx(() => {
        sql.query({
          t: 'insert',
          or: 'replace',
          into: STATE.name,
          cols: ['id', 'body'],
          rows: [[val(1), val(JSON.stringify(state))]],
        })
        if (clear) {
          sql.query({ t: 'delete', from: ANSWERS.name })
        }
        for (let key of remove ?? []) {
          sql.query({
            t: 'delete',
            from: ANSWERS.name,
            where: eq(col('key'), val(key)),
          })
        }
        if (put) {
          sql.query({
            t: 'insert',
            or: 'replace',
            into: ANSWERS.name,
            cols: ['key', 'body', 'position'],
            rows: [[val(put[0]), val(put[1]), val(next)]],
          })
        }
      })
      position = next
    },
  }
}

// The public directory's serving copy (index.ts `PublicDirectory`), one
// object beside the directory that holds what it last published.
import { Durable, type State } from '@yaks/durable-object/object'
import { driver } from '@yaks/durable-object/sql'
import { col, type CreateTable, eq, select, table, val } from '@yaks/sql'
import { caught } from './defects.ts'
import type { Env } from './env.ts'
import {
  ServingCopy,
  type ServingCopyState,
  ServingCopyUnavailable,
} from './serving-copy.ts'

// The one row the copy keeps: its ceiling.
let COPY: CreateTable = {
  t: 'create table',
  name: 'copy',
  ifNot: true,
  cols: [{ name: 'id', type: 'integer', pk: true }, {
    name: 'body',
    type: 'text',
  }],
}

// What a cold or fenced copy answers a read: nothing, for the directory to.
let unavailable = <T>(read: () => T): T | null => {
  try {
    return read()
  } catch (e) {
    if (e instanceof ServingCopyUnavailable) return null
    throw e
  }
}

// Independent of yak/platform: only a missed directory deadline reads here.
// An object that holds no graph: each RPC method is an entry of its own, over
// the copy in its memory, whose ceiling is its one row of SQL.
export class PublicDirectoryStore extends Durable {
  #made?: ServingCopy
  constructor(ctx: State, _env: Env) {
    super(ctx, {
      report: (e, entry) => caught(e, { request: `public directory ${entry}` }),
    })
  }
  // The copy, made at the first entry that reaches it: its ceiling read, its
  // table made once an instance.
  get #copy(): ServingCopy {
    return this.#made ??= this.#open()
  }
  #open() {
    let sql = driver(this.ctx.storage)
    return new ServingCopy({
      persistence: {
        read: () => {
          sql.query(COPY)
          let [row] = sql.query(select({
            cols: [col('body')],
            from: table('copy'),
            where: eq(col('id'), val(1)),
          }))
          if (!row) return undefined
          // A row saved before the ceiling holds the last fence granted.
          let saved = JSON.parse(String(row.body)) as
            | ServingCopyState
            | { revision: number }
          return 'ceiling' in saved ? saved : { ceiling: saved.revision }
        },
        write: (state) =>
          void sql.query({
            t: 'insert',
            or: 'replace',
            into: 'copy',
            cols: ['id', 'body'],
            rows: [[val(1), val(JSON.stringify(state))]],
          }),
      },
    })
  }
  // An entry named `entry`, over the copy.
  #at<T>(entry: string, work: (copy: ServingCopy) => T): Promise<T> {
    return this.enter(entry, () => work(this.#copy))
  }
  valid(revision: number) {
    return this.#at('valid', (c) => c.valid(revision))
  }
  publish(revision: number, key: string, body: string) {
    return this.#at('publish', (c) => c.publish(revision, key, body))
  }
  publishes(answers: [number, string, string][]) {
    return this.#at('publishes', (c) => c.publishes(answers))
  }
  read(key: string) {
    return this.#at('read', (c) => unavailable(() => c.read(key)))
  }
  begin(committed?: number) {
    return this.#at('begin', (c) => c.begin(committed))
  }
  revision() {
    return this.#at('revision', (c) => c.revision)
  }
  finish(revision: number) {
    return this.#at('finish', (c) => c.finish(revision))
  }
  settle(revision: number, committed: number) {
    return this.#at('settle', (c) => c.settle(revision, committed))
  }
  put(revision: number, key: string, body: string) {
    return this.#at('put', (c) => c.put(revision, key, body))
  }
  get(key: string) {
    return this.#at('get', (c) => unavailable(() => c.get(key)))
  }
}

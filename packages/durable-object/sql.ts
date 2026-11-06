// The Durable Object's SQLite, reduced to the two things a store needs from a
// connection — a parameterized statement, and a transaction — and shaped as
// @yaks/sql's `Driver`. That is the whole trick of this package: the schema,
// the compiled reads, the patches and the death cascade are @yaks/sqlite's
// already, and a Durable Object is one more place to run them.
//
// Two things about the runtime shape the code here, both checked against
// workerd rather than the docs alone:
//
//   Values are narrow. A binding must be an ArrayBuffer, a string, a number or
//   null. A boolean would bind as the text 'true' and a bigint throws, so both
//   are converted before they reach the engine, and a blob comes back as an
//   ArrayBuffer where every other adapter hands back bytes.
//
//   Transactions are not SQL. `begin`, `savepoint` and their friends are
//   refused as statements; `transactionSync` is the transaction, and it nests.
//   That is what `Driver.tx` exists for.

import {
  as,
  col,
  type Driver,
  fn,
  inlined,
  type Param,
  render,
  type Row,
  select,
  shape,
  statement,
  type Stmt,
  table,
  writing,
} from '@yaks/sql'
import { EPOCH, epochAt, meta } from '@yaks/sqlite'
import { during, measure as traced, peek } from '@yaks/trace'

/** A value the engine will bind: everything else is converted first. */
export type SqlValue = ArrayBuffer | string | number | null

/**
 * A table Cloudflare owns inside the object's SQLite. `_cf_KV` is the one
 * behind `ctx.storage.kv` — the docs spell it `__cf_kv` and the engine reports
 * it as `_cf_KV`, so neither the case nor the number of underscores is worth
 * trusting — and `_cf_METADATA` is its neighbour.
 *
 * These are not merely uninteresting: workerd's SQL authorizer refuses them to
 * the object's own statements — `access to _cf_KV.key is prohibited:
 * SQLITE_AUTH` — while still listing them in `sqlite_master`. So anything that
 * enumerates tables and then reads them must skip these or throw (T-34019).
 */
export let prohibited = (name: string): boolean => /^_+cf_/i.test(name)

/**
 * Every table the object does not own: {@link prohibited} plus SQLite's own
 * catalogue, which is readable but is nobody's data.
 */
export let reserved = (name: string): boolean =>
  prohibited(name) || /^sqlite_/i.test(name)

/** What `exec` hands back — the rows, drained with `toArray()`. */
export type SqlCursor<T> = Iterable<T> & {
  /** every remaining row, read at once */
  toArray(): T[]
  /** The runtime's metered rows, available after the cursor is drained. */
  rowsRead?: number
  rowsWritten?: number
}

export type Sample = {
  shape: string
  rowsRead: number
  rowsWritten: number
}

export type Observe = (sample: Sample) => void
export type Measure = (rowsRead?: number, rowsWritten?: number) => void

/**
 * The synchronous SQLite handle of a Durable Object — the shape of
 * `ctx.storage.sql`, reduced to the one method this package calls. Naming just
 * this keeps the adapter free of any Cloudflare dependency; a `SqlStorage`
 * satisfies it.
 */
export type DurableSql = {
  /** The runtime's stored-byte count, without a SQL statement. */
  readonly databaseSize?: number
  /** run a statement with its bindings and hand back the rows */
  exec(query: string, ...bindings: SqlValue[]): SqlCursor<Row>
}

/**
 * The object's storage — the shape of `ctx.storage`: its SQLite handle, and
 * the transaction the runtime insists on. `transactionSync` nests, commits
 * when the body returns, and rolls back when it throws.
 */
export type DurableStorage = {
  /** the embedded SQLite engine */
  sql: DurableSql
  /** run a body as one all-or-nothing unit of work */
  transactionSync<T>(body: () => T): T
}

// A value as the engine takes it. `undefined` and `null` are the same absence;
// a boolean is the 0/1 an integer column holds; a bigint is a number (workerd
// refuses one outright); a byte array is the ArrayBuffer it is a window onto.
let bind = (value: Param): SqlValue =>
  value == null
    ? null
    : typeof value == 'boolean'
    ? Number(value)
    : typeof value == 'bigint'
    ? Number(value)
    : value instanceof Uint8Array
    ? value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer
    : value

// A row as the rest of the stack expects it: a blob is bytes, the way every
// other driver hands one back.
let unbind = (row: Row): Row => {
  for (let key in row) {
    let value = row[key]
    if (value instanceof ArrayBuffer) row[key] = new Uint8Array(value)
  }
  return row
}

// What one object's `make` wrote (Driver.template), kept for the next object
// this isolate makes the same way: by its key and the objects that stood
// before it. An object's schema is hundreds of statements, each a call into
// the engine and most a page of the file; the same schema run again as a
// script is a few calls. A few kinds of store make one each.
let templates = new Map<string, string[]>()
let TEMPLATES = 16
// The statements a template is being made of, by the storage they run on:
// every driver over one object's storage writes the same file.
let making = new WeakMap<DurableStorage, string[]>()
// workerd refuses a statement longer than 100,000 characters; a script is
// cut before that.
let SCRIPT = 90_000

// The pragmas that only ask: the rest (`optimize`, a setting) may change the
// file, and a template keeps them.
let ASKING = new Set([
  'data_version',
  'database_list',
  'foreign_key_list',
  'foreign_keys',
  'freelist_count',
  'index_info',
  'index_list',
  'index_xinfo',
  'page_count',
  'page_size',
  'table_info',
  'table_list',
  'table_xinfo',
])

// A statement that leaves the file as it found it, which a template need not
// run again: a read, and a pragma that asks.
let asks = (s: Stmt): boolean =>
  s.t == 'raw'
    ? s.origin ? asks(s.origin) : /^\s*select\b/i.test(s.sql)
    : s.t == 'select' || s.t == 'compound' || s.t == 'values' ||
      s.t == 'each' || s.t == 'explain query plan' ||
      s.t == 'pragma' && s.value == null && ASKING.has(s.name)

// Statements as scripts, each short of the engine's limit.
let scripts = (texts: string[]): string[] =>
  texts.reduce<string[]>((out, text) => {
    let last = out.length - 1
    if (last >= 0 && out[last].length + text.length + 2 <= SCRIPT) {
      out[last] += ';\n' + text
    } else out.push(text)
    return out
  }, [])

/**
 * A {@link https://jsr.io/@yaks/sql | @yaks/sql} `Driver` over a Durable
 * Object's storage. It converts the values the engine will not take, hands the
 * transaction back to `transactionSync`, and turns foreign keys on — the
 * enforcement the schema's references are written for, which workerd leaves off
 * per connection.
 *
 * ```ts
 * // let store = storage(ctx.storage, vocab) // …which is this, bound
 * ```
 */
export let driver = (
  durable: DurableStorage,
  observe?: Observe,
  measure?: Measure,
): Driver => {
  let reported = false
  // The cursor is lazy: draining it is what runs the statement.
  let execute = (s: Stmt): Row[] => {
    let rendered = render(s)
    let rows = exec(rendered.sql, rendered.params, () => shape(rendered))
    if (!asks(s)) making.get(durable)?.push(inlined(rendered))
    return rows
  }
  let exec = (sql: string, params: Param[], said: () => string): Row[] => {
    let cursor: SqlCursor<Row> | undefined
    try {
      cursor = durable.sql.exec(sql, ...params.map(bind))
      let rows = cursor.toArray().map(unbind)
      if (observe && cursor.rowsRead != null && cursor.rowsWritten != null) {
        try {
          observe({
            shape: said(),
            rowsRead: cursor.rowsRead,
            rowsWritten: cursor.rowsWritten,
          })
        } catch (e) {
          // A broken observer cannot change a store answer, but its defect must
          // still be visible. Each driver reports it at most once.
          if (!reported) console.error('row profile observer failed', e)
          reported = true
        }
      } else if (observe && !reported) {
        console.error('row profile cursor counters unavailable')
        reported = true
      }
      return rows
    } finally {
      // A statement that failed still cost a call to the engine.
      if (peek()) {
        traced({
          statements: 1,
          ...cursor?.rowsRead != null ? { rowsRead: cursor.rowsRead } : {},
          ...cursor?.rowsWritten != null
            ? { rowsWritten: cursor.rowsWritten }
            : {},
        })
      }
      try {
        measure?.(cursor?.rowsRead, cursor?.rowsWritten)
      } catch (e) {
        if (!reported) console.error('statement meter failed', e)
        reported = true
      }
    }
  }
  let query = (s: Stmt): Row[] => {
    let c = peek()
    if (!c) return execute(s)
    return during(
      c.begin({
        kind: 'sql',
        name: statement(s),
        package: '@yaks/durable-object',
      }),
      () => execute(s),
    )
  }
  query({ t: 'pragma', name: 'foreign_keys', value: 'on' })
  let d: Driver = {
    query,
    run: (s) => {
      query(s)
      // Cursor rowsWritten includes indexes and triggers, whereas the writer
      // needs rows this statement affected. changes() answers that without
      // materializing RETURNING rows, and its scalar query reads no table.
      return writing(s)
        ? Number(query(select({ cols: [as(fn('changes'), 'n')] }))[0].n)
        : 0
    },
    // What a body rolled back is no part of a template being made.
    tx: (body) => {
      let wrote = making.get(durable), at = wrote?.length ?? 0
      try {
        return durable.transactionSync(body)
      } catch (e) {
        wrote?.splice(at)
        throw e
      }
    },
    statistics: durable.sql.databaseSize == null
      ? undefined
      : { bytes: () => durable.sql.databaseSize! },
    // Every driver over one object's storage is one connection.
    connection: durable,
    template: (key, make) => {
      let at = key + '\n' + JSON.stringify(query(select({
        cols: [col('type'), col('name'), col('sql')],
        from: table('sqlite_schema'),
        order: [col('name')],
      })))
      let kept = templates.get(at)
      if (kept) {
        for (let script of kept) exec(script, [], () => 'template')
        // A copy is a store of its own: it never takes the lineage identity
        // of the one its template was made in (@yaks/sqlite `epoch`).
        if (epochAt(d)) meta(d).set(EPOCH, crypto.randomUUID())
        return
      }
      // A template asked for inside another's make is part of that one.
      if (making.has(durable)) return void make()
      let wrote: string[] = []
      making.set(durable, wrote)
      let made: boolean | void
      try {
        made = make()
      } finally {
        making.delete(durable)
      }
      if (made === false) return
      templates.delete(at)
      templates.set(at, scripts(wrote))
      if (templates.size > TEMPLATES) {
        templates.delete(templates.keys().next().value!)
      }
    },
  }
  return d
}

// Statements and tracing are shared by the native writer and file reader;
// preparing, binding and decoding belong to their engine boundaries.
import { context, leaf, peek } from '@yaks/trace'
import type { Vocab } from '@yaks/vocab'
import {
  asWritten,
  type Driver,
  excerpt,
  labeled,
  type Param,
  renderStable,
  type Row,
  statement,
  type Stmt,
  STOCK,
  STOCK_DEPTH,
  STOCK_VARIABLES,
  writing,
} from '@yaks/sql/core'

// A statement SQLite will not compile or run says which it was: the message
// names the fault, and only the statement shows where it is, once the error
// has crossed a worker and reached its caller and the tracker (its enumerable
// properties do). A kept statement is compiled again at its step when the
// schema moved under it, so a fault of compiling can surface there too.
let naming =
  (run: (sql: string, params: Param[]) => Row[]) =>
  (sql: string, params: Param[]): Row[] => {
    try {
      return run(sql, params)
    } catch (error) {
      throw error instanceof Error
        ? Object.assign(error, { statement: sql })
        : error
    }
  }

// An embedded SQLite's limits are the stock ones.
let render = (s: Stmt, v?: Vocab) =>
  renderStable(s, STOCK_VARIABLES, STOCK_DEPTH, v)

export let driver = (
  ran: (sql: string, params: Param[]) => Row[],
  opts: { file: boolean; before?: (s: Stmt) => void; changes?: () => number },
): Driver => {
  let run = naming(ran)
  let stored: { v?: Vocab } = {}
  // Rows come back, and a refusal is told, under the names the statement
  // wrote (@yaks/sql `asWritten`, `labeled`).
  let query = (s: Stmt): Row[] =>
    labeled(() => asWritten(s, ask(s), stored.v), stored.v)
  let ask = (s: Stmt): Row[] => {
    opts.before?.(s)
    // Each statement is kept by its text (./native.ts `prepared`), and a list
    // costs no rows here: every collection binds as one JSON array.
    let rendered = render(s, stored.v), { sql, params } = rendered
    let at = context()
    let c = at?.channel ?? peek(d)
    if (!c) return run(sql, params)
    let wrote = writing(s), n = 0
    return leaf(
      c.begin({
        kind: 'sql',
        name: statement(s),
        package: '@yaks/sqlite',
        parent: at?.channel == c ? at.parent : undefined,
        sql: excerpt(rendered),
      }),
      () => {
        let rows = run(sql, params)
        n = wrote ? opts.changes?.() ?? 0 : rows.length
        return rows
      },
      () => ({
        statements: 1,
        rowsRead: wrote ? 0 : n,
        rowsWritten: wrote ? n : 0,
      }),
      () => ({ rows: n }),
    )
  }
  let d: Driver = {
    query,
    render,
    stored,
    file: opts.file,
    statistics: opts.file ? 'sampled' : undefined,
    arms: STOCK,
    stable: true,
  }
  return d
}

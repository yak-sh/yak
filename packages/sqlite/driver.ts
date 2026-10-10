// Statements and tracing are shared by the native writer and file reader;
// preparing, binding and decoding belong to their engine boundaries.
import { context, leaf, peek } from '@yaks/trace'
import {
  type Driver,
  excerpt,
  type Param,
  render,
  type Row,
  statement,
  type Stmt,
  STOCK,
  writing,
} from '@yaks/sql'

export let driver = (
  run: (sql: string, params: Param[]) => Row[],
  opts: { file: boolean; before?: (s: Stmt) => void; changes?: () => number },
): Driver => {
  let query = (s: Stmt): Row[] => {
    opts.before?.(s)
    let rendered = render(s), { sql, params } = rendered
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
  let d: Driver = { query, file: opts.file, arms: STOCK }
  return d
}

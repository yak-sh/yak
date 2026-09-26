import {
  among,
  as,
  by,
  col,
  count,
  type Driver,
  each,
  eq,
  fn,
  type Param,
  type Row,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'

/** Every table the file's schema lists, with the statement it was made by. */
export let defined: Stmt = select({
  cols: [col('name'), col('sql')],
  from: table('sqlite_schema'),
  where: eq(col('type'), val('table')),
  order: [col('name')],
})

/** Every table the file's schema lists, by name. */
export let tables = (driver: Driver): string[] =>
  driver.query(defined).map((r) => String(r.name))

/** A table as the file holds it: its columns (`pragma table_info`), the
 * columns it keys to another table, and what each column checks
 * ({@link checks}). */
export type Stood = {
  cols: Row[]
  keys: string[]
  checks: Record<string, string>
}

/** What is asked of each table `names` names: its columns, then its keys. */
export let asked = (names: string[]): Stmt[] =>
  names.flatMap((arg): Stmt[] => [
    { t: 'pragma', name: 'table_info', arg },
    { t: 'pragma', name: 'foreign_key_list', arg },
  ])

/** The answers to {@link asked}, as each table's {@link Stood}. `defs` is what
 * {@link defined} answered. */
export let heard = (
  defs: Row[],
  names: string[],
  answers: Row[][],
): Record<string, Stood> =>
  Object.fromEntries(names.map((name, i) => [name, {
    cols: answers[2 * i],
    keys: answers[2 * i + 1].map((r) => String(r.from)),
    checks: checks(String(defs.find((d) => d.name == name)?.sql ?? '')),
  }]))

/** Each table `pick` keeps, as the file holds it now, read through a driver
 * that answers at once. */
export let stood = (
  driver: Driver,
  pick: (name: string) => boolean,
): Record<string, Stood> => {
  let defs = driver.query(defined)
  let names = defs.map((d) => String(d.name)).filter(pick)
  return heard(defs, names, asked(names).map((s) => driver.query(s)))
}

// SQLite's tokens, as far as reading a definition back needs them: a string, a
// quoted name, a word or a number, or one character of punctuation.
let TOKEN =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[\w$]+|[^\s\w]/g

// A token as SQLite compares it: a name unquoted, a name or a keyword in lower
// case, a string as written.
let norm = (t: string): string =>
  t[0] == "'" ? t : (/^["`[]/.test(t) ? t.slice(1, -1) : t).toLowerCase()

// The index of the parenthesis that closes the one at `at`.
let close = (tokens: string[], at: number): number => {
  for (let i = at, depth = 0; i < tokens.length; i++) {
    depth += tokens[i] == '(' ? 1 : tokens[i] == ')' ? -1 : 0
    if (!depth) return i
  }
  return tokens.length
}

// Each parenthesized run directly in `tokens`, as the tokens it encloses and
// the token before it.
let runs = (tokens: string[]): [string, string[]][] => {
  let out: [string, string[]][] = []
  for (let i = tokens.indexOf('('); i >= 0; i = tokens.indexOf('(', i + 1)) {
    let end = close(tokens, i)
    out.push([tokens[i - 1] ?? '', tokens.slice(i + 1, end)])
    i = end
  }
  return out
}

// A table's columns and constraints, each as its tokens: the first run of its
// definition, split at the commas directly inside it.
let defs = (tokens: string[]): string[][] => {
  let [[, inner] = ['', []]] = runs(tokens)
  let out: string[][] = [[]]
  for (let i = 0; i < inner.length; i++) {
    let end = inner[i] == '(' ? close(inner, i) : i
    if (inner[i] == ',') out.push([])
    else out.at(-1)!.push(...inner.slice(i, end + 1))
    i = end
  }
  return out
}

// The keywords a table constraint starts with, where a column starts with its
// name.
let CONSTRAINT = new Set([
  'constraint',
  'primary',
  'unique',
  'check',
  'foreign',
])

/**
 * What a table's definition checks, by the column each check sits on (a table
 * constraint's under `''`): the expression as its tokens compare, so one check
 * reads the same however it was spaced, cased or quoted. Read off the statement
 * `sqlite_schema` keeps, because SQLite lists a table's columns and keys by
 * pragma and has no pragma for a check.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { checks } from '@yaks/sqlite'
 *
 * let kind = { kind: "kind in ( 'A' , 'b' )" }
 * assertEquals(
 *   checks(`CREATE TABLE "t" (id integer, "kind" text check("kind" in ('A', 'b')))`),
 *   kind,
 * )
 * assertEquals(checks(`create table t (Kind TEXT CHECK (kind IN ('A','b')))`), kind)
 * assertEquals(checks(`create table t (id integer, check (id > 0))`), {
 *   '': 'id > 0',
 * })
 * assertEquals(checks(`create table t (id integer)`), {})
 * ```
 */
export let checks = (sql: string): Record<string, string> => {
  let found: Record<string, string[]> = {}
  for (let def of defs(sql.match(TOKEN) ?? [])) {
    let [head = ''] = def
    let on = CONSTRAINT.has(head.toLowerCase()) ? '' : norm(head)
    for (let [before, expr] of runs(def)) {
      if (before.toLowerCase() != 'check') continue
      found[on] = [...found[on] ?? [], expr.map(norm).join(' ')]
    }
  }
  return Object.fromEntries(
    Object.entries(found).map(([on, all]) => [on, all.join(' and ')]),
  )
}

/** What the file's schema holds — each table, index, view and trigger, with
 * the table it is on and its definition — or the entries these fields name. */
export let objects = (
  driver: Driver,
  fields: Record<string, Param> = {},
): Row[] =>
  driver.query(select({
    cols: [col('type'), col('name'), col('tbl_name'), col('sql')],
    from: table('sqlite_schema'),
    where: by(fields),
    order: [col('name')],
  }))

/** A table's columns, in declaration order. */
export let columns = (driver: Driver, name: string): string[] =>
  driver.query({ t: 'pragma', name: 'table_info', arg: name })
    .map((c) => String(c.name))

/**
 * Component tables actually in the file, irrespective of the loaded vocabulary.
 * Virtual/FTS shadow tables and infrastructure are not component tables. A
 * component table has an integer entity primary key. Tombstone and archetype
 * are component tables (the latter's own archetype is the one-element fixed
 * point). `known` names tables the caller already accounts for: they are left
 * out without being asked about.
 */
export function componentTables(
  driver: Driver,
  known: readonly string[] = [],
): string[] {
  let skip = new Set(['entity', 'journal', 'hit', ...known])
  let ordinary = new Set(
    driver.query({ t: 'pragma', name: 'table_list' })
      .filter((r) => r.schema == 'main' && r.type == 'table')
      .map((r) => String(r.name)),
  )
  return tables(driver)
    .filter((name) =>
      ordinary.has(name) && !skip.has(name) &&
      !name.startsWith('sqlite_') && !/^_+cf_/i.test(name)
    )
    .filter((name) =>
      driver.query({ t: 'pragma', name: 'table_info', arg: name })
        .some((r) =>
          r.name == 'entity' && Number(r.pk) == 1 &&
          String(r.type).toLowerCase() == 'integer'
        )
    )
}

/**
 * How many of the named objects the file's schema holds and how long their
 * definitions run together: what moves when one of them is created, dropped
 * or altered, by any connection. Read from `sqlite_schema`, since a Durable
 * Object's SQLite refuses `pragma schema_version`. Only the named objects
 * count, so what is kept beside them (a search index and its triggers, a
 * plugin's own table, the `sqlite_stat1` the first analyze creates) is no
 * change to them.
 */
export let shape = (driver: Driver, names: readonly string[]): string => {
  let [row] = driver.query(select({
    cols: [
      as(count(), 'n'),
      as(fn('total', fn('length', col('sql'))), 'bytes'),
    ],
    from: table('sqlite_schema'),
    where: among(col('name'), each(names)),
  }))
  return `${row.n}/${row.bytes}`
}

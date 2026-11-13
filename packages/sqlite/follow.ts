// A graph's schema follows its vocabulary wherever the graph is opened for
// writing (D-121389). Everything a file needs is one composed schema, and the
// schema has one print. A file records each print it has been brought to, as
// the `server_meta` row `schema:<print>`; an opener whose print is recorded
// opens with no DDL and no write lock, and one whose print is missing runs the
// pass that brings the file to it, then records it. A recorded print stays
// recorded while the file only grows, so a process still running the
// vocabulary a landing replaced finds its own print and changes nothing; a
// pass that sheds what its vocabulary stopped naming forgets the others.
//
// Two openers that find the same print missing both run the pass: every step
// of it reads the file under the write lock before it changes anything, so the
// second one finds nothing left to do. An index over a populated table, a
// text index over one, and a big table's refit are written down instead, for
// the effects worker to do in windows (./owe.ts).

import {
  catalogue,
  type Column,
  type Driver,
  render,
  type SchemaObject,
  type Stmt,
} from '@yaks/sql/core'
import {
  col,
  type Derived,
  field,
  lit,
  notNull,
  select,
  table,
  tagOf,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { sha256 } from '@yaks/graph/sha256'
import {
  analyzedAt,
  installation,
  installed,
  meta,
  PRINTED,
  printed,
  prints,
  SCHEMA,
} from './meta.ts'
import { unit } from './unit.ts'
import { build, holds as rowed } from './owe.ts'
import { plan, planned } from './plan.ts'
import { behind, declares, exact } from './ddl.ts'
import { tables } from './layout.ts'
import { recorded, unraised } from './raise.ts'
import { columns, componentTables, pinned, words } from './physical.ts'

/** The print of a composed schema: a store's own print (`Store.print`) and
 * every further statement the file needs, rendered. */
export let printOf = (store: string, stmts: Stmt[]): string =>
  sha256([store, ...stmts.map((s) => render(s).sql)].join(';\n'))

/** What `Store.print` says, known from the vocabulary alone: for a host that
 * composes its print before it binds the store it will open with it, the way
 * a yaks.app store keeps one print per vocabulary it has seen. */
export let printFor = (
  vocab: Vocab,
  derived: Derived = {},
  file = false,
): string => plan(vocab, derived, file).print

/** {@link printFor}, digested by the platform: a host that can wait before it
 * binds the store it opens asks this first, and the store finds its print
 * made rather than digesting a hundred kilobytes of statements in script. */
export let printing = (
  vocab: Vocab,
  derived: Derived = {},
  file = false,
): Promise<string> => planned(vocab, derived, file).then((p) => p.print)

// A column as `add column` takes it onto a standing table: SQLite refuses a
// key or a unique column there, a NOT NULL without a literal default, and a
// default that is an expression. The CHECK waits for the table's refit, since
// adding one reads every row; admission holds the writes meanwhile.
let added = (c: Column): Column => {
  let d = c.default?.t == 'lit' ? c.default : undefined
  return {
    name: c.name,
    type: c.type,
    notNull: c.notNull && !!d,
    default: d,
    ref: c.ref,
  }
}

/** The `add column` statements the tables `stmts` create are missing where
 * they already stand: `create table if not exists` does nothing to a table
 * that is there, so a column a table gained after it was made arrives here.
 * `held` is the schema as it stood before `stmts` ran (`catalogue`): a table
 * it lacks was made whole by the first statement naming it, and one it holds
 * as a statement declares it has every column, so neither is asked about. */
export let grow = (
  driver: Driver,
  stmts: Stmt[],
  held: readonly SchemaObject[] = catalogue(driver),
): Stmt[] => {
  let stood = new Map(held.map((o) => [o.name, o.sql]))
  let made = new Set<string>()
  return stmts.flatMap((s) => {
    if (s.t != 'create table') return []
    if (!stood.has(s.name) && !made.has(s.name)) {
      made.add(s.name)
      return []
    }
    if (declares(stood.get(s.name) ?? null, s)) return []
    let has = new Set(
      driver.query({ t: 'pragma', name: 'table_info', arg: s.name })
        .map((r) => String(r.name)),
    )
    if (!has.size) return []
    return s.cols.filter((c) => !has.has(c.name)).map((c) => ({
      t: 'alter table' as const,
      table: s.name,
      add: added(c),
    }))
  })
}

/** Run `stmts`, each of which only adds what is missing, then the columns
 * their standing tables lack, in one unit under the write lock. An index over
 * a populated table is owed rather than built, and a unique index the rows
 * already there break is left unbuilt and returned for the caller to report
 * (./owe.ts). */
export let add = (driver: Driver, stmts: Stmt[]): Error[] =>
  unit(driver, () => {
    let held = catalogue(driver)
    let left = build(driver, stmts)
    for (let s of grow(driver, stmts, held)) driver.query(s)
    return left
  })

/** What a composed schema names, for {@link follow} to shed what a file holds
 * beyond it: the tables and columns the store of `vocab` makes, and the tables
 * `beside` makes. */
export type Named = { vocab: Vocab; beside?: readonly Stmt[] }

// Whether any row of `name` holds a value in its column `c`.
let valued = (driver: Driver, name: string, c: string): boolean =>
  driver.query(select({
    cols: [lit(1)],
    from: table(name),
    where: notNull(col(c)),
    limit: lit(1),
  })).length > 0

/** A component's table, or a table and one of its columns. */
export type Seat = readonly [table: string, column?: string]

type Kind = 'index' | 'trigger' | 'view'
let dropOf = (kind: Kind, name: string): Stmt => ({
  t: 'drop',
  kind,
  name,
  ifExists: true,
})

// The statements dropping `seat`: each view and trigger naming its table, or
// each index, trigger and view naming the table and its column, which SQLite
// refuses a column's drop for while they stand and a table's drop leaves
// standing over nothing, and then the table or the column.
let unseating = (driver: Driver, [t, c]: Seat): Stmt[] => [
  ...catalogue(driver).flatMap((o) => {
    if (o.type == 'table' || o.sql == null || !c && o.type == 'index') {
      return []
    }
    let said = words(o.sql)
    let names = said.has(t.toLowerCase()) && (!c || said.has(c.toLowerCase()))
    return names ? [dropOf(o.type as Kind, o.name)] : []
  }),
  c
    ? { t: 'alter table', table: t, drop: c }
    : { t: 'drop', kind: 'table', name: t, ifExists: true },
]

// The view or trigger SQLite says will not stand once a column goes, which a
// reading of the file did not find naming it: one over a table that is gone,
// or one that names the column in a way its words do not show.
let blocker = (e: unknown): Stmt | undefined => {
  let said = e instanceof Error ? e.message : String(e)
  let [, kind, name] = said.match(/error in (view|trigger) ([^\s:]+)/i) ?? []
  return kind ? dropOf(kind.toLowerCase() as Kind, name) : undefined
}

// Run `stmts` in one unit; where SQLite names a view or a trigger that stops
// them, run them again with it dropped first, once for each such.
let run = (driver: Driver, stmts: Stmt[]): void => {
  for (let first: Stmt[] = [];;) {
    try {
      return unit(driver, () => {
        for (let s of [...first, ...stmts]) driver.query(s)
      })
    } catch (e) {
      let more = blocker(e)
      let again = more && first.some((s) => render(s).sql == render(more).sql)
      if (!more || again) throw e
      first = [...first, more]
    }
  }
}

// Where something may have changed what a store's install made (a drop that
// took an index, a trigger or a view, or a writer that keeps no print), the
// schema its receipt says goes, so the next install looks at the file rather
// than taking it as it left it. The planner statistics it keeps beside stay.
let unreceipted = (driver: Driver) => {
  let held = installation(driver)
  if (!held?.schema) return
  if (held.statistics) analyzedAt(driver, '', held.statistics)
  else meta(driver).del(SCHEMA)
}

/** Drop each of `seats` the file holds, a component's table or a column,
 * whatever it holds, in one unit: for a host contracting what its words
 * decided to let go of. Each view and trigger naming a table goes with it,
 * and each index, trigger and view naming a column, which SQLite refuses the
 * drop for while they stand; the next pass (`install`) makes again what the
 * schema still wants of those. */
export let unseat = (driver: Driver, seats: readonly Seat[]): void => {
  let held = seats.filter(([t, c]) => {
    let cols = columns(driver, t)
    return c ? cols.includes(c) : cols.length > 0
  })
  if (!held.length) return
  unit(driver, () => {
    for (let seat of held) run(driver, unseating(driver, seat))
    unreceipted(driver)
  })
}

/** The drops of what a file holds that `named` stopped naming ({@link
 * unseat}): a component table (./physical.ts `componentTables`) no statement
 * makes and no word names, once it holds no rows, and a column the statement
 * making its table lacks, once no row holds a value in it. A table that holds
 * a row, a column that holds a value, and a column its table's own definition
 * holds in place (./physical.ts `pinned`) stay as they stand. */
export let shed = (driver: Driver, { vocab, beside = [] }: Named): Seat[] => {
  let made = new Map<string, Set<string>>()
  for (let s of [...plan(vocab, {}, !!driver.file).raised, ...beside]) {
    if (s.t != 'create table') continue
    let cols = made.get(s.name) ?? new Set()
    for (let c of s.cols) cols.add(c.name.toLowerCase())
    made.set(s.name, cols)
  }
  let gone = componentTables(driver, [...made.keys(), ...vocab.all])
    .filter((name) => !rowed(driver, name, 1))
  let defined = new Map(catalogue(driver).map((o) => [o.name, o.sql ?? '']))
  let unnamed = componentTables(driver, [], [...made.keys()]).flatMap(
    (name) => {
      let held = pinned(defined.get(name) ?? '')
      return columns(driver, name)
        .filter((c) => {
          let low = c.toLowerCase()
          return !made.get(name)!.has(low) && !held.has(low) &&
            !valued(driver, name, c)
        })
        .map((c): Seat => [name, c])
    },
  )
  return [...gone.map((name): Seat => [name]), ...unnamed]
}

// Drop one seat whole, or, where SQLite refuses it (a key, a unique column, a
// check on another column naming it), leave it standing. Whether it went.
let shedding = (driver: Driver, seat: Seat): boolean => {
  try {
    run(driver, unseating(driver, seat))
    return true
  } catch (e) {
    if (/cannot drop|error in table/i.test(String(e))) return false
    throw e
  }
}

/** Bring a file to the composed schema `print` names: nothing, where the file
 * has recorded it; otherwise `pass`, which adds what is missing, and then the
 * record. A pass that left something it could not do (a table it could not
 * fit) answers false, and the print stays unrecorded so the next opener tries
 * again. True when the pass ran.
 *
 * Given what the schema names, the pass first sheds what the file holds
 * beyond it ({@link shed}), which the pass makes again where the schema still
 * wants it (a view or a trigger that named a column shed with it). What SQLite
 * refuses to drop stands, and the pass runs over it. A file
 * that shed something no longer stands at any other print it recorded, so
 * those are forgotten: an opener of the vocabulary that named it runs its pass
 * again. A host whose vocabulary may shrink for a while and grow back (an
 * application's older release, a rollback away) gives nothing, and the file
 * keeps all it holds. */
export let follow = (
  driver: Driver,
  print: string,
  pass: () => boolean | void,
  named?: Named,
): boolean => {
  if (printed(driver, print)) return false
  if (named) {
    unit(driver, () => {
      let drops = shed(driver, named).filter((seat) => shedding(driver, seat))
      if (!drops.length) return
      recorded(driver)
      unreceipted(driver)
      for (let p of prints(driver)) {
        if (p != print) meta(driver).del(PRINTED + p)
      }
    })
  }
  if (pass() === false) return true
  unit(
    driver,
    () => meta(driver).set(PRINTED + print, new Date().toISOString()),
  )
  return true
}

/** Forget that a file stands at `print`, so its next opener runs the pass
 * again: for a host whose file something that keeps no print may have changed,
 * the way a yaks.app store's older release, still a rollback away, installs
 * over whatever a print stands for. The store's own install receipt is
 * forgotten with it, so that install looks at the file again too. */
export let forget = (driver: Driver, print: string): void => {
  if (!printed(driver, print) && !installed(driver)) return
  unit(driver, () => {
    meta(driver).del(PRINTED + print)
    unreceipted(driver)
  })
}

/**
 * What a reader binds over a file no writer has brought to its vocabulary yet:
 * each stored property whose column the file's table lacks, read as null, the
 * way an entity reads a property it was never given, and each component whose
 * table the file lacks, read as a table no entity wears (@yaks/sql
 * `absent`). A reader never changes the schema, so it reads what the file
 * holds. Nothing, where the store's tables are as this vocabulary makes them,
 * which costs the store's print and one read of `server_meta`.
 */
export let lacking = (
  driver: Driver,
  vocab: Vocab,
  derived: Derived = {},
  physical = false,
): { derived: Derived; absent: string[] } => {
  let mark = installed(driver)?.split(' ')[0]
  // Installed as this vocabulary says, the file lacks no column, and no table
  // but those of the words nothing has written yet (./raise.ts).
  if (!physical && mark == plan(vocab, derived, !!driver.file).print) {
    return { derived: {}, absent: unraised(driver, vocab) }
  }
  // Only a table declared otherwise than the vocabulary does can lack a
  // column, so only those are asked about, two statements each, rather than
  // every table on every open.
  let kept = exact(driver, vocab)
  let was = behind(driver, vocab, kept)
  let held = tables(vocab)
  return {
    absent: held.filter((comp) => !kept.has(comp) && !(comp in was)),
    derived: Object.fromEntries(
      held.filter((comp) => comp in was).flatMap((comp) => {
        let has = new Set(was[comp].cols.map((r) => String(r.name)))
        return vocab.props(comp).map((p) => vocab.prop(comp, p)!)
          .filter((c) =>
            !c.computed && !has.has(field(c.prop)) &&
            !derived[`${comp}.${c.prop}`]
          )
          .map((c) => [`${comp}.${c.prop}`, {
            tag: tagOf(c),
            expr: () => lit(null),
          }])
      }),
    ),
  }
}

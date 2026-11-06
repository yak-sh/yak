// A component's table is made the first time a write names the component, not
// when its store installs (D-143541). An empty store holds the spine, the
// tables a host keeps of its own (blobs, vectors, the journal) and nothing for
// a word nobody has written; a store holds a table, its indexes and the
// triggers kept over it only for the words it uses.
//
// What belongs to a component is read off the statements themselves, the
// store's and every one a host keeps beside them, rather than declared twice:
// a statement **rests on** the component tables it is on, reads or writes,
// and on whatever the objects it names rest on (a search index on the text
// view it reads, a trigger on the index it writes). One that rests on no
// component table is made when the store installs. One that rests on some is
// made once every table it rests on stands: by the install, over a file that
// holds them, and otherwise in the transaction of the write that raises the
// last of them, before that write's rows, so its triggers see them.
//
// A read of a component with no table answers as one worn by no entity
// (@yaks/sql `absentDialect`, `absentDerived`).

import {
  type Derived,
  type Driver,
  erect,
  revision,
  type Stmt,
} from '@yaks/sql/core'
import { indexed, tabled } from './ddl.ts'
import type { Vocab } from '@yaks/vocab'
import { tables } from './layout.ts'
import { componentTables } from './physical.ts'
import { meta, TABLES, tablesAt } from './meta.ts'

/** The revision of when a component's objects are made: part of every
 * store's print (./plan.ts), so code that made them all at install finds a
 * store this code made as one it never installed, and makes them. */
export let RAISED = 1

// The component tables every install makes: the graves, and the archetype
// descriptors and their retirements, which a catalog reads by name before
// anything is written (./catalog.ts).
let EAGER = new Set(['tombstone', 'archetype', 'retired'])

/** Whether `comp`'s table waits for the first write that names it. */
export let lazy = (vocab: Vocab, comp: string): boolean =>
  !EAGER.has(comp) && !!vocab.comp(comp) && !vocab.comp(comp)!.computed &&
  comp != 'entity'

// Every name a statement is on, reads or writes: a source table, a trigger's
// or an index's table, a write's target, a virtual table's content.
let names = (node: unknown, into: Set<string>): Set<string> => {
  if (Array.isArray(node)) {
    for (let n of node) names(n, into)
    return into
  }
  if (!node || typeof node != 'object') return into
  let o = node as Record<string, unknown>
  if (o.t == 'raw' || o.t == 'val' || o.t == 'lit') return into
  if (o.t == 'table' && !o.args) into.add(String(o.name))
  if (o.t == 'create trigger' || o.t == 'create index') into.add(String(o.on))
  if (o.t == 'insert') into.add(String(o.into))
  if (o.t == 'update') into.add(String(o.table))
  if (o.t == 'delete' && typeof o.from == 'string') into.add(o.from)
  if (o.t == 'drop') into.add(String(o.name))
  if (o.t == 'create virtual table') {
    for (let a of o.args as unknown[]) {
      if (Array.isArray(a) && a[0] == 'content') into.add(String(a[1]))
    }
  }
  for (let v of Object.values(o)) names(v, into)
  return into
}

// A store's own schema and what its host keeps beside it, as one list per
// vocabulary, read overrides, file and host list: a Vocab is a value nobody
// mutates once loaded, so a process works out what rests on what once.
let NONE: Derived = {}
let schemas = new WeakMap<Vocab, WeakMap<Derived, Stmt[][]>>()
let joined = new WeakMap<readonly Stmt[], WeakMap<readonly Stmt[], Stmt[]>>()

/** Everything a component's first write may make in a store of `vocab`: its
 * own schema (./ddl.ts `tabled`, `indexed`) and `over`, what its host keeps
 * beside it. The same list comes back for the same arguments. */
export let units = (
  vocab: Vocab,
  derived: Derived = NONE,
  file = false,
  over: readonly Stmt[] = [],
): Stmt[] => {
  let by = schemas.get(vocab) ?? new WeakMap<Derived, Stmt[][]>()
  schemas.set(vocab, by)
  let held = by.get(derived) ?? []
  by.set(derived, held)
  let own = held[Number(file)] ??= [
    ...tabled(vocab, derived, file),
    ...indexed(vocab),
  ]
  if (!over.length) return own
  let beside = joined.get(own) ?? new WeakMap<readonly Stmt[], Stmt[]>()
  joined.set(own, beside)
  let all = beside.get(over)
  if (!all) beside.set(over, all = [...own, ...over])
  return all
}

let rested = new WeakMap<Vocab, WeakMap<readonly Stmt[], string[][]>>()

/** The component tables each of `stmts` rests on, in order: the ones it
 * names, and the ones every object it names that another of `stmts` makes
 * rests on. */
export let rests = (vocab: Vocab, stmts: readonly Stmt[]): string[][] => {
  let by = rested.get(vocab) ?? new WeakMap<readonly Stmt[], string[][]>()
  rested.set(vocab, by)
  let known = by.get(stmts)
  if (known) return known
  let makers = new Map<string, number>()
  stmts.forEach((s, i) => {
    if (s.t.startsWith('create ') && 'name' in s) makers.set(s.name, i)
  })
  let memo = new Map<number, Set<string>>()
  let of = (i: number): Set<string> => {
    let held = memo.get(i)
    if (held) return held
    let found = new Set<string>()
    memo.set(i, found)
    let s = stmts[i]
    let made = s.t.startsWith('create ') && 'name' in s ? s.name : null
    // A component's own table rests on itself.
    if (made != null && lazy(vocab, made)) found.add(made)
    for (let n of names(s, new Set())) {
      if (lazy(vocab, n)) found.add(n)
      let maker = makers.get(n)
      if (n != made && maker != null) { for (let c of of(maker)) found.add(c) }
    }
    return found
  }
  let all = stmts.map((_, i) => [...of(i)])
  by.set(stmts, all)
  return all
}

// What the file's receipt says, per schema revision: a write that raises a
// table moves the schema and the receipt in one transaction.
let receipts = new WeakMap<Driver, { at: number; held?: Set<string> }>()

/** The component tables the file holds, as its receipt says (./meta.ts
 * `TABLES`), one row; undefined where no install of this code recorded one,
 * a file whose install made every table. */
let held = (driver: Driver): Set<string> | undefined => {
  let at = revision(driver, 'schema')
  let k = receipts.get(driver)
  if (k?.at !== at) {
    let said = tablesAt(driver)
    receipts.set(driver, k = { at, held: said && new Set(said) })
  }
  return k.held
}

/** Record the component tables the file holds now, in its receipt: what an
 * install does once its tables stand. */
export let recorded = (driver: Driver): void => {
  let found = componentTables(driver)
  meta(driver).set(TABLES, found.join(' '))
  receipts.set(driver, {
    at: revision(driver, 'schema'),
    held: new Set(found),
  })
}

/** The tables of `vocab` raised on a first write that this file holds. */
export let raisedIn = (driver: Driver, vocab: Vocab): Set<string> => {
  let all = held(driver)
  return new Set(
    tables(vocab).filter((c) => lazy(vocab, c) && (!all || all.has(c))),
  )
}

/** The components of `vocab` whose table waits for a first write. */
export let unraised = (driver: Driver, vocab: Vocab): string[] => {
  let stands = raisedIn(driver, vocab)
  return tables(vocab).filter((c) => lazy(vocab, c) && !stands.has(c))
}

/** The tables of `vocab` this file holds. */
export let stood = (driver: Driver, vocab: Vocab): string[] => {
  let stands = raisedIn(driver, vocab)
  return tables(vocab).filter((c) => !lazy(vocab, c) || stands.has(c))
}

/** Those of `stmts` that rest on no table this file lacks, as its schema
 * says: what an install makes, before any receipt is recorded. */
export let holds = (
  driver: Driver,
  vocab: Vocab,
  stmts: readonly Stmt[],
): Stmt[] => {
  let on = rests(vocab, stmts)
  if (on.every((r) => !r.length)) return [...stmts]
  let stands = new Set(componentTables(driver))
  return stmts.filter((_, i) => on[i].every((c) => stands.has(c)))
}

// The schema revisions a run of raises on one connection moved through, the
// first of them where the run began: what moved the schema and nothing else.
let runs = new WeakMap<Driver, number[]>()

/** Whether raises alone moved this connection's schema from revision `from`
 * to `to`, so a look at the file taken at `from` stands for all but the
 * tables they made. */
export let raisedOnly = (driver: Driver, from: number, to: number): boolean => {
  let run = runs.get(driver)
  return !!run && run.includes(from) && run.at(-1) == to
}

/**
 * Make the tables of `comps` this file lacks, and every one of `stmts` that
 * rests on one of them and on no table still missing, in their order. Answers
 * the components it made a table for. Run it in the transaction of the write
 * that names them, before that write.
 */
export let raise = (
  driver: Driver,
  vocab: Vocab,
  comps: Iterable<string>,
  stmts: readonly Stmt[],
): string[] => {
  let stands = raisedIn(driver, vocab)
  let fresh = [...new Set(comps)].filter((c) =>
    lazy(vocab, c) && !stands.has(c)
  )
  if (!fresh.length) return []
  for (let c of fresh) stands.add(c)
  let made = new Set(fresh)
  let from = revision(driver, 'schema')
  let on = rests(vocab, stmts)
  erect(
    driver,
    stmts.filter((_, i) =>
      on[i].some((c) => made.has(c)) && on[i].every((c) => stands.has(c))
    ),
  )
  let now = new Set([...held(driver) ?? componentTables(driver), ...fresh])
  meta(driver).set(TABLES, [...now].sort().join(' '))
  let to = revision(driver, 'schema')
  receipts.set(driver, { at: to, held: now })
  let run = runs.get(driver)
  runs.set(driver, run?.at(-1) == from ? [...run, to] : [from, to])
  return fresh
}

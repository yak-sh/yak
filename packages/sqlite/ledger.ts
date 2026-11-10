import type { Driver, Stmt } from '@yaks/sql'
import { TOMBSTONE } from '@yaks/graph/bundle'

/** A connection's ledger of archetype moves ({@link ledger}). */
export type Ledger = {
  moved: (eid: string, table: string, held: boolean) => void
  born: (eid: string) => void
  removed: (eid: string) => void
  pointed: (eid: string) => void
  owed: () => string[]
  buried: () => string[]
  wrote: (eid: string) => boolean
  held: (eid: string, pointed: readonly string[] | null) => string[] | undefined
}

// What the open transaction wrote to one entity since its pointer was: the
// tables it holds whatever its pointer says (`base`: none for a birth, its
// tombstone for a removal), each table a row came to or went from since, as
// whether it held one before and holds one now, and whether it is dead.
type Entry = {
  base?: readonly string[]
  rows: Map<string, [boolean, boolean]>
  born: boolean
  dead: boolean
}

// One connection's entries, and how to take back each change made to them
// since a savepoint, newest last.
type Book = {
  entries: Map<string, Entry>
  undo: [string, Entry | undefined][]
  scopes: { name?: string; at: number }[]
}
let books = new WeakMap<object, Book>()
let followed = new WeakSet<Driver>()

// A connection's book follows its transactions as the statements say them, the
// way its memory does (./memo.ts): a savepoint rolled back takes back what the
// ledger heard inside it, with the rows and pointers it took back, and the end
// of the transaction empties it.
let follow = (driver: Driver, book: Book) => {
  if (followed.has(driver)) return
  followed.add(driver)
  let back = (to: number) => {
    while (book.undo.length > to) {
      let [eid, was] = book.undo.pop()!
      if (was) book.entries.set(eid, was)
      else book.entries.delete(eid)
    }
  }
  let ended = () => {
    book.entries.clear()
    book.undo = []
    book.scopes = []
  }
  let observe = (s: Stmt): void => {
    if (s.t == 'raw') return s.origin && observe(s.origin)
    if (s.t == 'begin') book.scopes.push({ at: book.undo.length })
    else if (s.t == 'savepoint') {
      book.scopes.push({ name: s.name, at: book.undo.length })
    } else if (s.t == 'commit') ended()
    else if (s.t == 'rollback') {
      let at = s.to ? book.scopes.findLastIndex((v) => v.name == s.to) : -1
      if (at < 0) return ended()
      back(book.scopes[at].at)
      book.scopes.splice(at + 1)
    } else if (s.t == 'release') {
      let at = book.scopes.findLastIndex((v) => v.name == s.name)
      if (at >= 0) book.scopes.splice(at)
      if (at == 0) ended()
    }
  }
  let query = driver.query.bind(driver)
  driver.query = (s) => {
    let rows = query(s)
    observe(s)
    return rows
  }
  if (driver.run) {
    let run = driver.run.bind(driver)
    driver.run = (s) => {
      let n = run(s)
      observe(s)
      return n
    }
  }
  // A driver's own transaction is synchronous, and one nested in another
  // rolls back to where it began.
  if (driver.tx) {
    let tx = driver.tx.bind(driver)
    driver.tx = (body) => {
      let at = book.scopes.length
      book.scopes.push({ at: book.undo.length })
      let committed = false
      try {
        let out = tx(body)
        committed = true
        return out
      } finally {
        if (!committed) back(book.scopes[at]?.at ?? 0)
        book.scopes.splice(at)
        if (!at) ended()
      }
    }
  }
}

/**
 * A connection's account of what its open transaction did to each entity's
 * archetype since that entity's pointer was written, shared by every store
 * over the connection (./mod.ts `storage`). `moved` hears a row come or go
 * (./write.ts `patch`), `born` a spine minted, `removed` an entity removed,
 * `pointed` a pointer written.
 *
 * `held` is the tables an entity holds now, given the ones its stored pointer
 * names: the pointer's, or none for a birth (minted in the class its shape
 * last finished in, which it may not hold yet), or its tombstone for a
 * removal, with each row that came or went since. So a read or a removal
 * inside the transaction knows what an entity holds without reading a table.
 * It is undefined for an entity with no pointer that the transaction neither
 * minted nor removed: nothing says what that one holds.
 *
 * `owed` is every entity whose rows stand other than its pointer says, or
 * that was born, with no pointer written since: the ones a unit classifies as
 * it closes. `buried` is every entity removed with no pointer written since:
 * each holds its tombstone and nothing else, and a read passes it by as dead
 * whatever its pointer says. A batch that adds a component and drops it again
 * owes nothing, and neither does anything @yaks/graph wrote, since its
 * tracker points every entity it moved after the rows are written. `wrote`
 * is whether the transaction heard anything of an entity since its pointer.
 *
 * The ledger follows the connection's savepoints: what a unit wrote and then
 * rolled back is taken back here too, so a unit opened inside another, kept
 * or not, leaves the account exact.
 */
export let ledger = (driver: Driver): Ledger => {
  let at = driver.connection ?? driver
  let book = books.get(at)
  if (!book) books.set(at, book = { entries: new Map(), undo: [], scopes: [] })
  follow(driver, book)
  let { entries } = book
  // An entry about to change, with how to take the change back.
  let change = (eid: string, fresh?: Entry): Entry => {
    let was = entries.get(eid)
    book.undo.push([eid, was && { ...was, rows: new Map(was.rows) }])
    let e = fresh ?? was ?? { rows: new Map(), born: false, dead: false }
    entries.set(eid, e)
    return e
  }
  let moving = (e: Entry) =>
    e.born || [...e.rows.values()].some(([was, now]) => was != now)
  return {
    moved: (eid, table, held) => {
      // A row moving again (a revival, a patch after it) leaves the dead
      // holding more than their tombstone.
      let e = change(eid)
      e.dead = false
      e.rows.set(table, [e.rows.get(table)?.[0] ?? !held, held])
    },
    born: (eid) =>
      void change(eid, { base: [], rows: new Map(), born: true, dead: false }),
    removed: (eid) =>
      void change(eid, {
        base: [TOMBSTONE],
        rows: new Map(),
        born: false,
        dead: true,
      }),
    // A pointer says everything written before it.
    pointed: (eid) => {
      if (!entries.has(eid)) return
      book.undo.push([eid, entries.get(eid)])
      entries.delete(eid)
    },
    owed: () =>
      [...entries].flatMap(([eid, e]) => !e.dead && moving(e) ? [eid] : []),
    buried: () => [...entries].flatMap(([eid, e]) => e.dead ? [eid] : []),
    wrote: (eid) => entries.has(eid),
    held: (eid, pointed) => {
      let e = entries.get(eid)
      let base = e?.base ?? pointed
      if (!base) return undefined
      if (!e) return [...base]
      let held = new Set(base)
      for (let [table, [, now]] of e.rows) {
        if (now) held.add(table)
        else held.delete(table)
      }
      return [...held]
    },
  }
}

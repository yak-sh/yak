// The stand-in (not part of the published package — see deno.json): D1's API
// over jsr:@db/sqlite, so the adapter can be tested without Cloudflare. The
// surface is small enough to imitate exactly, and imitating it EXACTLY is the
// point — every rule below is one the runtime enforces, so a bug this stand-in
// cannot see is a bug the runtime would not have shown either:
//
//   IT IS ASYNC-ONLY          `all()` and `batch()` return promises. An adapter
//                             that accidentally relied on a synchronous answer
//                             fails here, as it would in a Worker.
//   A BATCH IS THE ONLY
//   TRANSACTION               `begin`/`commit`/`savepoint` are refused as
//                             statements; `batch()` runs its list in one
//                             transaction and rolls the whole list back if any
//                             statement fails.
//   ONE STATEMENT PER PREPARE a `;`-separated pair is refused, the way D1's
//                             parser refuses one.
//   VALUES ARE D1'S TABLE     null, number, string, boolean and ArrayBuffer
//                             bind; `undefined` and a bigint are errors.
//   A BLOB COMES BACK AS AN
//   ARRAY OF BYTE VALUES      which is what D1 hands back, and what the
//                             adapter's `unbind` converts.
//
// `counting()` is the same stand-in with a tally attached: over D1 the cost of
// a write is the number of ROUND TRIPS it takes, and a number nothing counts is
// a number that quietly grows. hops_test.ts holds each shape of batch to a
// pinned count.

import { Database } from '@db/sqlite'
import type { Vocab } from '@yaks/vocab'
import { shop } from '../sqlite/harness.ts'
import type { D1Like, D1Result, D1Value, Row } from './d1.ts'
import { storage, type Store } from './store.ts'

export { shop }

// The statements D1 refuses: it owns transactions, and attaching or vacuuming
// another database is not on offer.
let REFUSED =
  /^\s*(begin|commit|end|rollback|savepoint|release|attach|detach|vacuum)\b/i

let ok = (value: unknown): value is D1Value =>
  value === null || typeof value == 'string' || typeof value == 'number' ||
  typeof value == 'boolean' || value instanceof ArrayBuffer

// Bytes out as an array of byte values, the way D1 hands back a blob.
let out = (row: Record<string, unknown>) => {
  for (let key in row) {
    let value = row[key]
    if (value instanceof Uint8Array) row[key] = [...value]
  }
  return row
}

// D1's parser takes exactly one statement. A trigger body's internal `;` is
// inside `begin … end`, so only a trailing `;` splitting two statements counts.
let multiple = (sql: string): boolean =>
  /;\s*\S/.test(sql.replace(/begin\b[\s\S]*?\bend\s*;?/gi, ''))

/** The stand-in's prepared statement. It carries the SQL and bindings it was
 * given, which is how `batch` reads back what it was handed. `all`, `first` and
 * `run` are the three doors D1 offers onto ONE round trip; the adapter uses
 * `all`, and the other two are here so that a count of round trips
 * ({@link counting}) cannot be dodged by switching doors. */
export type Prepared = {
  sql: string
  params: D1Value[]
  bind: (...values: D1Value[]) => Prepared
  all: <T = Row>() => Promise<D1Result<T>>
  first: <T = Row>() => Promise<T | null>
  run: <T = Row>() => Promise<D1Result<T>>
}

/** A stand-in for a `D1Database` binding over a fresh in-memory database. */
export let d1 = (): D1Like<Prepared> => {
  let db = new Database(':memory:')
  db.exec('pragma foreign_keys = on')

  let run = (sql: string, params: D1Value[]): Row[] => {
    // The runtime takes an ArrayBuffer; the library underneath takes bytes.
    let binds = params.map((p) =>
      p instanceof ArrayBuffer
        ? new Uint8Array(p)
        : typeof p == 'boolean'
        ? Number(p)
        : p
    )
    let stmt = db.prepare(sql)
    return (stmt.all(...binds) as Record<string, unknown>[]).map(out)
  }

  let check = (sql: string, params: D1Value[]) => {
    for (let p of params) {
      if (!ok(p)) throw new TypeError(`cannot bind ${typeof p}: ${String(p)}`)
    }
    if (REFUSED.test(sql)) {
      throw new Error(`not authorized: use batch(), not \`${sql.trim()}\``)
    }
    if (multiple(sql)) throw new Error('one statement per prepare')
  }

  let stmt = (sql: string, params: D1Value[]): Prepared => {
    let go = <T = Row>(): Promise<D1Result<T>> => {
      check(sql, params)
      return Promise.resolve({ results: run(sql, params) as T[] })
    }
    return {
      sql,
      params,
      bind: (...values: D1Value[]) => stmt(sql, values),
      all: go,
      run: go,
      first: <T = Row>() => go<T>().then((r) => r.results[0] ?? null),
    }
  }

  return {
    prepare: (sql) => stmt(sql, []),
    // One transaction over the whole list: every statement runs in order, and
    // any failure rolls all of them back.
    batch: (statements) => {
      for (let s of statements) check(s.sql, s.params)
      db.exec('savepoint d1_batch')
      try {
        let results = statements.map((s) => ({ results: run(s.sql, s.params) }))
        db.exec('release d1_batch')
        return Promise.resolve(results)
      } catch (e) {
        db.exec('rollback to d1_batch')
        db.exec('release d1_batch')
        return Promise.reject(e)
      }
    },
  }
}

/** A ready store over that stand-in, schema installed. */
export let store = async (vocab: Vocab = shop): Promise<Store> => {
  let s = storage(d1(), vocab)
  await s.install()
  return s
}

/**
 * What a stretch of work asked of the binding. `trips` is the number that
 * matters: over D1 a `batch()` and a statement run on its own are each ONE
 * network round trip, however many statements ride in the batch, while
 * preparing a statement costs nothing until it is run.
 */
export type Hops = {
  /** statements prepared — free, but it says how wide the batches are */
  prepare: number
  /** `batch()` calls — one round trip each */
  batch: number
  /** `all()` on a statement of its own — one round trip */
  all: number
  /** `first()` on a statement of its own — one round trip */
  first: number
  /** `run()` on a statement of its own — one round trip */
  run: number
  /** the round trips: `batch + all + first + run` */
  trips: number
}

/** A counting stand-in and its tally: the same in-memory database, plus a
 * record of what the adapter asked of it. {@link Store} calls that never touch
 * the binding cost nothing here either. */
export type Counted = {
  /** the binding to hand {@link storage} */
  db: D1Like<Prepared>
  /** the tally since the last {@link Counted.reset} */
  hops: () => Hops
  /** zero it — call it right before the work being measured */
  reset: () => void
}

/**
 * A {@link d1} stand-in that counts. Every door onto a round trip is counted,
 * including the ones this adapter does not use, so the tally is the whole
 * traffic and not just the traffic it expects.
 */
export let counting = (): Counted => {
  let inner = d1()
  let n = { prepare: 0, batch: 0, all: 0, first: 0, run: 0 }

  // A counted statement, still counted after a `bind`. `batch` reads only
  // `sql` and `params`, so a wrapper rides into it unchanged.
  let watch = (p: Prepared): Prepared => ({
    sql: p.sql,
    params: p.params,
    bind: (...values: D1Value[]) => watch(p.bind(...values)),
    all: <T = Row>() => {
      n.all++
      return p.all<T>()
    },
    first: <T = Row>() => {
      n.first++
      return p.first<T>()
    },
    run: <T = Row>() => {
      n.run++
      return p.run<T>()
    },
  })

  return {
    db: {
      prepare: (sql) => {
        n.prepare++
        return watch(inner.prepare(sql))
      },
      batch: (statements) => {
        n.batch++
        return inner.batch(statements)
      },
    },
    hops: () => ({ ...n, trips: n.batch + n.all + n.first + n.run }),
    reset: () => {
      n.prepare =
        n.batch =
        n.all =
        n.first =
        n.run =
          0
    },
  }
}

/** A ready store over a counting stand-in, schema installed and the tally
 * zeroed — so the first thing counted is the caller's own work. */
export let counted = async (
  vocab: Vocab = shop,
): Promise<Counted & { store: Store }> => {
  let c = counting()
  let store = storage(c.db, vocab)
  await store.install()
  c.reset()
  return { ...c, store }
}

import { test } from '@yaks/testing'
import { Buffer } from 'node:buffer'
import { assertEquals, assertThrows } from '@std/assert'
import { as, fn, insert, lit, type Param, scan, select, val } from '@yaks/sql'
import { open as writer } from './db.ts'
import { open } from './read-db.ts'
import { budget, ROW, VALUE } from './budget.ts'

let scratch = () => {
  let dir = Deno.makeTempDirSync(), path = `${dir}/read.db`
  let db = writer(path)
  // Readers exercise commits and WAL snapshots, without power-loss recovery.
  db.query({ t: 'pragma', name: 'synchronous', value: 'off' })
  return {
    db,
    path,
    [Symbol.dispose]: () => {
      db.close()
      Deno.removeSync(dir, { recursive: true })
    },
  }
}

// One physical schema for the reader contracts. Each schema-change case owns
// its table; the final reader case closes the shared writer and removes it.
let f = scratch()
f.db.query({ t: 'begin' })
let seed = (table: string) => {
  f.db.query({ t: 'create table', name: table, cols: [{ name: 'x' }] })
  f.db.query(insert(table, { x: 1 }))
}
seed('t')

for (
  let [name, read] of [
    ['read-db', open],
    ['db.readOnly', (path: string) => writer(path, { readOnly: true })],
  ] as const
) {
  let value = (value: Param) => select({ cols: [as(val(value), 'value')] })
  let values: Param[] = [
    null,
    true,
    false,
    0,
    -1,
    2 ** 40,
    Number.MAX_SAFE_INTEGER,
    9007199254740993n,
    -9223372036854775808n,
    1.25,
    '',
    'λ\0雪',
    new Uint8Array(),
    new Uint8Array([0, 1, 255]),
  ]
  let queries = values.map(value)
  let expected = values.map((
    v,
  ) => [{ value: typeof v == 'boolean' ? Number(v) : v }])
  let bound = read(':memory:')
  test(`${name} preserves bound values, statement errors and closed reads`, () => {
    let db = bound
    try {
      assertEquals(
        queries.map((q) => db.query(q)),
        expected,
      )
      assertThrows(
        () =>
          db.query({
            t: 'create table',
            name: 'forbidden',
            cols: [{ name: 'x' }],
          }),
        Error,
        'read-only',
      )
      assertThrows(
        () => db.query(select({ cols: [fn('absent_function')] })),
        Error,
        'no such function',
      )
      assertEquals(db.query(value(7)), [{ value: 7 }])
      db.close()
      for (let v of [7, 8]) {
        assertThrows(() => db.query(value(v)), Error, 'closed')
      }
    } finally {
      db.close()
    }
  })

  let table = `t_${name}`
  seed(table)
  let snapshot = read(f.path)
  test(`${name} sees committed schema changes and holds a read snapshot`, () => {
    let db = snapshot
    try {
      assertEquals(scan(db, table), [{ x: 1 }])
      f.db.query({
        t: 'alter table',
        table,
        add: { name: 'y', default: lit(5) },
      })
      assertEquals(scan(db, table), [{ x: 1, y: 5 }])
      db.query({ t: 'begin' })
      assertEquals(scan(db, table), [{ x: 1, y: 5 }])
      f.db.query(insert(table, { x: 2 }))
      assertEquals(scan(db, table), [{ x: 1, y: 5 }])
      db.query({ t: 'commit' })
      assertEquals(scan(db, table), [{ x: 1, y: 5 }, { x: 2, y: 5 }])
    } finally {
      db.close()
    }
  })
}
f.db.query({ t: 'commit' })
let last = open(f.path)

test('the last read-only connection leaves its database and WAL untouched', () => {
  using _cleanup = f
  let db = last
  assertEquals(scan(db, 't'), [{ x: 1 }])
  f.db.close()
  let contents = () =>
    [f.path, `${f.path}-wal`].map((p) =>
      Buffer.from(Deno.readFileSync(p).buffer)
    )
  let before = contents()
  db.close()
  contents().forEach((bytes, i) => assertEquals(bytes.equals(before[i]), true))
})

test('a metered read past its budget is refused, and the next read answers', () => {
  using s = scratch()
  s.db.query({ t: 'create table', name: 'big', cols: [{ name: 'x' }] })
  for (let x of [1, 2, 3, 4, 5]) s.db.query(insert('big', { x: 'x'.repeat(x) }))
  let spent = budget({ rows: 3, bytes: 1_000_000 })
  let db = open(s.path, { meter: spent.meter })
  try {
    assertThrows(() => scan(db, 'big'), Error, 'more than one read may hold')
    spent.reset()
    assertEquals(
      db.query(select({ cols: [as(val(5), 'n')] })),
      [{ n: 5 }],
    )
    spent.reset()
    let wide = budget({ rows: 99, bytes: 3 * (ROW + VALUE) + 6 })
    let other = open(s.path, { meter: wide.meter })
    try {
      assertThrows(() => scan(other, 'big'), Error, 'MiB')
    } finally {
      other.close()
    }
  } finally {
    db.close()
  }
})

test('a read-only opener never creates a missing file', () => {
  let dir = Deno.makeTempDirSync(), path = `${dir}/missing.db`
  try {
    assertThrows(() => open(path), Error, 'unable to open')
    assertThrows(() => Deno.statSync(path), Deno.errors.NotFound)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

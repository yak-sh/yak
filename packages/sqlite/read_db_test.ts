import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { as, fn, insert, lit, type Param, scan, select, val } from '@yaks/sql'
import { open as writer } from './db.ts'
import { open } from './read-db.ts'

let scratch = () => {
  let dir = Deno.makeTempDirSync(), path = `${dir}/read.db`
  let db = writer(path)
  return {
    db,
    path,
    [Symbol.dispose]: () => {
      db.close()
      Deno.removeSync(dir, { recursive: true })
    },
  }
}

for (
  let [name, read] of [
    ['read-db', open],
    ['db.readOnly', (path: string) => writer(path, { readOnly: true })],
  ] as const
) {
  test(`${name} preserves bound values, statement errors and closed reads`, () => {
    using f = scratch()
    let db = read(f.path)
    try {
      let value = (value: Param) => select({ cols: [as(val(value), 'value')] })
      for (
        let v of [
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
      ) {
        assertEquals(db.query(value(v)), [{
          value: typeof v == 'boolean' ? Number(v) : v,
        }])
      }
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

  test(`${name} sees committed schema changes and holds a read snapshot`, () => {
    using f = scratch()
    f.db.query({ t: 'create table', name: 't', cols: [{ name: 'x' }] })
    f.db.query(insert('t', { x: 1 }))
    let db = read(f.path)
    try {
      assertEquals(scan(db, 't'), [{ x: 1 }])
      f.db.query({
        t: 'alter table',
        table: 't',
        add: { name: 'y', default: lit(5) },
      })
      assertEquals(scan(db, 't'), [{ x: 1, y: 5 }])
      db.query({ t: 'begin' })
      assertEquals(scan(db, 't'), [{ x: 1, y: 5 }])
      f.db.query(insert('t', { x: 2 }))
      assertEquals(scan(db, 't'), [{ x: 1, y: 5 }])
      db.query({ t: 'commit' })
      assertEquals(scan(db, 't'), [{ x: 1, y: 5 }, { x: 2, y: 5 }])
    } finally {
      db.close()
    }
  })
}

test('the last read-only connection leaves its database and WAL untouched', () => {
  using f = scratch()
  f.db.query({ t: 'create table', name: 't', cols: [{ name: 'x' }] })
  f.db.query(insert('t', { x: 1 }))
  let db = open(f.path)
  assertEquals(scan(db, 't'), [{ x: 1 }])
  f.db.close()
  let contents = () =>
    [f.path, `${f.path}-wal`].map((p) => Deno.readFileSync(p))
  let before = contents()
  db.close()
  assertEquals(contents(), before)
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

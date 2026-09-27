// sqlite-vector's exact native scan. It replaces a costly JS transfer and
// score of every blob without changing the ranking or storing an ANN index.
// The extension creates its metadata table on load, so automatic loading is
// limited to databases where it has already been explicitly installed.

import {
  as,
  call,
  col,
  type Driver,
  eq,
  fn,
  lit,
  select,
  table,
  val,
} from '@yaks/sql'
import { TABLE } from './ddl.ts'
import type { Near } from './near.ts'
import { pack } from './vector.ts'

let binary = (): string | null => {
  let names: Record<string, string> = {
    'linux-x86_64': '@sqlite-vector-linux-x86_64',
    'linux-aarch64': '@sqlite-vector-linux-aarch64',
    'darwin-x86_64': '@sqlite-vector-darwin-x86_64',
    'darwin-aarch64': '@sqlite-vector-darwin-aarch64',
    'windows-x86_64': '@sqlite-vector-windows-x86_64',
  }
  let name = names[`${Deno.build.os}-${Deno.build.arch}`]
  if (!name) return null
  let ext = Deno.build.os == 'windows'
    ? 'dll'
    : Deno.build.os == 'darwin'
    ? 'dylib'
    : 'so'
  return new URL(`./vector.${ext}`, import.meta.resolve(name)).pathname
}

/** Explicit one-time installation: back up the database before calling this
 * on a file. Loading the extension adds its metadata table to the database. */
export let install = (db: Driver): void => {
  if (!db.extension) throw new Error('SQL driver cannot load sqlite-vector')
  let path = binary()
  if (!path) throw new Error('sqlite-vector has no binary for this platform')
  db.extension(path)
}

let installed = (db: Driver): boolean =>
  !!db.query(select({
    cols: [col('name')],
    from: table('sqlite_master'),
    where: eq(col('name'), val('_sqliteai_vector')),
  }))[0]

// The native top-k sees the whole table. If models differ, filtering its
// answers afterwards is wrong; leave that space to the exact JS scan.
let only = (db: Driver, model: string): boolean => {
  let row = db.query(select({
    cols: [
      as(fn('min', col('model')), 'lo'),
      as(fn('max', col('model')), 'hi'),
    ],
    from: table(TABLE),
  }))[0]
  return row?.lo == model && row.hi == model
}

/** A connection's native ranker, or null when the extension is not installed.
 * Does not create schema or touch the live database during a search. */
export let native = (db: Driver) => {
  if (!db.extension || !installed(db) || !binary()) return null
  install(db)
  let dimension = 0
  let initialized = false
  return (
    query: Float32Array,
    model: string,
    limit: number,
    without?: string,
  ): Near[] | null => {
    if (!only(db, model)) return null
    if (!dimension) {
      let row = db.query(select({
        cols: [as(fn('length', col('vec')), 'bytes')],
        from: table(TABLE),
        limit: lit(1),
      }))[0]
      dimension = Number(row?.bytes ?? 0) / 4
    }
    if (dimension != query.length) return null
    if (!initialized) {
      db.query(
        select({
          cols: [
            fn(
              'vector_init',
              lit(TABLE),
              lit('vec'),
              lit(`dimension=${dimension},type=FLOAT32,distance=COSINE`),
            ),
          ],
        }),
      )
    }
    initialized = true
    let size = Math.max(1, limit + (without ? 1 : 0))
    for (;;) {
      let rows = db.query(select({
        cols: [
          as(col('id', 'v'), 'owner'),
          as(col('distance', 'v'), 'distance'),
          as(col('eid', 'o'), 'eid'),
        ],
        from: call('vector_full_scan', [
          lit(TABLE),
          lit('vec'),
          val(pack(query)),
          val(size),
        ], 'v'),
        joins: [{
          how: 'join',
          src: table('entity', 'o'),
          on: eq(col('id', 'o'), col('id', 'v')),
        }],
      }))
      // Deletes can precede the next sweep. Fetch more than top-k until there
      // are enough live neighbours, never silently return a stale entity.
      let dead = rows.length
        ? new Set(
          db.query(select({
            cols: [col('entity')],
            from: table('tombstone'),
            where: {
              t: 'in',
              e: col('entity'),
              set: rows.map((r) => val(Number(r.owner))),
            },
          })).map((r) => Number(r.entity)),
        )
        : new Set<number>()
      let hits = rows
        .filter((r) => !dead.has(Number(r.owner)) && r.eid != without)
        .map((r) => ({
          entity: String(r.eid),
          owner: Number(r.owner),
          similarity: 1 - Number(r.distance),
        }))
        .sort((a, b) => b.similarity - a.similarity)
      if (hits.length >= limit || rows.length < size) {
        return hits.slice(0, limit)
      }
      size *= 2
    }
  }
}

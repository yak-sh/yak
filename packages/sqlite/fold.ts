// Two entities that turned out to be one, made one: what a migration does
// when an identity (the vocabulary's `identity` keyword) is declared over rows
// written before it was, and two of them derive the same id.
//
// Integer ids are what rows point at, so folding is a matter of rows and
// pointers: the entity that goes gives its component rows to the one that
// stays (filling only what that one left empty), every column pointing at it
// points at the one that stays, and its spine row is deleted.

import type { Vocab } from '@yaks/vocab'
import type { Driver } from './driver.ts'
import { componentTables } from './physical.ts'

let q = (name: string) => '"' + name.replaceAll('"', '""') + '"'

// A Durable Object lists its runtime's own tables (`_cf_KV`) and then refuses
// to read them, so they are left out as componentTables leaves them out.
let tables = (sql: Driver): string[] =>
  sql.query("select name from sqlite_schema where type = 'table'", [])
    .map((r) => String(r.name))
    .filter((name) => !name.startsWith('sqlite_') && !/^_+cf_/i.test(name))

let columns = (sql: Driver, table: string): string[] =>
  sql.query(`pragma table_info(${q(table)})`, []).map((c) => String(c.name))

/** Every column that holds an entity's integer id: the vocabulary's reference
 * columns, and every foreign key onto `entity` (a journal's among them). */
export let pointers = (sql: Driver, vocab: Vocab): [string, string][] => {
  let all = tables(sql)
  let out = new Set<string>()
  for (let [comp, prop] of vocab.refProps()) {
    if (all.includes(comp) && columns(sql, comp).includes(prop)) {
      out.add(JSON.stringify([comp, prop]))
    }
  }
  for (let t of all) {
    for (let fk of sql.query(`pragma foreign_key_list(${q(t)})`, [])) {
      if (fk.table == 'entity') out.add(JSON.stringify([t, String(fk.from)]))
    }
  }
  return [...out].map((s) => JSON.parse(s))
}

/**
 * Fold entity `gone` into `keep`. Its rows, where `keep` has none, move
 * across; where `keep` has one, they fill what it left empty. Then every
 * pointer at `gone` (`refs`, read when the fold runs, so a caller may add to
 * the list) points at `keep`, and `gone` is no more.
 */
export let fold = (
  sql: Driver,
  refs: [string, string][],
): (gone: number, keep: number) => void => {
  let owned = componentTables(sql)
  return (gone: number, keep: number) => {
    for (let t of owned) {
      let [row] = sql.query(`select * from ${q(t)} where entity = ?`, [gone])
      if (!row) continue
      if (!sql.query(`select 1 from ${q(t)} where entity = ?`, [keep]).length) {
        sql.query(`update ${q(t)} set entity = ? where entity = ?`, [
          keep,
          gone,
        ])
        continue
      }
      let cols = Object.keys(row).filter((c) => c != 'entity')
      if (cols.length) {
        sql.query(
          `update ${q(t)} set ${
            cols.map((c) => `${q(c)} = coalesce(${q(c)}, ?)`).join(', ')
          } where entity = ?`,
          [...cols.map((c) => row[c] as string | number | null), keep],
        )
      }
      sql.query(`delete from ${q(t)} where entity = ?`, [gone])
    }
    for (let [t, c] of refs) {
      sql.query(`update ${q(t)} set ${q(c)} = ? where ${q(c)} = ?`, [
        keep,
        gone,
      ])
    }
    sql.query('delete from entity where id = ?', [gone])
  }
}

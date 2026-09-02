// The DDL derivation (ddl.ts + db.ts `derived`): the last hand-kept twin of the
// vocabulary, closed. Two lines held here. One: the PropType → SQL affinity
// mapping. Two — the honesty guard, the same shape as indexes_test.ts — a fresh
// db's table for a DERIVED comp equals its vocabulary columns EXACTLY (a no-op
// diff against the schema that shipped), and EVERY component table (derived or
// hand-written) still carries every column the vocabulary declares, so a
// vocabulary edit that outran the schema fails loudly here.
Deno.env.set('DB_PATH', ':memory:')
let { derived } = await import('./db.ts')
let { open } = await import('./store/sqlite.ts')
import { derivedCols, sqlType } from './ddl.ts'
import { comps, type PropType, stamped } from './types.ts'
import { assert, assertEquals } from '@std/assert'

// Numbers store real, bools integer, an {eid} reference integer — it stores the
// target's internal id now (D-18866); everything else — enum, time, url, body,
// {text} — is text.
Deno.test('sqlType maps every PropType to its column affinity', () => {
  let cases: [PropType, string][] = [
    ['number', 'real'],
    ['priority', 'real'],
    ['bool', 'integer'],
    ['text', 'text'],
    ['body', 'text'],
    ['query', 'text'],
    ['time', 'text'],
    ['url', 'text'],
    [{ enum: ['a', 'b'] }, 'text'],
    [{ eid: 'project', death: 'detach' }, 'integer'],
    [{ text: 'domains' }, 'text'],
  ]
  for (let [t, want] of cases) assertEquals(sqlType(t), want)
})

type Info = {
  name: string
  type: string
  notnull: number
  dflt_value: unknown
  pk: number
}
let infoOf = (db: ReturnType<typeof open>, t: string) =>
  db.prepare(`pragma table_info("${t}")`).all() as Info[]

// A derived table is the entity-keyed spine plus its vocabulary columns, in
// declaration order, every one nullable and default-free. The spine key is now
// the `entity` integer id (D-18866). If a derived comp grew a NOT NULL / default
// column the derivation can't voice, this catches it — that comp belongs in the
// hand-written `schema`, not `derived`.
Deno.test('a derived table equals its vocabulary columns exactly', () => {
  let db = open(':memory:')
  for (let comp of derived) {
    // pragma reports the affinity uppercased, whatever case the DDL declared.
    let want = [
      { name: 'entity', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
      ...derivedCols(comp).map(({ prop }) => ({
        name: prop,
        type: sqlType({ ...comps[comp], ...stamped[comp] }[prop]).toUpperCase(),
        notnull: 0,
        dflt_value: null,
        pk: 0,
      })),
    ]
    assertEquals(
      infoOf(db, comp).map((c) => ({
        name: c.name,
        type: c.type,
        notnull: c.notnull,
        dflt_value: c.dflt_value ?? null,
        pk: c.pk,
      })),
      want,
      comp,
    )
  }
  db.close()
})

// The plugin-drop guard's inverse (T-12764): a comps fragment with no table
// column loses every write in silence. Hold it for the WHOLE vocabulary — the
// derived tables absorb a new column on their own, the hand-written ones must
// have it added, and a column the schema forgot fails here rather than in prod.
Deno.test('every component table carries every vocabulary column', () => {
  let db = open(':memory:')
  let names = [...new Set([...Object.keys(comps), ...Object.keys(stamped)])]
    .filter((n) => n != 'entity')
  for (let comp of names) {
    let cols = new Set(infoOf(db, comp).map((c) => c.name))
    assert(cols.has('entity'), `${comp} has no entity column`)
    for (let p of Object.keys({ ...comps[comp], ...stamped[comp] })) {
      assert(cols.has(p), `${comp}.${p} is declared but has no table column`)
    }
  }
  db.close()
})

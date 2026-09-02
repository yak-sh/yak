// The index vocabulary (types.ts `indexes` + index.ts `indexesFor`): the ONE
// declared source every backend's index set is generated from. These tests hold
// two lines — that `indexesFor` merges the composite/unique declarations with
// the auto-derived single-column {eid} indexes correctly, and that the
// declaration re-expresses EXACTLY the composite/unique indexes a fresh db
// enforces, so a later generator (T-12764) is a no-op diff against the live db.
Deno.env.set('DB_PATH', ':memory:')
let { open } = await import('./store/sqlite.ts')
import { indexesFor, refCols } from './index.ts'
import { comps, indexes, stamped } from './types.ts'
import { isRef } from './props.ts'
import { assertEquals } from '@std/assert'

// The declared composites come first, then one single-column index per {eid}
// ref the composite didn't already claim as a lone-column override.
Deno.test('indexesFor merges declarations with auto-derived ref indexes', () => {
  assertEquals(indexesFor('camera'), [
    { cols: ['client', 'canvas'], unique: true },
    { cols: ['client'] },
    { cols: ['canvas'] },
  ])
  assertEquals(indexesFor('fold'), [
    { cols: ['client', 'board'], unique: true },
    { cols: ['client'] },
    { cols: ['board'] },
  ])
  // A single-column declaration OVERRIDES its auto twin — shelf.client is
  // indexed once, as the unique the plain derivation couldn't give it.
  assertEquals(indexesFor('shelf'), [{ cols: ['client'], unique: true }])
  assertEquals(indexesFor('result'), [{ cols: ['call'], unique: true }])
  assertEquals(indexesFor('generation'), [{ cols: ['through'], unique: true }])
  assertEquals(indexesFor('entry'), [
    { cols: ['session', 'seq'], unique: true },
    { cols: ['session'] },
  ])
  assertEquals(indexesFor('output'), [
    { cols: ['source', 'key'], unique: true, where: 'key is not null' },
    { cols: ['source'] },
  ])
  assertEquals(indexesFor('subscription'), [
    { cols: ['actor', 'target'], unique: true },
    { cols: ['actor'] },
    { cols: ['target'] },
  ])
  // A comp with no declaration is pure auto-derivation over its refs.
  assertEquals(indexesFor('comment'), [{ cols: ['target'] }])
  // A comp with neither declaration nor ref has no index.
  assertEquals(indexesFor('doc'), [])
  assertEquals(indexesFor('completed'), [
    { cols: ['at'] },
    { cols: ['by'] },
    { cols: ['via'] },
  ])
})

// The invariant that makes the acceptance hold: every {eid} reference in the
// whole vocabulary gets exactly ONE single-column index — auto, or a lone-column
// override — so the single-column set indexesFor yields IS refCols.
Deno.test('every {eid} ref yields exactly one single-column index', () => {
  let single = new Set<string>()
  for (
    let c of new Set([
      ...Object.keys(comps),
      ...Object.keys(stamped),
      ...Object.keys(indexes),
    ])
  ) {
    for (let i of indexesFor(c)) {
      if (i.cols.length == 1 && isRef(c, i.cols[0])) {
        single.add(`${c}.${i.cols[0]}`)
      }
    }
  }
  assertEquals(single, new Set(refCols.map(([c, p]) => `${c}.${p}`)))
})

// The honesty guard: the declaration re-expresses EXACTLY the composite/unique
// AND auto-{eid} indexes a freshly open()ed db enforces. Pk indexes and the
// single-column uniques on NON-reference columns (session.id, alias.slug,
// entity.num) are hand-DDL facts the DSL leaves alone. What remains must match
// the declaration: the `indexes` map's composites/ref-uniques, plus the auto
// single-column {eid} indexes on EVERY component — derived and hand-written
// alike, since open() now realizes indexDdl over the whole vocabulary (T-17678)
// rather than only the DERIVED tables (T-12764). A drift here means the source
// of truth no longer describes the schema it claims to.
Deno.test('indexes map matches the db and dependency plans use both ends', () => {
  let d = open(':memory:')
  let tables = d.prepare(
    "select name from sqlite_master where type='table' and name not like 'sqlite_%'",
  ).all() as { name: string }[]
  let live = new Map<string, boolean>() // "table|cols" → is any index over them unique?
  for (let { name: t } of tables) {
    // The journal tables are hand-written log infrastructure, not part of the
    // component vocabulary this map guards — their ordering/lookup indexes are
    // declared in db.ts's schema template, not the indexes map.
    if (
      t == 'journal_tx' || t == 'journal_change' || t == 'journal_field'
    ) continue
    let ixs = d.prepare(`pragma index_list("${t}")`).all() as {
      name: string
      unique: number
      origin: string
    }[]
    for (let ix of ixs) {
      if (ix.origin == 'pk') continue // primary keys are structural, not declared
      let cols = (d.prepare(`pragma index_info("${ix.name}")`).all() as {
        name: string
      }[]).map((c) => c.name)
      let declared = (indexes[t] ?? []).some((i) =>
        i.cols.length == 1 && i.cols[0] == cols[0]
      )
      if (cols.length == 1 && !isRef(t, cols[0]) && !declared) continue
      let key = `${t}|${cols.join(',')}`
      live.set(key, (live.get(key) ?? false) || !!ix.unique)
    }
  }
  let plan = (sql: string, ...args: string[]) =>
    (d.prepare(`explain query plan ${sql}`).all(...args) as {
      detail: string
    }[])
      .map((r) => r.detail)
  let parent = plan('select * from dependency where parent = ?', 'p')
  let child = plan('select * from dependency where child = ?', 'c')
  let death = plan(
    'delete from dependency where parent = ? or child = ?',
    'x',
    'x',
  )
  let newest = plan('select * from completed order by at desc limit 1')
  d.close()

  let declared = new Map<string, boolean>()
  for (let [comp, list] of Object.entries(indexes)) {
    for (let i of list) declared.set(`${comp}|${i.cols.join(',')}`, !!i.unique)
  }
  // Every component now carries its auto single-column {eid} indexes in SQLite
  // — derived (T-12764) and hand-written (T-17678) — over the same vocabulary
  // universe open() walks, so `indexesFor` yields them and they belong in the
  // declared set.
  for (
    let comp of new Set([...Object.keys(comps), ...Object.keys(stamped)])
  ) {
    for (let i of indexesFor(comp)) {
      if (i.cols.length == 1) declared.set(`${comp}|${i.cols[0]}`, !!i.unique)
    }
  }

  assertEquals(new Set(live.keys()), new Set(declared.keys()))
  for (let [key, unique] of declared) assertEquals(live.get(key), unique, key)
  assertEquals(parent.some((x) => x.includes('SCAN dependency')), false)
  assertEquals(child.some((x) => x.includes('dependency_child')), true)
  assertEquals(death.some((x) => x.includes('SCAN dependency')), false)
  assertEquals(newest.some((x) => x.includes('completed_at')), true)
})

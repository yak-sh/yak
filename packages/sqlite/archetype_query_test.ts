import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import {
  among,
  col,
  compile,
  type Driver,
  render,
  select,
  table,
} from '@yaks/sql'
import { absent, and, or, parse, present } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { mem, seedIdentities, shop, spy } from './testing.ts'
import { backfill, rows, storage } from './mod.ts'
import { open, type Opened } from './db.ts'
import { catalog } from './catalog.ts'

let vocab = loadVocab([...shop.docs, archetypeDoc, {
  $defs: {
    marker: {
      component: true,
      type: 'object',
    },
  },
}])
test('archetype query golden: presence/kind, value joins, boolean, paths, reverse and aggregates', () => {
  let driver = mem()
  // Numbered: the golden reads the order a numbered store hands rows back in.
  let s = storage(driver, vocab, { number: true })
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  seedIdentities(g, 'stub')
  g.apply([
    { entity: { eid: 'a' }, doc: {}, marker: {} },
    {
      entity: { eid: 'b' },
      doc: { title: 'B' },
      product: { price: 4, maker: 'a' },
    },
    { entity: { eid: 'c' }, product: { maker: 'stub' } },
    { entity: { eid: 'r' }, review: { product: 'b', stars: 5 }, marker: {} },
  ])
  for (
    let q of [
      '.doc',
      '!doc',
      '?doc',
      '.marker',
      '.doc !product',
      '.kind=doc',
      '.kind=products',
      '.kind=review',
      '.doc .product.price>=4',
      '!doc.title',
      '.doc !doc.title',
      '.doc .count',
      '.product .tally=product.status',
      '.doc .order=doc.title .limit=1',
      '.product.maker.marker',
      '!product.maker.marker',
      '.reviews.marker',
      '.reviews!.marker',
    ]
  ) {
    let old = compile(parse(q), vocab)
    assertEquals(rows(driver, vocab, q), driver.query(old), q)
  }
  let bool = and(or(present('doc'), present('product')), absent('marker'))
  let old = compile(bool, vocab)
  assertEquals(rows(driver, vocab, bool), driver.query(old))
})

// A tally groups by the archetype each entity stores, and still answers with
// the archetype's eid: the count each entity's own archetype adds up to.
test('a tally by archetype counts each entity under its archetype', () => {
  // the entity's archetype as a property a query reads (@yaks/kernel's)
  let v = loadVocab([...vocab.docs, {
    $defs: {
      entity: {
        component: true,
        type: 'object',
        extends: true,
        properties: {
          archetype: { type: 'string', ref: 'archetype', stamped: true },
        },
      },
    },
  }])
  let s = storage(mem(), v)
  s.install()
  let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
  g.apply([
    { entity: { eid: 'a' }, doc: {}, marker: {} },
    { entity: { eid: 'b' }, doc: {} },
    { entity: { eid: 'c' }, doc: {} },
    { entity: { eid: 'd' }, marker: {} },
  ])
  g.apply([{ entity: { eid: 'c' }, $delete: true }])
  let of = new Map(
    s.rows('.fields=entity.archetype')
      .map((r) => [r.eid, r['entity.archetype'] as string]),
  )
  let sorted = (vs: string[]) => [...new Set(vs)].sort()
  let each = [...of.values()]
  assertEquals(
    s.rows('.tally=entity.archetype'),
    sorted(each).map((value) => ({
      value,
      n: each.filter((v) => v == value).length,
    })),
  )
  assertEquals(
    s.rows('.doc .distinct=entity.archetype'),
    sorted([of.get('a')!, of.get('b')!]).map((value) => ({ value })),
  )
})

// A path that ends on the archetype of the entity a reference names reads its
// eid, so reviews are found by what the product they review is made of.
test('a path through a reference reads the archetype of the entity it names', () => {
  let v = loadVocab([...vocab.docs, {
    $defs: {
      entity: {
        component: true,
        type: 'object',
        extends: true,
        properties: {
          archetype: { type: 'string', ref: 'archetype', stamped: true },
        },
      },
    },
  }])
  let s = storage(mem(), v)
  s.install()
  let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
  g.apply([
    { entity: { eid: 'b' }, doc: {}, product: { price: 4 } },
    { entity: { eid: 'p' }, product: { price: 2 } },
    { entity: { eid: 'r1' }, review: { product: 'b', stars: 5 } },
    { entity: { eid: 'r2' }, review: { product: 'p', stars: 3 } },
  ])
  let [of] = s.rows('.entity.eid=b&.fields=entity.archetype')
  let set = of['entity.archetype'] as string
  assertEquals(
    s.read(`.review.product.entity.archetype=${set}`)
      .map((b) => b.entity.eid),
    ['r1'],
  )
  assertEquals(s.rows('.review&.tally=review.product.entity.archetype'), [
    ...[{ value: set, n: 1 }, {
      value:
        s.rows('.entity.eid=p&.fields=entity.archetype')[0]['entity.archetype'],
      n: 1,
    }].toSorted((a, b) => String(a.value).localeCompare(String(b.value))),
  ])
})

test('a wide archetype catalog still answers a component query', () => {
  let flags = Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [
      `flag${i}`,
      { component: true, type: 'object', properties: {} },
    ]),
  )
  let v = loadVocab([...shop.docs, archetypeDoc, {
    $defs: {
      ...flags,
      excluded: { component: true, type: 'object', properties: {} },
    },
  }])
  let db = spy(mem(), (_, params) => {
    if (params.length > 100) throw new Error('too many SQL variables')
  })
  let s = storage(db, v)
  s.install()
  let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
  g.apply(Array.from({ length: 120 }, (_, i) => ({
    entity: { eid: `doc-${i}` },
    doc: {},
    ...Object.fromEntries(
      Array.from(
        { length: 7 },
        (_, bit) => i & (1 << bit) ? [[`flag${bit}`, {}]] : [],
      ).flat(),
    ),
  })))
  assertEquals(s.rows('.doc !excluded .count')[0]?.n, 120)
})

// What a search beside the graph is narrowed by (a store's `/meaning`), read
// through the archetype index as the store's own reads are.
test('a screen the store compiles admits what its query selects, by archetype', () => {
  let driver = mem()
  let s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([
    { entity: { eid: 'a' }, doc: {}, marker: {} },
    { entity: { eid: 'b' }, doc: {} },
    { entity: { eid: 'c' }, marker: {} },
    { entity: { eid: 'd' } },
  ])
  for (let q of ['.marker', '.doc !marker', '.kind=doc']) {
    let within = s.screen(q)!
    let admitted = driver.query(select({
      cols: [col('eid')],
      from: table('entity'),
      where: among(col('id'), within),
      order: [col('id')],
    }))
    assertEquals(admitted, s.rows(q), q)
    let plan = driver.query({ t: 'explain query plan', of: within })
      .map((r) => String(r.detail)).join('\n')
    assert(
      plan.includes('entity_archetype') ||
        (q != '.kind=doc' && !plan.includes('SCAN entity')),
      `${q}\n${plan}`,
    )
  }
})

test('archetype query/gather see new sets, rollback and reused descriptor ids', () => {
  let driver = mem()
  let s = storage(driver, vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  let ids = (q: string) => s.read(q).map((b) => b.entity.eid)
  assertEquals(ids('.marker'), [])
  let undo = (name: string) => {
    driver.query({ t: 'rollback', to: name })
    driver.query({ t: 'release', name })
  }
  driver.query({ t: 'savepoint', name: 'outer' })
  g.apply([{ entity: { eid: 'rolled-back' }, marker: {} }])
  assertEquals(ids('.marker'), ['rolled-back'])
  undo('outer')
  // A fresh writer learns a different set at the rolled-back descriptor's id.
  let other = graph({ storage: s, vocab, plugins: [archetypes()] })
  other.apply([{ entity: { eid: 'doc' }, doc: {} }])
  assertEquals(ids('.marker'), [])
  assertEquals(ids('.doc'), ['doc'])
  other.apply([{ entity: { eid: 'doc' }, marker: {} }])
  assertEquals(ids('.marker'), ['doc'])
  driver.query({ t: 'savepoint', name: 'remove' })
  other.apply([{ entity: { eid: 'doc' }, marker: null }])
  assertEquals(ids('.marker'), [])
  undo('remove')
  assertEquals(ids('.marker'), ['doc'])
})

test('archetype plans and gathers observe commits from another SQLite handle', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'archetype-read-' })
  let first = open(`${dir}/graph.sqlite`)
  let second = open(`${dir}/graph.sqlite`)
  let afterCatalog: (() => void) | undefined
  let driver = (db: Opened): Driver => ({
    ...db,
    // Read units on a file are deferred; the peer may commit while the
    // reader keeps the snapshot its catalog and entity query share.
    file: true,
    query: (s) => {
      let result = db.query(s)
      // The planner consults the connection's data version; a
      // commit landing right after it is the race this test stages.
      let sql = render(s).sql
      if (db == first && sql == 'pragma data_version') {
        let hook = afterCatalog
        afterCatalog = undefined
        hook?.()
      }
      return result
    },
  })
  try {
    let d1 = driver(first)
    let d2 = driver(second)
    let reader = storage(d1, vocab)
    reader.install()
    let writer = storage(d2, vocab)
    writer.install()
    let g = graph({ storage: writer, vocab, plugins: [archetypes()] })
    assertEquals(reader.read('.marker'), [])
    g.apply([{ entity: { eid: 'new' }, marker: {} }])
    assertEquals(reader.read('.marker').map((b) => b.entity.eid), ['new'])
    g.apply([{ entity: { eid: 'new' }, marker: null, doc: {} }])
    assertEquals(reader.read('.marker'), [])
    assertEquals(reader.read('.doc').map((b) => b.entity.eid), ['new'])
    // A raw writer has not yet classified its row: fallback remains exact.
    writer.tx((tx) => tx.patch([{ entity: { eid: 'raw' }, marker: {} }]))
    assertEquals(reader.read('.marker').map((b) => b.entity.eid), ['raw'])
    backfill(d1)
    assertEquals(reader.read('.marker').map((b) => b.entity.eid), ['raw'])
    // A writer adds one owner of an existing shape and one of a new shape
    // after planning. A stale catalog with a fresh entity scan would return
    // two matches: neither the old (one) nor the new (three) snapshot.
    afterCatalog = () => {
      writer.tx((tx) => {
        tx.patch([{
          entity: {
            eid: 'same-set',
            archetype: reader.tx((tx) => tx.get(['raw']))[0].entity.archetype,
          },
          marker: {},
        }])
        g.apply([{ entity: { eid: 'new-set' }, marker: {}, product: {} }])
      })
    }
    assertEquals(reader.rows('.marker .count'), [{ value: '', n: 1 }])
    assertEquals(reader.rows('.marker .count'), [{ value: '', n: 3 }])
    first.query({ t: 'drop', kind: 'table', name: 'marker' })
    let smaller = loadVocab([...shop.docs, archetypeDoc])
    storage(d1, smaller).install()
    assertEquals(reader.tx((tx) => tx.get(['raw']))[0].marker, undefined)
  } finally {
    first.close()
    second.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

// A save condition rechecks only the peer entity that changed. Its scope is
// wrapped around the already-built save query, rather than a flat string.
// The missing-property arm must not enumerate unrelated entities first.
test('an eid scope reaches disjunctions inside nested conjunctions', () => {
  let v = loadVocab([archetypeDoc, {
    $defs: {
      player: { component: true, type: 'object' },
      position: {
        component: true,
        type: 'object',
        properties: { at: { type: 'string', format: 'date-time' } },
      },
    },
  }])
  let d = mem()
  let s = storage(d, v)
  s.install()
  let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
  let ids = Array.from({ length: 1000 }, (_, i) => `candidate${i}`)
  let now = Date.parse('2026-10-04T12:00:00Z')
  g.apply(ids.map((eid, i) => ({
    entity: { eid },
    ...i < 3 || i == 999 ? { player: {} } : {},
    ...i < 7
      ? {
        position: i == 0
          ? {}
          : { at: new Date(now - (i == 1 ? 60_000 : 0)).toISOString() },
      }
      : {},
  })))
  let scope = parse(`.entity.eid=${ids[0]},${ids[1]},${ids[2]},${ids[999]}`)
  // Vale's save condition (T-65211). Four of its seven position entities have
  // no player, so this is also exercised with a scoped entity that cannot save.
  let original = parse('.player (!position.at | .position.at<="30s ago")')
  for (
    let q of [
      and(scope, original),
      and(and(scope), and(original)),
      and(original, scope),
      and(
        scope,
        parse(
          '.player ((!position.at | .position.at<="30s ago") | .position.at>now)',
        ),
      ),
      parse(
        `.player (!position.at | .position.at<="30s ago") .entity.eid=${
          ids[0]
        },${ids[1]},${ids[2]},${ids[999]}`,
      ),
    ]
  ) {
    assertEquals(s.rows(q, { now }), [{ eid: ids[0] }, { eid: ids[1] }, {
      eid: ids[999],
    }])
    let statement = compile(q, v, { archetypes: catalog(d), now })
    let plan = d.query({ t: 'explain query plan', of: statement })
      .map((r) => String(r.detail)).join('\n')
    assert(!plan.includes('SCAN entity'), plan)
    // Checking just the outer seek misses the unscoped UNION arms: they
    // materialize before the outer filter, and each reads the whole store.
    assert((plan.match(/SEARCH entity .*\(eid=\?\)/g) ?? []).length >= 2, plan)
  }
  assertEquals(
    s.rows(and(parse(`.entity.eid=${ids[3]}`), original), { now }),
    [],
  )
})

// A page driven from its own component's table screens other components per
// row while the catalog is cold, and by the archetype pointer once the catalog
// is in memory (T-65908, T-65275): either way it answers the same.
test('a screened page answers alike with the catalog cold or held', () => {
  let ran: string[] = []
  let base = mem()
  let watched = () => spy(base, (sql) => void ran.push(sql))
  let s = storage(watched(), vocab)
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  g.apply([
    { entity: { eid: 'a' }, doc: {} },
    { entity: { eid: 'b' }, doc: {}, marker: {} },
    { entity: { eid: 'c' }, doc: {} },
  ])
  // A store bound afresh has neither the catalog nor any answer in memory.
  let cold = () => {
    let fresh = storage(watched(), vocab)
    fresh.install()
    return fresh
  }
  // Each query asks a limit of its own, so no answer kept in memory serves it.
  let limit = 5
  // A query with no component of its own to drive from asks the catalog,
  // which then stays in memory until a new archetype is written.
  let hold = () => s.rows(`!marker .limit=${limit++}`)
  let page = (on: typeof s, expected: string[], held: boolean) => {
    ran = []
    assertEquals(
      on.rows(`.doc !marker .limit=${limit++}`),
      expected.map((eid) => ({ eid })),
    )
    assertEquals(ran.some((sql) => sql.includes('"archetype" in')), held)
  }
  hold()
  page(cold(), ['c', 'a'], false)
  page(s, ['c', 'a'], true)
  g.apply([{ entity: { eid: 'c' }, marker: {} }])
  hold()
  page(s, ['a'], true)
  page(cold(), ['a'], false)
  g.apply([{ entity: { eid: 'b' }, marker: null }])
  hold()
  page(s, ['b', 'a'], true)
  page(cold(), ['b', 'a'], false)
})

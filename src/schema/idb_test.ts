// The IndexedDB backend (idb.ts): the generated stores+indexes match the
// vocabulary, and a store-backed resolver answers the SAME query.ts `Pred[]` the
// in-memory resolver does — one query set, two backings, identical answers,
// including multi-hop traversal. IDB is browser-only, so fake-indexeddb supplies
// a real request/cursor engine in Deno (the lighter path than driving a browser;
// it exercises the same createIndex/getAllKeys the shipped code uses).
import 'npm:fake-indexeddb@6/auto'
import { anchor, emptyIndex, indexAll, refCols } from '../index.ts'
import { parseQuery, type Pred } from '../query.ts'
import { memoryResolver, type Store } from '../resolver.ts'
import { indexes } from '../types.ts'
import {
  clearIdb,
  idbResolver,
  idbStore,
  idbStores,
  openIdb,
  putBags,
  schemaShape,
  schemaVersion,
  seedIdb,
  storeNames,
} from './idb.ts'
import { assert, assertEquals } from '@std/assert'
import { slow } from '../testing.ts'

type Row = Record<string, Record<string, unknown> | undefined>
type Graph = Record<string, Row>

// The in-memory store live.ts fills from its cache, freestanding here — the same
// stand-in resolver_test.ts uses, rebuilding the derived index on each anchor.
let storeOver = (graph: Graph): Store => {
  let ix = emptyIndex()
  return {
    read: (eid) => graph[eid],
    keys: () => Object.keys(graph),
    anchor: (preds) => {
      indexAll(ix, graph, [])
      return anchor(ix, preds)
    },
  }
}

let q = (line: string): Pred[] => parseQuery(line)
let sorted = (xs: string[]) => xs.toSorted()

// A little graph exercising every pred shape: scalars, refs, a time column, and
// a two- and three-deref traversal (comment → task → assignee → doc.title).
let graph = (): Graph => ({
  proj: { entity: { num: 1 }, project: {}, doc: { title: 'Proj' } },
  p1: { entity: { num: 2 }, person: {}, doc: { title: 'alice' } },
  p2: { entity: { num: 3 }, person: {}, doc: { title: 'bob' } },
  t1: {
    entity: { num: 4 },
    task: { status: 'open', priority: 1, project: 'proj', assignee: 'p1' },
    doc: { title: 'foo task' },
    created: { at: '2026-08-05T00:00:00.000Z' },
  },
  t2: {
    entity: { num: 5 },
    task: { status: 'wip', priority: 2, project: 'proj', assignee: 'p2' },
    doc: { title: 'bar task' },
    created: { at: '2026-07-01T00:00:00.000Z' },
  },
  t3: {
    entity: { num: 6 },
    task: { status: 'done', priority: 3, assignee: 'p1' },
    doc: { title: 'baz' },
    created: { at: '2026-08-10T00:00:00.000Z' },
  },
  c1: {
    entity: { num: 7 },
    comment: { target: 't1' },
    doc: { title: 'c1 note' },
  },
  c2: {
    entity: { num: 8 },
    comment: { target: 't2' },
    doc: { title: 'c2 note' },
  },
  c3: {
    entity: { num: 9 },
    comment: { target: 't3' },
    doc: { title: 'c3 note' },
  },
})

// One query set — equality, ref-equality (index-served), presence, absence,
// negation, range, time, a combined pred, text, and 2- and 3-deref traversal.
let battery = [
  '.status=open',
  '.status!=done',
  '.assignee=p1',
  '.project=proj',
  '.doc!',
  '.assignee=',
  '.priority=1..2',
  '.created.at>=2026-08-01',
  '.status=open .priority<=2',
  'foo',
  '.comment.target.doc.title~=foo',
  '.comment.target.task.assignee.doc.title~=alice',
]

let fresh = async (g: Graph) => {
  let db = await openIdb(`t-${crypto.randomUUID()}`)
  await seedIdb(db, g)
  return db
}

Deno.test('IDB and in-memory resolvers answer one query set identically', async () => {
  let g = graph()
  let mem = memoryResolver(storeOver(g))
  let db = await fresh(g)
  let idb = idbResolver(db)
  try {
    for (let line of battery) {
      let preds = q(line)
      let want = sorted(mem.resolve(preds))
      let got = sorted(await idb.ready(preds))
      assertEquals(got, want, `mismatch for "${line}"`)
    }
    // The traversal actually traverses — not a vacuous empty-on-both.
    assertEquals(sorted(await idb.ready(q('.comment.target.doc.title~=foo'))), [
      'c1',
    ])
    assertEquals(
      sorted(
        await idb.ready(q('.comment.target.task.assignee.doc.title~=alice')),
      ),
      ['c1', 'c3'],
    )
  } finally {
    db.close()
  }
})

Deno.test('putBags writes a batch, deleting where a component is absent (slice e mirror)', async () => {
  let g = graph()
  let db = await fresh(g)
  let idb = idbResolver(db)
  try {
    assertEquals(sorted(await idb.ready(q('.assignee=p1'))), ['t1', 't3'])
    // The applyLocal mirror: t3 drops its task component, t1 gains p2 — one
    // batched write, the same shape live.ts drives from a patch's touched eids.
    await putBags(db, [
      ['t3', { entity: { num: 6 }, doc: { title: 'baz' } }],
      ['t1', {
        entity: { num: 4 },
        task: { status: 'open', priority: 1, project: 'proj', assignee: 'p2' },
        doc: { title: 'foo task' },
      }],
    ])
    assertEquals(sorted(await idb.ready(q('.assignee=p1'))), [])
    assertEquals(sorted(await idb.ready(q('.assignee=p2'))), ['t1', 't2'])
    // clearIdb empties every store — the wholesale-reset first half.
    await clearIdb(db)
    assertEquals(await idb.ready(q('.status=open')), [])
  } finally {
    db.close()
  }
})

Deno.test('prime seeds a new query signal synchronously, before the async scan', async () => {
  let g = graph()
  let db = await fresh(g)
  // The prime live.ts supplies: the in-memory resolver's anchored answer, so a
  // freshly-mounted board paints its rows on the same frame.
  let mem = memoryResolver(storeOver(g))
  let idb = idbResolver(db, idbStores(), (preds) => mem.resolve(preds))
  try {
    // No await: the signal already carries the primed set the instant a board
    // mounts, rather than empty-then-filled.
    let ids = idb.subscribe(q('.assignee=p1'))
    assertEquals(sorted(ids.value), ['t1', 't3'])
    // The durable scan then confirms the identical membership on settle.
    assertEquals(sorted(await idb.ready(q('.assignee=p1'))), ['t1', 't3'])
    assertEquals(sorted(ids.value), ['t1', 't3'])
  } finally {
    db.close()
  }
})

Deno.test('a live subscription fires on a membership change, row-locally', async () => {
  let g = graph()
  let db = await fresh(g)
  let idb = idbResolver(db)
  try {
    let ids = idb.subscribe(q('.assignee=p1'))
    await idb.ready(q('.assignee=p1'))
    assertEquals(sorted(ids.value), ['t1', 't3'])
    // sync door returns the settled snapshot
    assertEquals(sorted(idb.resolve(q('.assignee=p1'))), ['t1', 't3'])

    // Reassign t2 to p1 in the durable store, then tell the resolver which row
    // moved — it joins, and an unrelated query stays asleep.
    let g2 = { ...g.t2!, task: { ...g.t2!.task, assignee: 'p1' } }
    await seedIdb(db, { t2: g2 })
    await idb.refresh(new Set(['t2']))
    assertEquals(sorted(ids.value), ['t1', 't2', 't3'])
  } finally {
    db.close()
  }
})

Deno.test('every component has a store and every index entry is generated', () => {
  let stores = idbStores()
  let names = new Set(stores.map((s) => s.name))
  // one store per component in the vocabulary union
  assertEquals(names.size, storeNames().length)
  for (
    let c of [
      'entity',
      'task',
      'doc',
      'comment',
      'project',
      'archived',
      'recall',
    ]
  ) {
    assert(names.has(c), `no store for ${c}`)
  }
  // every {eid} reference earns its auto single-column index
  for (let [comp, prop] of refCols) {
    let store = stores.find((s) => s.name == comp)!
    assert(
      store.indexes.some((i) => i.name == `${comp}_${prop}`),
      `no index ${comp}_${prop}`,
    )
  }
  // every declared composite is generated: array keyPath, unique honored,
  // `where` dropped to a full index
  for (let [comp, decls] of Object.entries(indexes)) {
    let store = idbStore(comp)
    for (let d of decls) {
      let ix = store.indexes.find((i) =>
        i.name == `${comp}_${d.cols.join('_')}`
      )!
      assert(ix, `no composite index for ${comp} ${d.cols}`)
      assertEquals(ix.keyPath, d.cols.length == 1 ? d.cols[0] : d.cols)
      assertEquals(ix.unique, !!d.unique)
    }
  }
  // a spot check of the composite shape
  let camera = idbStore('camera').indexes.find((i) =>
    i.name == 'camera_client_canvas'
  )!
  assertEquals(camera.keyPath, ['client', 'canvas'])
  assertEquals(camera.unique, true)
})

Deno.test('the schema version is a positive int, moved by any shape change', () => {
  let v = schemaVersion()
  assert(Number.isInteger(v) && v >= 1)
  // drop an index from the shape → the version must move
  let mutated = idbStores().map((s) =>
    s.name == 'task' ? { ...s, indexes: s.indexes.slice(1) } : s
  )
  assert(schemaVersion(mutated) != v)
  assert(schemaShape().includes('task_project'))
})

// Frame-budget probe: the traversal set is the riskiest — an async cursor walk
// where SQL would JOIN. Measure ready() (cold resolve) and refresh() (the live
// re-test) over a graph large enough to be meaningful, and print the numbers.
slow('traversal resolves within the frame budget', async () => {
  let g: Graph = {}
  let N = 150
  for (let i = 0; i < N; i++) {
    let assignee = i % 2 ? 'p1' : 'p2'
    g[`k${i}`] = {
      entity: { num: 100 + i },
      task: { status: 'open', priority: 1, assignee },
      doc: { title: `task ${i}` },
    }
    g[`m${i}`] = { entity: { num: 400 + i }, comment: { target: `k${i}` } }
  }
  g.p1 = { entity: { num: 2 }, person: {}, doc: { title: 'alice' } }
  g.p2 = { entity: { num: 3 }, person: {}, doc: { title: 'bob' } }
  let db = await fresh(g)
  let idb = idbResolver(db)
  try {
    let line = '.comment.target.task.assignee.doc.title~=alice'
    let preds = q(line)
    // warm once, then time the steady-state resolve
    await idb.ready(preds)
    let runs = 8
    let t0 = performance.now()
    for (let i = 0; i < runs; i++) await idb.ready(preds)
    let resolveMs = (performance.now() - t0) / runs

    idb.subscribe(preds)
    await idb.ready(preds)
    let r0 = performance.now()
    await idb.refresh(new Set(['m0', 'm1']))
    let refreshMs = performance.now() - r0

    // half the comments (odd index → k*.assignee p1 → alice)
    assertEquals((await idb.ready(preds)).length, N / 2)
    // The printed numbers are the frame-budget evidence — a cold 3-deref
    // traversal over 300+ entities and a live refresh both land well under a
    // 16ms frame on the fake IDB engine. The ASSERTION is a generous regression
    // guard, not a browser stopwatch: shim ms ≠ browser ms, and a hard 16ms
    // gate would flake under CI load. A 10x jump means the algorithm regressed.
    console.log(
      `[idb frame-budget] ${N} comments / ${N * 2 + 2} entities · resolve ${
        resolveMs.toFixed(2)
      }ms · refresh(2) ${refreshMs.toFixed(2)}ms`,
    )
    assert(resolveMs < 100, `resolve ${resolveMs}ms — 10x regression`)
    assert(refreshMs < 100, `refresh ${refreshMs}ms — 10x regression`)
  } finally {
    db.close()
  }
})

// The resolver seam (resolver.ts): the in-memory realization resolves a query
// one-shot and as a narrow live signal, folds a multi-hop traversal through the
// same matchQuery it always did, and maintains membership row-locally — and a
// SECOND implementation satisfies the same Resolver interface, proof the seam is
// real (T-17124, the boundary T-17125's IDB backend plugs into). Pure — a plain
// mutable graph stands in for the live cache, so no DB and no DOM.
import { anchor, emptyIndex, indexAll } from './index.ts'
import { parseQuery, type Pred } from './query.ts'
import { memoryResolver, type Resolver, type Store } from './resolver.ts'
import { effect, signal } from '@preact/signals'
import { assertEquals } from '@std/assert'

type Row = Record<string, Record<string, unknown> | undefined>
type Graph = Record<string, Row>

// A store over a plain, mutable graph — the seam live.ts fills from its cache,
// freestanding here. `anchor` rebuilds the derived index each call (the test's
// stand-in for live.ts's incremental syncIx heal).
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

Deno.test('memoryResolver resolves and subscribes an {eid}-ref query, narrowly', () => {
  let graph: Graph = {
    person: { entity: { num: 1 }, person: {} },
    t1: {
      entity: { num: 2 },
      task: { status: 'open', priority: 1, assignee: 'person' },
    },
    t2: {
      entity: { num: 3 },
      task: { status: 'open', priority: 1, assignee: 'other' },
    },
  }
  let r = memoryResolver(storeOver(graph))
  let preds = q('.assignee=person')
  // one-shot GET, then the live signal — the two doors, same answer.
  assertEquals(r.resolve(preds), ['t1'])
  let ids = r.subscribe(preds)
  assertEquals(ids.value, ['t1'])

  let runs = 0
  let stop = effect(() => {
    ids.value
    runs++
  })
  try {
    // Reassign t2 to person and tell the resolver which row moved — it joins.
    graph.t2!.task = { status: 'open', priority: 1, assignee: 'person' }
    r.refresh(new Set(['t2']))
    assertEquals(ids.value.toSorted(), ['t1', 't2'])
    assertEquals(runs, 2)
    // An unrelated row's patch — membership unchanged, zero re-render.
    graph.person!.doc = { title: 'x' }
    r.refresh(new Set(['person']))
    assertEquals(runs, 2)
    // Reassign t1 away — it leaves.
    graph.t1!.task = { status: 'open', priority: 1, assignee: 'other' }
    r.refresh(new Set(['t1']))
    assertEquals(ids.value, ['t2'])
    assertEquals(runs, 3)
  } finally {
    stop()
  }
})

Deno.test('memoryResolver folds a multi-hop traversal (T-17123)', () => {
  let graph: Graph = {
    c1: { entity: { num: 1 }, comment: { target: 't1' } },
    c2: { entity: { num: 2 }, comment: { target: 't2' } },
    t1: {
      entity: { num: 3 },
      task: { status: 'open', priority: 1 },
      doc: { title: 'foo' },
    },
    t2: {
      entity: { num: 4 },
      task: { status: 'open', priority: 1 },
      doc: { title: 'bar' },
    },
  }
  let r = memoryResolver(storeOver(graph))
  // The comment whose target's doc.title contains foo — a chained deref through
  // comment.target → doc.title, resolved in-memory (leafOf + matchQuery fold).
  let preds = q('.comment.target.doc.title~=foo')
  assertEquals(r.resolve(preds), ['c1'])
  let ids = r.subscribe(preds)
  assertEquals(ids.value, ['c1'])
  // Re-point c2 at t1 (whose doc is foo) — a row-local change to c2 joins it.
  graph.c2!.comment = { target: 't1' }
  r.refresh(new Set(['c2']))
  assertEquals(ids.value.toSorted(), ['c1', 'c2'])
})

Deno.test('a projection re-fires on a waking column, sleeps on a volatile one', () => {
  // The canvas working set's shape: pins on a canvas, projecting the box and
  // marking z VOLATILE (`~`). Membership is `.pin.canvas=cv`; the projection
  // rides along, so a move (x) re-fires while a z-bump never does — the exact
  // wake the Card list depends on (T-18103).
  let graph: Graph = {
    a: { entity: { num: 1 }, pin: { canvas: 'cv', x: 0, y: 0, z: 1 } },
    b: { entity: { num: 2 }, pin: { canvas: 'other', x: 0, y: 0, z: 1 } },
  }
  let r = memoryResolver(storeOver(graph))
  let preds = q('.pin.canvas=cv&.fields=pin.x,pin.y,pin.z~')
  let ids = r.subscribe(preds)
  assertEquals(ids.value, ['a'])

  let runs = 0
  let stop = effect(() => {
    ids.value
    runs++
  })
  try {
    // A z-bump on the member — projected but volatile — never wakes the set.
    graph.a!.pin = { canvas: 'cv', x: 0, y: 0, z: 9 }
    r.refresh(new Set(['a']))
    assertEquals(runs, 1)
    // A move (x) IS a waking column — the same members re-publish so the view
    // re-reads their boxes.
    graph.a!.pin = { canvas: 'cv', x: 50, y: 0, z: 9 }
    r.refresh(new Set(['a']))
    assertEquals(runs, 2)
    // An unrelated row on another canvas — neither membership nor a member's
    // fields moved, so the set stays asleep.
    graph.b!.pin = { canvas: 'other', x: 7, y: 0, z: 1 }
    r.refresh(new Set(['b']))
    assertEquals(runs, 2)
  } finally {
    stop()
  }
})

Deno.test('a second Resolver implementation satisfies the same interface', () => {
  // A stub backend answering from a canned set — no cache, no index. It stands
  // in wherever a Resolver is expected, so the seam is not shaped around the
  // in-memory impl.
  let stub: Resolver = {
    resolve: () => ['a', 'b'],
    subscribe: () => signal(['a', 'b']),
  }
  let mem = memoryResolver(storeOver({
    a: { entity: { num: 1 }, task: { status: 'open', priority: 1 } },
  }))
  // One consumer, typed to the seam, drives either backing.
  let count = (res: Resolver, preds: Pred[]) => res.resolve(preds).length
  assertEquals(count(stub, q('.status=open')), 2)
  assertEquals(count(mem, q('.status=open')), 1)
  assertEquals(stub.subscribe(q('.status=open')).value, ['a', 'b'])
  assertEquals(mem.subscribe(q('.status=open')).value, ['a'])
})

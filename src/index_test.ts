// The derived index (index.ts): refCols flows from the vocabulary, the reverse
// {eid} index and edge endpoints maintain incrementally, and anchor() picks the
// smallest candidate set for a query. Pure — no cache, no DOM.
import {
  anchor,
  emptyIndex,
  indexAll,
  refCols,
  reindex,
  reindexEdge,
} from './index.ts'
import { parseQuery } from './query.ts'
import { assertEquals } from '@std/assert'

// refCols is DERIVED from comps/stamped — every {eid} column, nothing else.
Deno.test('refCols names every {eid} reference from the vocabulary', () => {
  let has = (comp: string, prop: string) =>
    refCols.some(([c, p]) => c == comp && p == prop)
  // wire-writable references
  assertEquals(has('deliver', 'to'), true)
  assertEquals(has('comment', 'target'), true)
  assertEquals(has('claim', 'session'), true)
  assertEquals(has('task', 'project'), true)
  assertEquals(has('task', 'assignee'), true)
  // a server-stamped reference joins from `stamped`
  assertEquals(has('created', 'via'), true)
  // scalars never do
  assertEquals(has('task', 'status'), false)
  assertEquals(has('doc', 'title'), false)
})

Deno.test('reindex builds and maintains the reverse {eid} index', () => {
  let ix = emptyIndex()
  reindex(ix, 'w1', undefined, { wake: {}, deliver: { to: 's1' } })
  reindex(ix, 'w2', undefined, { wake: {}, deliver: { to: 's1' } })
  reindex(ix, 'w3', undefined, { wake: {}, deliver: { to: 's2' } })
  assertEquals(ix.refs.get('deliver.to')?.get('s1'), new Set(['w1', 'w2']))
  assertEquals(ix.refs.get('deliver.to')?.get('s2'), new Set(['w3']))
  assertEquals(ix.byComp.get('wake'), new Set(['w1', 'w2', 'w3']))

  // retarget w1: it leaves s1, joins s2
  reindex(ix, 'w1', { wake: {}, deliver: { to: 's1' } }, {
    wake: {},
    deliver: { to: 's2' },
  })
  assertEquals(ix.refs.get('deliver.to')?.get('s1'), new Set(['w2']))
  assertEquals(ix.refs.get('deliver.to')?.get('s2'), new Set(['w3', 'w1']))

  // death: w2 leaves the index entirely, and the now-empty s1 key is gone
  reindex(ix, 'w2', { wake: {}, deliver: { to: 's1' } }, undefined)
  assertEquals(ix.refs.get('deliver.to')?.has('s1'), false)
  assertEquals(ix.byComp.get('wake'), new Set(['w1', 'w3']))
})

Deno.test('reindexEdge indexes edge triples by both endpoints', () => {
  let ix = emptyIndex()
  let d = { parent: 'a', type: 'requires' as const, child: 'b' }
  reindexEdge(ix, d, false)
  assertEquals(ix.byParent.get('a'), [d])
  assertEquals(ix.byChild.get('b'), [d])
  // a new array on change, so a narrow relation signal sees a fresh reference
  let before = ix.byParent.get('a')
  reindexEdge(ix, { parent: 'a', type: 'reads', child: 'c' }, false)
  assertEquals(ix.byParent.get('a') === before, false)
  assertEquals(ix.byParent.get('a')?.length, 2)
  // removal empties the endpoint
  reindexEdge(ix, d, true)
  assertEquals(ix.byChild.get('b'), undefined)
  assertEquals(ix.byParent.get('a')?.length, 1)
})

Deno.test('anchor picks the reverse-index set for an eid-ref equality', () => {
  let ix = emptyIndex()
  indexAll(ix, {
    w1: { wake: {}, deliver: { to: 's1' } },
    w2: { wake: {}, deliver: { to: 's2' } },
    w3: { wake: {}, deliver: { to: 's1' }, delivered: {} },
  }, [])
  // .deliver.to=s1 anchors on the reverse set {w1,w3}, smaller than byComp[wake]
  let a = anchor(ix, parseQuery('.wake! .deliver.to=s1 .delivered= .error='))
  assertEquals(a, new Set(['w1', 'w3']))
})

Deno.test('anchor falls back to component presence, and to nothing', () => {
  let ix = emptyIndex()
  indexAll(ix, {
    t1: { task: {} },
    t2: { task: {}, claim: { session: 's1' } },
    d1: { doc: { title: 'x' } },
  }, [])
  // a scalar pred requires its component present -> byComp[task]
  assertEquals(anchor(ix, parseQuery('.status=open')), new Set(['t1', 't2']))
  // a pure absence pred implies no presence -> whole-cache fallback
  assertEquals(anchor(ix, parseQuery('.delivered=')), undefined)
})

Deno.test('anchor unions the reverse index for a .refs= backlink lookup', () => {
  let ix = emptyIndex()
  indexAll(ix, {
    // three referrers of t1 through THREE different {eid} columns...
    c1: { comment: { target: 't1' } },
    c2: { comment: { target: 't1' } },
    t2: { task: { project: 't1' } },
    // ...and one that points elsewhere
    x: { comment: { target: 'other' } },
  }, [])
  // the candidate set is the union of every reverse map for t1 — O(referrers)
  assertEquals(
    anchor(ix, parseQuery('.refs=t1')),
    new Set(['c1', 'c2', 't2']),
  )
  // presence/absence admit rows in no reverse map, so they anchor nothing
  assertEquals(anchor(ix, parseQuery('.refs=')), undefined)
  assertEquals(anchor(ix, parseQuery('.refs!')), undefined)
})

Deno.test('anchor narrows a multi-hop path to its NEAR component', () => {
  let ix = emptyIndex()
  indexAll(ix, {
    c1: { comment: { target: 't1' } },
    c2: { comment: { target: 't2' } },
    t1: { task: {}, doc: { title: 'foo' } },
    t2: { task: {}, doc: { title: 'bar' } },
  }, [])
  // The chain's result rows are the COMMENTS, so the candidate set is
  // byComp[comment] — the far doc.title is tested by the matcher, not anchored.
  assertEquals(
    anchor(ix, parseQuery('.comment.target.doc.title~=foo')),
    new Set(['c1', 'c2']),
  )
})

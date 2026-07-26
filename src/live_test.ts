// The cache derivations: what the field pickers read out of the live
// world. Pure functions of the cache signal — no DOM, no socket.
import {
  applyLocal,
  backlinks,
  byWarmth,
  cache,
  commentCount,
  deps,
  domains,
  ent,
  gated,
  pinned,
  projects,
  topZ,
} from './live.ts'
import { type Ent } from './types.ts'
import { assertEquals } from '@std/assert'

// A cache of task/project rows: `['T', 'Ops']` is a task in domain Ops
// (null = the column is absent), `['P', 'Fable']` a project by title.
let fill = (rows: [string, string | null][]) => {
  cache.value = Object.fromEntries(rows.map(([kind, v], i) => [
    `e${i}`,
    kind == 'T'
      ? {
        entity: { eid: `e${i}`, num: i, created_at: '' },
        task: { eid: `e${i}`, status: 'open', priority: 1, domain: v },
      }
      : {
        entity: { eid: `e${i}`, num: i, created_at: '' },
        doc: { eid: `e${i}`, title: v ?? '', body: '' },
        project: { eid: `e${i}` },
      },
  ]))
}

Deno.test('domains: distinct, sorted, absent ones skipped', () => {
  fill([['T', 'Ops'], ['T', 'Eng'], ['T', 'Ops'], ['T', null], ['P', 'Fable']])
  assertEquals(domains.value, ['Eng', 'Ops'])
})

Deno.test('domains: an empty string is not a domain', () => {
  fill([['T', ''], ['T', 'Eng']])
  assertEquals(domains.value, ['Eng'])
})

Deno.test('domains: nothing to say about an empty graph', () => {
  fill([])
  assertEquals(domains.value, [])
})

Deno.test('projects: project rows only, oldest first, named by doc', () => {
  fill([['T', 'Ops'], ['P', 'Sol'], ['P', 'Fable']])
  assertEquals(projects().map((p) => p.doc?.title), ['Sol', 'Fable'])
})

Deno.test('commentCount: events are not conversation', () => {
  let comment = (eid: string, target_eid: string, event?: number) => ({
    comment: { eid, target_eid, author_eid: null, event },
  })
  cache.value = {
    prose: comment('prose', 'talk'),
    machine: comment('machine', 'talk', 1),
    alone: comment('alone', 'event-only', 1),
  }
  assertEquals(commentCount.value, { talk: 1 })
})

// Backlinks read the SCHEMA — wire vocabulary plus server-stamped columns
// (a session's requested_task_eid is an edge no client may write).
Deno.test('backlinks: stamped associations count', () => {
  cache.value = {
    t1: {
      entity: { eid: 't1', num: 1 },
      task: { eid: 't1', status: 'open', priority: 1, domain: null },
    },
    s1: {
      entity: { eid: 's1', num: 2 },
      session: { eid: 's1', id: 'x', requested_task_eid: 't1' },
    },
    c1: {
      entity: { eid: 'c1', num: 3 },
      claim: { eid: 'c1', session_eid: 's1' },
    },
  }
  assertEquals(backlinks('t1'), [{
    from: 's1',
    via: 'session.requested_task_eid',
  }])
  assertEquals(backlinks('s1'), [{ from: 'c1', via: 'claim.session_eid' }])
})

// byWarmth: the .order=hot board sort — a well-recalled old thing
// outranks a merely new one, and the unrecalled fade on their own.
Deno.test('byWarmth: recalled-often beats merely-new beats faded', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let iso = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
  let old = {
    num: 1,
    created: { at: iso(5) },
    recall: { eid: 'o', count: 40, first_at: iso(60), last_at: iso(0.2) },
  } as unknown as Ent
  let fresh = { num: 2, created: { at: iso(0.5) } } as unknown as Ent
  let faded = { num: 3, created: { at: iso(6) } } as unknown as Ent
  assertEquals(
    [faded, fresh, old].sort(byWarmth(NOW)).map((e) => e.num),
    [1, 2, 3],
  )
})

// gated() burns red only for an open `requires` child — a cancelled one
// settles the gate exactly like done, same as an unmet blocker changing
// its mind rather than finishing.
Deno.test('gated: a cancelled requires child releases the gate', () => {
  let mk = (status: string) => ({
    entity: { eid: `x`, num: 0, created_at: '' },
    task: { eid: 'x', status, priority: 1 },
  })
  cache.value = { parent: mk('open'), blocker: mk('open') }
  deps.value = [{ parent: 'parent', type: 'requires', child: 'blocker' }]
  assertEquals(gated(ent('parent')), true)

  cache.value = { parent: mk('open'), blocker: mk('cancelled') }
  assertEquals(gated(ent('parent')), false)

  cache.value = { parent: mk('open'), blocker: mk('done') }
  assertEquals(gated(ent('parent')), false)
})

// ent(): edges partition into refs (non-contains, {type, child}) and kids
// (contains, resolved), preserving deps order per parent — the indexed
// scan (T-6772) must stay byte-identical to the old double-filter.
Deno.test('ent: refs and kids partition edges, order preserved', () => {
  let sp = (eid: string) => ({
    entity: { eid, num: 0, created_at: '' },
    task: { eid, status: 'open', priority: 1, domain: null },
  })
  cache.value = { p: sp('p'), a: sp('a'), b: sp('b'), c: sp('c') }
  deps.value = [
    { parent: 'p', type: 'contains', child: 'b' },
    { parent: 'p', type: 'requires', child: 'a' },
    { parent: 'p', type: 'contains', child: 'c' },
    { parent: 'other', type: 'requires', child: 'a' },
  ]
  let e = ent('p')
  assertEquals(e.refs, [{ type: 'requires', child: 'a' }])
  assertEquals(e.kids.map((k) => k.eid), ['b', 'c'])
})

// applyLocal returns the keys it touched, the map the IDB persist tail
// writes (T-6823). A component merge/delete touches its eid; a dependency
// change names its edge; an entity death touches the eid AND every edge it
// swept from deps — the cascade the shadow must drop too.
Deno.test('applyLocal: reports touched eids and edges', () => {
  let sp = (eid: string) => ({
    entity: { eid, num: 0 },
    task: { eid, status: 'open', priority: 1, domain: null },
  })
  cache.value = { a: sp('a'), b: sp('b') }
  deps.value = []
  // a component merge and a component delete each touch their eid
  let t1 = applyLocal([
    { eid: 'a', name: 'task', comp: { status: 'done' } },
    { eid: 'b', name: 'task', comp: null },
  ])
  assertEquals(t1.eids.toSorted(), ['a', 'b'])
  assertEquals(t1.edges, [])
  // an edge add names its whole triple
  let t2 = applyLocal([
    {
      eid: 'a',
      name: 'dependency',
      comp: { type: 'requires', child_eid: 'b' },
    },
  ])
  assertEquals(t2.eids, [])
  assertEquals(t2.edges, [{ parent: 'a', type: 'requires', child: 'b' }])
  assertEquals(deps.value.length, 1)
})

// The cascade: deleting an entity reports the eid plus every edge that
// touched it — as parent OR child — so persist() deletes the same rows the
// signal filtered out (else a hydrate re-reads ghost edges).
Deno.test('applyLocal: entity death sweeps its edges into the report', () => {
  let sp = (eid: string) => ({ entity: { eid, num: 0 } })
  cache.value = { p: sp('p'), a: sp('a'), b: sp('b') }
  deps.value = [
    { parent: 'p', type: 'contains', child: 'a' }, // a as child of dead p
    { parent: 'b', type: 'requires', child: 'p' }, // p as child, b survives
    { parent: 'a', type: 'requires', child: 'b' }, // untouched by p's death
  ]
  let t = applyLocal([{ eid: 'p', name: 'entity', comp: null }])
  assertEquals(t.eids, ['p'])
  assertEquals(t.edges.toSorted((x, y) => (x.parent < y.parent ? -1 : 1)), [
    { parent: 'b', type: 'requires', child: 'p' },
    { parent: 'p', type: 'contains', child: 'a' },
  ])
  // the signal kept only the edge that never touched p
  assertEquals(deps.value, [{ parent: 'a', type: 'requires', child: 'b' }])
  assertEquals(cache.value.p, undefined)
})

// The WS one-channel boot closes the live-vs-catch-up reorder (T-6829): the
// server sends the catch-up BEFORE joining the socket to the broadcast, so a
// live frame always ARRIVES after it. The client just applies frames in
// arrival order — the socket handler is applyLocal(catchup) then applyLocal
// (live) — and a shared column ends at the newer (live) value. No buffer.
Deno.test('catch-up then live batch apply in arrival order', () => {
  cache.value = {
    x: {
      entity: { eid: 'x', num: 1 },
      task: { eid: 'x', status: 'open', priority: 1, domain: null },
    },
  }
  deps.value = []
  // the catch-up frame (older) arrives first over the one channel
  applyLocal([{ eid: 'x', name: 'task', comp: { status: 'wip' } }])
  assertEquals(cache.value.x.task!.status, 'wip')
  // then the live frame (newer) — same column, and it wins because it lands
  // after the catch-up the server already sent
  applyLocal([{ eid: 'x', name: 'task', comp: { status: 'done' } }])
  assertEquals(cache.value.x.task!.status, 'done')
})

// boardAll: the board's List face — the query over the WHOLE graph.
// Kind-agnostic matching, chrome and comments and the board itself out.
Deno.test('boardAll: whole-graph match, chrome/comments/self excluded', async () => {
  let { boardAll } = await import('./live.ts')
  let spine = (eid: string, num: number) => ({ eid, num, created_at: '' })
  cache.value = {
    board: {
      entity: spine('board', 1),
      doc: { eid: 'board', title: 'Front page', body: '' },
      board: { eid: 'board', query: '.order=hot' },
    },
    task: {
      entity: spine('task', 2),
      doc: { eid: 'task', title: 'a task', body: '' },
      task: { eid: 'task', status: 'open', priority: 1 },
    },
    sesh: {
      entity: spine('sesh', 3),
      doc: { eid: 'sesh', title: 'a brief', body: '' },
      session: { eid: 'sesh', id: 's' },
    },
    mem: {
      entity: spine('mem', 4),
      doc: { eid: 'mem', title: 'a fact', body: '' },
      memory: { eid: 'mem', type: 'project' },
    },
    cam: {
      entity: spine('cam', 5),
      camera: {
        eid: 'cam',
        client_eid: 'x',
        canvas_eid: 'y',
        x: 0,
        y: 0,
        zoom: 1,
        w: 0,
        h: 0,
      },
    },
    note: {
      entity: spine('note', 6),
      doc: { eid: 'note', title: 'aimed words', body: '' },
      comment: { eid: 'note', target_eid: 'task' },
    },
  }
  deps.value = []
  let board = ent('board')
  assertEquals(
    boardAll(board).map((e) => e.eid).toSorted(),
    ['mem', 'sesh', 'task'], // every kind rides; chrome, comment, self do not
  )
  // preds still screen: a task-shaped query matches only tasks
  cache.value.board.board!.query = '.status=open'
  assertEquals(boardAll(ent('board')).map((e) => e.eid), ['task'])
})

// pinned: a pin comp cast from another client carries no eid — the cache
// key is the identity, and a Pinned without one aims every raise/drag
// write at eid undefined (T-7437).
Deno.test('pinned: the cache key is the eid, a cast comp carries none', () => {
  cache.value = {
    c1: {
      entity: { eid: 'c1', num: 1 },
      card: { eid: 'c1', target_eid: 'w1', view: 'Web' },
      // exactly what /ws delivers for an MCP card_open: no eid inside
      pin: { canvas_eid: 'cv', x: 0, y: 0, w: 0, h: 0, z: 1 },
    } as unknown as (typeof cache)['value'][string],
  }
  assertEquals(pinned('cv').map((p) => p.eid), ['c1'])
})

// topZ: a nullish canvas must match nothing — the old `?.` filter let
// every PINLESS row through (undefined == null) and crashed on .z.
Deno.test('topZ: pinless rows never ride, whatever the canvas', () => {
  cache.value = {
    t1: {
      entity: { eid: 't1', num: 1 },
      task: { eid: 't1', status: 'open', priority: 1, domain: null },
    },
    c1: {
      entity: { eid: 'c1', num: 2 },
      card: { eid: 'c1', target_eid: 't1', view: 'Full' },
      pin: { eid: 'c1', canvas_eid: 'cv', x: 0, y: 0, w: 0, h: 0, z: 3 },
    },
  }
  assertEquals(topZ('cv'), 3)
  assertEquals(topZ(undefined as unknown as string), 0)
})

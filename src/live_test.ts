// The cache derivations: what the field pickers read out of the live
// world. Pure functions of the cache signal — no DOM, no socket.
import {
  agreementProbe,
  applyLocal,
  assertAgree,
  backlinks,
  boardPost,
  boardTasks,
  byWarmth,
  cache,
  census,
  commentCount,
  config,
  deps,
  domains,
  ent,
  gated,
  landSub,
  pinned,
  projects,
  relations,
  row,
  subEids,
  subscriptionChecks,
  topZ,
} from './live.ts'
import { type Ent } from './types.ts'
import { effect } from '@preact/signals'
import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from '@std/assert'

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

Deno.test('agreement diagnostics are inert until explicitly enabled', () => {
  config.agreement = false
  cache.value = {
    board: {
      entity: { eid: 'board', num: 1 },
      board: { eid: 'board', query: '.status=open' },
    },
    task: {
      entity: { eid: 'task', num: 2 },
      task: { eid: 'task', status: 'open', priority: 1 },
    },
  }
  let scheduled = 0
  let timer = globalThis.setTimeout
  globalThis.setTimeout = ((..._args: Parameters<typeof setTimeout>) => {
    scheduled++
    return 0
  }) as typeof setTimeout
  try {
    assertEquals(boardTasks(ent('board')).map((e) => e.eid), ['task'])
    assertAgree('board:board', '.status=open', ['task'], [])
  } finally {
    globalThis.setTimeout = timer
  }
  assertEquals(scheduled, 0)
  assertEquals(subscriptionChecks(), undefined)
  assertEquals(
    (globalThis as { __subscriptions?: unknown }).__subscriptions,
    undefined,
  )
})

Deno.test('agreement diagnostics opt in through the named browser probe', () => {
  assertEquals(agreementProbe('?probe=subscriptions'), true)
  assertEquals(agreementProbe('?v=Board&probe=subscriptions'), true)
  assertEquals(agreementProbe('?probe=other'), false)
  assertEquals(agreementProbe(''), false)
})

Deno.test('a replacement frame forgets the prior query set', () => {
  let change = (eid: string) => [
    { eid, name: 'entity', comp: { eid, num: 1 } },
  ]
  landSub({
    sub: 'board:replace',
    changes: change('old'),
    replace: true,
    shadow: true,
  })
  landSub({
    sub: 'board:replace',
    changes: change('new'),
    replace: true,
    shadow: true,
  })
  assertEquals([...(subEids('board:replace') ?? [])], ['new'])
})

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
    comment: { eid, target_eid, event },
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

// Camera motion and card stacking have narrow live signals; publishing the
// graph cache too would recompute every entity and board mounted around them.
Deno.test('camera motion and card stacking stay off the graph signal', () => {
  cache.value = {
    board: {
      entity: { eid: 'board', num: 1 },
      board: { eid: 'board', query: '.status=open' },
    },
    task: {
      entity: { eid: 'task', num: 2 },
      task: { eid: 'task', status: 'open', priority: 1 },
    },
    cam: {
      entity: { eid: 'cam', num: 3 },
      camera: {
        eid: 'cam',
        client_eid: 'client',
        canvas_eid: 'canvas',
        x: 0,
        y: 0,
        zoom: 1,
        w: 800,
        h: 600,
      },
    },
    card: {
      entity: { eid: 'card', num: 4 },
      card: { eid: 'card', target_eid: 'task', view: 'Full' },
      pin: {
        eid: 'card',
        canvas_eid: 'canvas',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        z: 1,
      },
    },
  }
  deps.value = []
  let runs = { ent: 0, pin: 0, board: 0, pins: 0 }
  let stops = [
    effect(() => {
      ent('task')
      runs.ent++
    }),
    effect(() => {
      ent('card')
      runs.pin++
    }),
    effect(() => {
      boardTasks(ent('board'))
      runs.board++
    }),
    effect(() => {
      pinned('canvas')
      runs.pins++
    }),
  ]
  try {
    applyLocal([{ eid: 'cam', name: 'camera', comp: { x: 10 } }])
    assertEquals(runs, { ent: 1, pin: 1, board: 1, pins: 1 })
    assertEquals(cache.value.cam.camera!.x, 10)
    applyLocal([
      { eid: 'cam', name: 'camera', comp: { x: 10 } },
      { eid: 'cam', name: 'updated', comp: { at: 'now' } },
    ])
    assertEquals(runs, { ent: 1, pin: 1, board: 1, pins: 1 })
    assertEquals(cache.value.cam.updated!.at, 'now')

    applyLocal([{ eid: 'card', name: 'pin', comp: { z: 2 } }])
    assertEquals(runs, { ent: 1, pin: 2, board: 1, pins: 1 })
    assertEquals(cache.value.card.pin!.z, 2)
    applyLocal([
      { eid: 'card', name: 'pin', comp: { z: 3 } },
      { eid: 'card', name: 'updated', comp: { at: 'later' } },
    ])
    assertEquals(runs, { ent: 1, pin: 3, board: 1, pins: 1 })
    assertEquals(cache.value.card.updated!.at, 'later')

    applyLocal([{ eid: 'task', name: 'task', comp: { priority: 2 } }])
    assertEquals(runs, { ent: 2, pin: 4, board: 2, pins: 2 })

    applyLocal([{ eid: 'card', name: 'pin', comp: { x: 10 } }])
    assertEquals(runs, { ent: 3, pin: 5, board: 3, pins: 3 })
  } finally {
    for (let stop of stops) stop()
  }
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

Deno.test('applyLocal: an idempotent replay preserves cache identity', () => {
  cache.value = {
    a: {
      entity: { eid: 'a', num: 1 },
      task: { eid: 'a', status: 'open', priority: 1 },
    },
  }
  let before = cache.value
  let touched = applyLocal([
    { eid: 'a', name: 'task', comp: { status: 'open' } },
  ])
  assertStrictEquals(cache.value, before)
  assertEquals(touched.eids, ['a'])
})

Deno.test('applyLocal: narrow signals wake only touched graph slices', () => {
  let spine = (eid: string, num: number) => ({
    entity: { eid, num },
    doc: { eid, title: eid, body: '' },
  })
  cache.value = {
    narrow_a: spine('narrow_a', 1),
    narrow_b: spine('narrow_b', 2),
  }
  deps.value = []
  let runs = { a: 0, b: 0, pa: 0, pb: 0 }
  let stops = [
    effect(() => {
      row('narrow_a').value
      runs.a++
    }),
    effect(() => {
      row('narrow_b').value
      runs.b++
    }),
    effect(() => {
      relations('narrow_a').value
      runs.pa++
    }),
    effect(() => {
      relations('narrow_b').value
      runs.pb++
    }),
  ]
  try {
    applyLocal([{
      eid: 'narrow_a',
      name: 'doc',
      comp: { title: 'changed' },
    }])
    assertEquals(runs, { a: 2, b: 1, pa: 1, pb: 1 })

    applyLocal([{
      eid: 'narrow_a',
      name: 'dependency',
      comp: { type: 'reads', child_eid: 'narrow_b' },
    }])
    assertEquals(runs, { a: 2, b: 1, pa: 2, pb: 1 })

    applyLocal([{
      eid: 'narrow_b',
      name: 'entity',
      comp: null,
    }])
    assertEquals(runs, { a: 2, b: 2, pa: 3, pb: 1 })
    assertEquals(row('narrow_b').value, undefined)
    assertEquals(relations('narrow_a').value, [])
  } finally {
    for (let stop of stops) stop()
  }
})

Deno.test('narrow signals follow births, subscription eviction, and census', () => {
  cache.value = {
    narrow_keep: {
      entity: { eid: 'narrow_keep', num: 1 },
      doc: { eid: 'narrow_keep', title: 'keep', body: '' },
    },
  }
  deps.value = []
  applyLocal([{
    eid: 'narrow_drop',
    name: 'entity',
    comp: { eid: 'narrow_drop', num: 2 },
  }])
  assertEquals(census.value.toSorted(), ['narrow_drop', 'narrow_keep'])

  let live = row('narrow_drop')
  landSub({
    sub: 'narrow-signals',
    replace: true,
    changes: [{
      eid: 'narrow_drop',
      name: 'doc',
      comp: { title: 'drop' },
    }],
  })
  landSub({ sub: 'narrow-signals', changes: [], drop: ['narrow_drop'] })
  assertEquals(live.value, undefined)
  assertEquals(census.value, ['narrow_keep'])
})

Deno.test('applyLocal: a camera birth still publishes the cache', () => {
  cache.value = {}
  let before = cache.value
  applyLocal([{
    eid: 'cam',
    name: 'camera',
    comp: { client_eid: 'client', canvas_eid: 'canvas' },
  }])
  assertNotStrictEquals(cache.value, before)
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
    card: {
      entity: spine('card', 7),
      card: { eid: 'card', target_eid: 'task', view: 'Full' },
    },
    fold: {
      entity: spine('fold', 8),
      fold: {
        eid: 'fold',
        client_eid: 'client',
        board_eid: 'board',
        statuses: 'done',
      },
    },
    shelf: {
      entity: spine('shelf', 9),
      canvas: { eid: 'shelf' },
      shelf: { eid: 'shelf', client_eid: 'client' },
    },
    client: {
      entity: spine('client', 10),
      client: { eid: 'client', user_agent: 'probe', ip: '' },
    },
  }
  deps.value = []
  let board = ent('board')
  assertEquals(
    boardAll(board).map((e) => e.eid).toSorted(),
    ['mem', 'sesh', 'task'], // every kind rides; chrome, comment, self do not
  )
  assertEquals(
    boardPost(board, false, Object.keys(cache.value)).toSorted(),
    ['mem', 'sesh', 'task'],
  )
  assertEquals(boardPost(board, true, Object.keys(cache.value)), ['task'])
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

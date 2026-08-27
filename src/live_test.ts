// The cache derivations: what the field pickers read out of the live
// world. Pure functions of the cache signal — no DOM, no socket.
import {
  agreementProbe,
  applyLocal,
  assertAgree,
  backlinks,
  boardAll,
  boardPost,
  boardsOver,
  boardSub,
  boardTasks,
  byWarmth,
  cache,
  census,
  clearResolved,
  commentCount,
  commentsOn,
  config,
  deps,
  domains,
  dropQuery,
  edgeSub,
  ent,
  findEid,
  foldFor,
  gated,
  holdQuery,
  inbox,
  isPing,
  jobOf,
  landObservation,
  landSub,
  loaded,
  myCamera,
  myCursor,
  myMode,
  observation,
  openDeps,
  parents,
  pinned,
  predsToQuery,
  projects,
  references,
  relations,
  repoUrl,
  resetSignals,
  resolveGen,
  resolvingId,
  resultComponent,
  resultSub,
  row,
  serverEid,
  serverName,
  sessionRows,
  setInbox,
  shelfFor,
  sieve,
  socketStale,
  subEids,
  subscriptionChecks,
  topZ,
  unreadFor,
  unsubscribe,
  useRoute,
} from './live.ts'
import { EXISTS, parseQuery, PROJECT, resolveRefs } from './query.ts'
import { type Ent } from './types.ts'
import { effect } from '@preact/signals'
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from '@std/assert'
import { until } from './testing.ts'

Deno.test('findEid indexes human ids, aliases, and short handles', () => {
  cache.value = {
    'abcdef10-0000-4000-8000-000000000001': {
      entity: {
        eid: 'abcdef10-0000-4000-8000-000000000001',
        num: 31,
      },
      alias: {
        eid: 'abcdef10-0000-4000-8000-000000000001',
        slug: 'indexed',
        slugs: 'extra more',
      },
    },
  }
  assertEquals(findEid('T-31'), 'abcdef10-0000-4000-8000-000000000001')
  assertEquals(findEid('31'), 'abcdef10-0000-4000-8000-000000000001')
  assertEquals(findEid('indexed'), 'abcdef10-0000-4000-8000-000000000001')
  // Every additional slug resolves to the same entity, not just the primary.
  assertEquals(findEid('extra'), 'abcdef10-0000-4000-8000-000000000001')
  assertEquals(findEid('more'), 'abcdef10-0000-4000-8000-000000000001')
  assertEquals(findEid('abcdef'), 'abcdef10-0000-4000-8000-000000000001')

  // An incremental patch that grows the set indexes the new member live.
  applyLocal([{
    eid: 'abcdef10-0000-4000-8000-000000000001',
    name: 'alias',
    comp: { slug: 'indexed', slugs: 'extra more fresh' },
  }])
  assertEquals(findEid('fresh'), 'abcdef10-0000-4000-8000-000000000001')

  applyLocal([{
    eid: 'abcdef10-0000-4000-8000-000000000002',
    name: 'entity',
    comp: { eid: 'abcdef10-0000-4000-8000-000000000002', num: 32 },
  }])
  assertEquals(findEid('abcdef'), undefined)

  applyLocal([{
    eid: 'abcdef10-0000-4000-8000-000000000002',
    name: 'entity',
    comp: null,
  }, {
    eid: 'abcdef10-0000-4000-8000-000000000001',
    name: 'alias',
    comp: { slug: 'renamed' },
  }])
  assertEquals(findEid('abcdef'), 'abcdef10-0000-4000-8000-000000000001')
  assertEquals(findEid('indexed'), undefined)
  assertEquals(findEid('renamed'), 'abcdef10-0000-4000-8000-000000000001')
})

Deno.test('findEid does not scan or subscribe after indexing', () => {
  let scans = 0
  cache.value = new Proxy({
    indexed: {
      entity: { eid: 'indexed', num: 41 },
    },
  }, {
    ownKeys: (target) => {
      scans++
      return Reflect.ownKeys(target)
    },
  })
  assertEquals(findEid('T-41'), 'indexed')
  assertEquals(scans, 1)
  for (let i = 0; i < 100; i++) assertEquals(findEid('T-41'), 'indexed')
  assertEquals(scans, 1)

  let runs = 0
  let stop = effect(() => {
    findEid('T-41')
    runs++
  })
  try {
    applyLocal([{
      eid: 'other',
      name: 'entity',
      comp: { eid: 'other', num: 42 },
    }])
    assertEquals(runs, 1)
  } finally {
    stop()
  }
})

// The server id-resolve fallback (T-18102): a token the working-set cache
// can't name resolves through an addressed subscription, async and NAMING-ONLY. A cache hit
// never touches the wire; a miss returns "not yet" without blocking and
// settles on the answer. resolveGen wakes the reader. Each test isolates the
// module-level sidecar with clearResolved and restores the transport seam.
let stubResolve = (
  handler: (id: string, sub: string) =>
    | { eid: string; num: number; kind: string }
    | null
    | undefined
    | Promise<{ eid: string; num: number; kind: string } | null | undefined>,
) => {
  let calls: string[] = []
  let prior = useRoute((frame) => {
    let f = frame as { sub?: string; q?: string }
    if (!f.sub || !f.q?.startsWith('id=')) return
    let id = f.q.slice(3).split('&')[0]
    calls.push(id)
    Promise.resolve(handler(id, f.sub)).then((n) => {
      if (n === undefined) return
      let changes = n
        ? [
          { eid: n.eid, name: 'entity', comp: { eid: n.eid, num: n.num } },
          { eid: n.eid, name: n.kind, comp: { eid: n.eid } },
        ]
        : []
      landSub({ sub: f.sub!, changes, drop: [], replace: true })
    })
  })
  return { calls, restore: () => useRoute(prior) }
}

Deno.test('server-resolve: an unloaded id resolves through one addressed sub', async () => {
  clearResolved()
  cache.value = {}
  let eid = 'aaaaaaaa-0000-4000-8000-000000000099'
  let f = stubResolve((id) =>
    id == 'T-99' ? { eid, num: 99, kind: 'task' } : null
  )
  try {
    // A first miss KICKS the fetch and returns undefined — never blocks — and
    // the token reads as resolving, not a premature miss.
    assertEquals(serverEid('T-99'), undefined)
    assertEquals(resolvingId('T-99'), true)
    // A second read before the answer lands reuses the in-flight resolve.
    assertEquals(serverEid('T-99'), undefined)
    await until(() => serverEid('T-99') == eid)
    // Naming-only, resolvable by eid too (the reverse read a crumb uses).
    assertEquals(serverName(eid), { eid, num: 99, kind: 'task' })
    assertEquals(resolvingId('T-99'), false)
    assertEquals(f.calls, ['T-99']) // deduped: one round trip, not per read
  } finally {
    f.restore()
  }
})

Deno.test('server-resolve: a cache hit never touches the wire', () => {
  clearResolved()
  cache.value = {
    'bbbbbbbb-0000-4000-8000-000000000031': {
      entity: { eid: 'bbbbbbbb-0000-4000-8000-000000000031', num: 31 },
    },
  }
  resetSignals()
  let f = stubResolve(() => {
    throw new Error('a cache hit must not reach the server')
  })
  try {
    assertEquals(findEid('T-31'), 'bbbbbbbb-0000-4000-8000-000000000031')
    assertEquals(f.calls.length, 0)
  } finally {
    f.restore()
  }
})

Deno.test('server-resolve: a 404 is a genuine miss — Lost, and no retry storm', async () => {
  clearResolved()
  cache.value = {}
  let f = stubResolve(() => null)
  try {
    let gen = resolveGen.value
    assertEquals(serverEid('T-404'), undefined)
    await until(() => resolveGen.value > gen)
    // null (gone), not undefined (pending): the router shows Lost, not a
    // spinner. And the cached null stops any re-kick.
    assertEquals(serverName('T-404'), null)
    assertEquals(resolvingId('T-404'), false)
    for (let i = 0; i < 20; i++) serverEid('T-404')
    assertEquals(f.calls.length, 1)
  } finally {
    f.restore()
  }
})

Deno.test('server-resolve: a hanging server never stalls nav, and never storms', async () => {
  clearResolved()
  cache.value = {}
  let eid = 'cccccccc-0000-4000-8000-000000000007'
  let sub = ''
  let f = stubResolve((_id, name) => {
    sub = name
    return undefined
  })
  try {
    // The read returns immediately though the wire hangs — routing/crumbs
    // never block on a slow resolve (the risk this leaf guards).
    assertEquals(serverEid('T-7'), undefined)
    assertEquals(resolvingId('T-7'), true)
    // Repeated reads while it hangs never launch a second request.
    for (let i = 0; i < 20; i++) serverEid('T-7')
    assertEquals(f.calls.length, 1)
    // Let it finally answer — settling clears the abort timer (no leak).
    landSub({
      sub,
      replace: true,
      drop: [],
      changes: [
        { eid, name: 'entity', comp: { eid, num: 7 } },
        { eid, name: 'task', comp: { eid } },
      ],
    })
    await until(() => serverEid('T-7') == eid)
  } finally {
    f.restore()
  }
})

Deno.test('server-resolve: a reconnect reseed clears the sidecar', async () => {
  clearResolved()
  cache.value = {}
  let eid = 'dddddddd-0000-4000-8000-000000000005'
  let f = stubResolve(() => ({ eid, num: 5, kind: 'task' }))
  try {
    serverEid('T-5')
    await until(() => serverName(eid) != null)
    // A wholesale reseed (reconnect) may now hold what was resolved remotely,
    // so the sidecar is dropped and the next read re-resolves.
    resetSignals()
    assertEquals(serverName(eid), undefined) // dropped — and this re-kicks
    await until(() => serverName(eid) != null) // let the re-kick settle (no leak)
  } finally {
    f.restore()
  }
})

// The pending-wake membership, now a query over the derived deliver.to reverse
// index (no bespoke wake index). The result anchors on the index — one candidate
// read, not a whole-graph scan — and its signal wakes ONLY when this session's
// wake membership changes: an unrelated patch (another session's wake included)
// triggers zero re-render (T-17036, the whole point).
let pendingWakeQ = (session: string) =>
  resolveRefs(
    parseQuery(`.wake! .deliver.to=${session} .delivered= .error=`),
    findEid,
  )

Deno.test('queryEids resolves pending wakes off the reverse index, narrowly', () => {
  cache.value = {
    session: {
      entity: { eid: 'session', num: 1 },
      session: { eid: 'session', id: 's' },
    },
    other_session: {
      entity: { eid: 'other_session', num: 2 },
      session: { eid: 'other_session', id: 'o' },
    },
    wake: {
      entity: { eid: 'wake', num: 3 },
      wake: { eid: 'wake', at: 'soon' },
      deliver: { eid: 'wake', to: 'session' },
    },
  }
  deps.value = []
  let mine = holdQuery(pendingWakeQ('session'))
  assertEquals(mine.value, ['wake'])

  let runs = 0
  let stop = effect(() => {
    mine.value
    runs++
  })
  try {
    // A wake for a DIFFERENT session — membership unchanged, zero re-render.
    applyLocal([
      { eid: 'other_wake', name: 'wake', comp: { at: 'soon' } },
      { eid: 'other_wake', name: 'deliver', comp: { to: 'other_session' } },
    ])
    assertEquals(runs, 1)
    // An unrelated doc edit — likewise nothing.
    applyLocal([{ eid: 'other_session', name: 'doc', comp: { title: 'x' } }])
    assertEquals(runs, 1)
    // THIS wake is delivered — membership drops, the dot re-renders once.
    applyLocal([{
      eid: 'wake',
      name: 'delivered',
      comp: { at: 'now', via: 'test' },
    }])
    assertEquals(mine.value, [])
    assertEquals(runs, 2)
  } finally {
    stop()
    dropQuery(pendingWakeQ('session'))
  }
})

// The auto-derivation proof: task.assignee is an {eid} reference with NO
// hand-written index anywhere — yet it is queryable through the same reverse
// index, because refCols flows from comps. Adding an {eid} field needs no
// index code (T-17036 done-when).
Deno.test('queryEids indexes any {eid} reference with no bespoke index', () => {
  cache.value = {
    person: { entity: { eid: 'person', num: 1 }, person: { eid: 'person' } },
    t1: {
      entity: { eid: 't1', num: 2 },
      task: { eid: 't1', status: 'open', priority: 1, assignee: 'person' },
    },
    t2: {
      entity: { eid: 't2', num: 3 },
      task: { eid: 't2', status: 'open', priority: 1, assignee: 'other' },
    },
  }
  deps.value = []
  let q = resolveRefs(parseQuery('.assignee=person'), findEid)
  let held = holdQuery(q)
  try {
    assertEquals(held.value, ['t1'])
    // Reassigning t2 to person joins it — the reverse index maintains live.
    applyLocal([{ eid: 't2', name: 'task', comp: { assignee: 'person' } }])
    assertEquals(held.value.toSorted(), ['t1', 't2'])
    // Reassigning t1 away drops it.
    applyLocal([{ eid: 't1', name: 'task', comp: { assignee: 'other' } }])
    assertEquals(held.value, ['t2'])
  } finally {
    dropQuery(q)
  }
})

Deno.test('repoUrl follows task, comment, and session ownership', () => {
  cache.value = {
    project: {
      entity: { eid: 'project', num: 1 },
      project: { eid: 'project' },
      repo: {
        eid: 'project',
        path: '/code/widget',
        url: 'https://github.com/acme/widget',
        base_branch: 'main',
      },
    },
    task: {
      entity: { eid: 'task', num: 2 },
      task: {
        eid: 'task',
        status: 'open',
        priority: 1,
        project: 'project',
      },
    },
    session: {
      entity: { eid: 'session', num: 3 },
      session: { eid: 'session', id: 'run', requested_task: 'task' },
    },
    comment: {
      entity: { eid: 'comment', num: 4 },
      comment: { eid: 'comment', target: 'session' },
    },
  }
  for (let eid of ['project', 'task', 'session', 'comment']) {
    assertEquals(repoUrl(ent(eid)), 'https://github.com/acme/widget')
  }
})

Deno.test('repoUrl follows a session actor when its task is not loaded', () => {
  cache.value = {
    project: {
      entity: { eid: 'project', num: 1 },
      project: { eid: 'project' },
      repo: {
        eid: 'project',
        path: '/tmp/widget',
        url: 'https://github.com/acme/widget',
        base_branch: 'main',
      },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: {
        eid: 'session',
        id: 'run',
        requested_task: 'missing',
        actor: 'project',
      },
    },
  }
  assertEquals(repoUrl(ent('session')), 'https://github.com/acme/widget')
})

// A transcript entry speaks for its session's project, so a commit hash in
// its body links (T-19155): the entry itself carries no project column, only
// entry.session.
Deno.test('repoUrl follows an entry through its session', () => {
  cache.value = {
    project: {
      entity: { eid: 'project', num: 1 },
      project: { eid: 'project' },
      repo: {
        eid: 'project',
        path: '/tmp/widget',
        url: 'https://github.com/acme/widget',
        base_branch: 'main',
      },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: { eid: 'session', id: 'run', requested_task: 'task' },
    },
    task: {
      entity: { eid: 'task', num: 3 },
      task: { eid: 'task', status: 'open', priority: 1, project: 'project' },
    },
    entry: {
      entity: { eid: 'entry', num: 4 },
      entry: { eid: 'entry', session: 'session', seq: 1 },
    },
  }
  assertEquals(repoUrl(ent('entry')), 'https://github.com/acme/widget')
})

Deno.test('ent projects canonical Session facets over aliases', () => {
  cache.value = {
    session: {
      entity: { eid: 'session', num: 1 },
      session: { eid: 'session', id: 'run', cwd: '/stale', pid: 7 },
      worktree: { eid: 'session', cwd: null },
      runtime: { eid: 'session', pid: null },
    },
  }
  assertEquals(ent('session').session?.cwd, null)
  assertEquals(ent('session').session?.pid, null)
})

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
  // A direct cache assignment simulates a seed; bring the query resolver (and the
  // derived indexes) in step with it, the way seedFrom does in production — else
  // a query subscribed by an earlier test keeps its stale, foreign eids.
  resetSignals()
}

// scanFacets derives its lists from the byComp index, not four whole-cache
// scans (D-18055). Parity: every facet output must equal the old cache-scan
// logic, computed inline here as the reference — order included.
Deno.test('facets: byComp derivation matches the whole-cache scan', () => {
  cache.value = {
    // projects, nums OUT of order so the num-sort is exercised
    pB: { entity: { eid: 'pB', num: 9 }, project: { eid: 'pB' } },
    pA: { entity: { eid: 'pA', num: 2 }, project: { eid: 'pA' } },
    // tasks: duplicate + distinct domains, and one with no domain
    t1: {
      entity: { eid: 't1', num: 3 },
      task: { eid: 't1', status: 'open', priority: 1, domain: 'Ops' },
    },
    t2: {
      entity: { eid: 't2', num: 4 },
      task: { eid: 't2', status: 'open', priority: 1, domain: 'Eng' },
    },
    t3: {
      entity: { eid: 't3', num: 5 },
      task: { eid: 't3', status: 'open', priority: 1, domain: 'Ops' },
    },
    t4: {
      entity: { eid: 't4', num: 6 },
      task: { eid: 't4', status: 'open', priority: 1, domain: null },
    },
    // sessions + shelves + an unrelated doc that must touch no facet
    s1: {
      entity: { eid: 's1', num: 7 },
      session: { eid: 's1', id: 'r1', cwd: '/a', pid: 1 },
    },
    s2: {
      entity: { eid: 's2', num: 8 },
      session: { eid: 's2', id: 'r2', cwd: '/b', pid: 2 },
    },
    sh1: {
      entity: { eid: 'sh1', num: 10 },
      shelf: { eid: 'sh1', client: 'c1' },
    },
    d1: {
      entity: { eid: 'd1', num: 11 },
      doc: { eid: 'd1', title: 'x', body: '' },
    },
  }
  let g = cache.peek()
  // The OLD whole-cache-scan logic, verbatim, as the reference.
  let refDomains = [
    ...new Set(Object.values(g).flatMap((r) => r.task?.domain || [])),
  ].sort()
  let refProjects = Object.entries(g).filter(([, r]) => r.project)
    .sort(([, a], [, b]) =>
      (a.entity?.num ?? Infinity) - (b.entity?.num ?? Infinity)
    ).map(([eid]) => eid)
  let refSessions = Object.entries(g).filter(([, r]) => r.session).map((
    [eid],
  ) => eid)

  assertEquals(domains.value, refDomains)
  assertEquals(domains.value, ['Eng', 'Ops'])
  assertEquals(projects().map((e) => e.eid), refProjects)
  assertEquals(projects().map((e) => e.eid), ['pA', 'pB'])
  assertEquals(sessionRows().map(([eid]) => eid), refSessions)
  assertEquals(shelfFor('c1'), 'sh1')
  assertEquals(shelfFor('nope'), undefined)
})

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

// The render half of T-16929: once a lazy board's entries are in the cache
// (its entrySub streams them there), boardAll — the tasks=false face — matches
// and lists them. `.entry.session=X` is satisfiable only by entries, so a hit
// is proof the partition rendered; the eager path (tasks=true) still excludes
// them, since an entry has no `task` component.
Deno.test('a board naming the lazy partition lists its entries', () => {
  cache.value = {
    lazyboard: {
      entity: { eid: 'lazyboard', num: 1 },
      board: { eid: 'lazyboard', query: '.entry.session=sess' },
    },
    sess: {
      entity: { eid: 'sess', num: 2 },
      session: { eid: 'sess', id: 'abc' },
    },
    e1: {
      entity: { eid: 'e1', num: 3 },
      entry: { eid: 'e1', session: 'sess', seq: 1 },
    },
    e2: {
      entity: { eid: 'e2', num: 4 },
      entry: { eid: 'e2', session: 'sess', seq: 2 },
    },
    elsewhere: {
      entity: { eid: 'elsewhere', num: 5 },
      entry: { eid: 'elsewhere', session: 'other', seq: 1 },
    },
  }
  assertEquals(boardAll(ent('lazyboard')).map((e) => e.eid).sort(), [
    'e1',
    'e2',
  ])
  // The kanban (tasks=true) face carries no non-task entities.
  assertEquals(boardTasks(ent('lazyboard')).map((e) => e.eid), [])
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

Deno.test('transient observations yield to the durable Session partition', () => {
  assertEquals(
    landObservation({
      session: 'watched-session',
      generation: 'generation',
      kind: 'model',
      text: 'partial ',
    }),
    true,
  )
  landObservation({
    session: 'watched-session',
    generation: 'generation',
    kind: 'model',
    text: 'answer',
  })
  assertEquals(observation('watched-session')?.model, 'partial answer')
  assertEquals(
    landObservation({
      session: 7,
      generation: 'generation',
      kind: 'model',
      text: 'invalid',
    }),
    false,
  )

  landSub({
    sub: 'entries:watched-session',
    changes: [{
      eid: 'answer',
      name: 'output',
      comp: { source: 'generation' },
    }],
  })
  assertEquals(observation('watched-session'), undefined)

  landObservation({
    session: 'watched-session',
    generation: 'next',
    kind: 'reasoning',
    text: 'not replay state',
  })
  landSub({
    sub: 'entries:watched-session',
    changes: [],
    replace: true,
  })
  assertEquals(observation('watched-session'), undefined)
})

// Closing the last consumer is the only moment the cache can leak: the
// departing set is gone from `subMembers` before anyone asks what it held.
Deno.test('unsubscribing evicts only what no other subscription holds', () => {
  let ent = (eid: string) => [
    { eid, name: 'entity', comp: { eid, num: 1 } },
  ]
  cache.value = {}
  landSub({
    sub: 'left',
    replace: true,
    changes: [...ent('mine'), ...ent('both')],
  })
  landSub({
    sub: 'right',
    replace: true,
    changes: [...ent('theirs'), ...ent('both')],
  })
  assertEquals(Object.keys(cache.value).toSorted(), ['both', 'mine', 'theirs'])

  unsubscribe('left')
  // `mine` was held by nobody else and goes; `both` is still the right
  // subscription's, and evicting it would blank a board still on screen.
  assertEquals(Object.keys(cache.value).toSorted(), ['both', 'theirs'])
  assertEquals(subEids('left'), undefined)

  unsubscribe('right')
  assertEquals(Object.keys(cache.value), [])
})

// The client half of the EDGES rider (T-22371). Edges are held exactly the way
// rows are — refcounted across the subs that named them, released with the last
// one — because before this the client's whole edge table WAS `allDeps`: every
// edge in the graph, shipped at boot, held by nobody, evictable never.
Deno.test('edges are refcounted per sub and leave with the last holder', () => {
  let row = (eid: string) => [
    { eid, name: 'entity', comp: { eid, num: 1 } },
  ]
  let edge = (parent: string, child: string) => ({
    parent,
    type: 'requires' as const,
    child,
  })
  cache.value = {}
  deps.value = []
  resetSignals()

  // Two cards, both about the same blocker: one edge each, plus one they share.
  landSub({
    sub: 'left',
    replace: true,
    changes: row('a'),
    edges: [edge('a', 'shared'), edge('a', 'mine')],
  })
  landSub({
    sub: 'right',
    replace: true,
    changes: row('b'),
    edges: [edge('a', 'shared'), edge('b', 'theirs')],
  })
  assertEquals(deps.value.length, 3, 'the union, not the sum')
  // relations() reads the derived index, so the delivery has to reach it.
  assertEquals(
    relations('a').value.map((d) => d.child).toSorted(),
    ['mine', 'shared'],
  )

  // An unlink delta drops only what this sub held alone.
  landSub({ sub: 'left', changes: [], unedges: [edge('a', 'mine')] })
  assertEquals(relations('a').value.map((d) => d.child), ['shared'])

  unsubscribe('left')
  assertEquals(
    deps.value.map((d) => d.child).toSorted(),
    ['shared', 'theirs'],
    'the shared edge survives its second holder',
  )
  unsubscribe('right')
  assertEquals(deps.value, [])
  assertEquals(relations('a').value, [])
})

// A peer is in the cache because an EDGE points at it, not because a query
// selected it — so it is held, and evicted, by peership rather than membership.
Deno.test('rider peers are held apart from members, and evicted with them', () => {
  cache.value = {}
  deps.value = []
  resetSignals()
  landSub({
    sub: 'card',
    replace: true,
    changes: [{ eid: 'a', name: 'entity', comp: { eid: 'a', num: 1 } }],
    edges: [{ parent: 'a', type: 'requires', child: 'blocker' }],
    peers: [
      { eid: 'blocker', name: 'entity', comp: { eid: 'blocker', num: 2 } },
      { eid: 'blocker', name: 'task', comp: { status: 'open' } },
    ],
  })
  // The peer paints — but it is NOT a member, or a useQuery over this sub's
  // query would wrongly gain it.
  assertEquals(ent('blocker').task?.status, 'open')
  assertEquals(subEids('card')?.has('blocker'), false)
  assertEquals(subEids('card')?.has('a'), true)

  // A peer's own edit lands like any patch.
  landSub({
    sub: 'card',
    changes: [],
    peers: [{ eid: 'blocker', name: 'task', comp: { status: 'done' } }],
  })
  assertEquals(ent('blocker').task?.status, 'done')

  // Nothing points at it any more: the peer leaves the cache with its edge.
  landSub({
    sub: 'card',
    changes: [],
    unedges: [{ parent: 'a', type: 'requires', child: 'blocker' }],
    unpeers: ['blocker'],
  })
  assertEquals(Object.keys(cache.value), ['a'])

  unsubscribe('card')
  assertEquals(Object.keys(cache.value), [])
})

// A shadow subscription rides beside the complete stream, which is still the
// cache's owner — so closing one must take nothing with it.
Deno.test('closing a shadow subscription evicts nothing', () => {
  cache.value = {}
  landSub({
    sub: 'watching',
    replace: true,
    shadow: true,
    changes: [{
      eid: 'watched',
      name: 'entity',
      comp: { eid: 'watched', num: 1 },
    }],
  })
  unsubscribe('watching')
  assertEquals(Object.keys(cache.value), ['watched'])
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

// The census is an AGGREGATE, not a task stream (D-22567 §1): once the server
// answers `.distinct=task.domain` the well reads THAT, with no task in the
// cache to reduce. The local pass above is the pre-answer courtesy, not the
// source of truth.
Deno.test('domains: the server distinct wins over the working set', () => {
  fill([['T', 'Ops']])
  landSub({
    sub: 'agg:domains',
    changes: [],
    replace: true,
    agg: { Fable: 1, Eng: 1 },
  })
  assertEquals(domains.value, ['Eng', 'Fable'])
  // And a delta moves it without a task changing hands.
  landSub({ sub: 'agg:domains', changes: [], agg: { Eng: 0, Ops: 1 } })
  assertEquals(domains.value, ['Fable', 'Ops'])
})

Deno.test('projects: project rows only, oldest first, named by doc', () => {
  fill([['T', 'Ops'], ['P', 'Sol'], ['P', 'Fable']])
  assertEquals(projects().map((p) => p.doc?.title), ['Sol', 'Fable'])
})

Deno.test('commentCount: every comment aimed at a target counts', () => {
  let comment = (eid: string, target: string) => ({
    comment: { eid, target },
  })
  cache.value = {
    one: comment('one', 'talk'),
    two: comment('two', 'talk'),
    elsewhere: comment('elsewhere', 'other'),
  }
  assertEquals(commentCount('talk').value, 2)
  assertEquals(commentCount('other').value, 1)
  assertEquals(commentCount('silent').value, 0)
})

Deno.test('commentCount: cold targets share one graph scan', () => {
  let scans = 0
  cache.value = new Proxy({
    one: { comment: { eid: 'one', target: 'cold_one' } },
    two: { comment: { eid: 'two', target: 'cold_two' } },
  }, {
    ownKeys: (target) => {
      scans++
      return Reflect.ownKeys(target)
    },
  })
  assertEquals(commentCount('cold_one').value, 1)
  assertEquals(commentCount('cold_two').value, 1)
  assertEquals(scans, 1)
})

// commentsOn/commentCount now read the `comment.target` reverse index through the
// query door (T-18101). Parity: the set equals the comments aimed here; the thread
// wakes only when its own target gains, loses, or retargets a comment — never on a
// comment to somewhere else or an unrelated row.
Deno.test('comments: reverse-ref set, awake only for its own thread', () => {
  let note = (eid: string, num: number, target: string) => ({
    entity: { eid, num },
    comment: { eid, target },
    doc: { eid, title: '', body: eid },
  })
  cache.value = {
    talk: {
      entity: { eid: 'talk', num: 1 },
      doc: { eid: 'talk', title: 't', body: '' },
    },
    c1: note('c1', 2, 'talk'),
    other: note('other', 3, 'elsewhere'),
  }
  deps.value = []
  resetSignals()
  assertEquals(commentsOn('talk').map((c) => c.eid), ['c1'])
  assertEquals(commentCount('talk').value, 1)

  let runs = 0
  let stop = effect(() => {
    commentsOn('talk')
    runs++
  })
  try {
    // a comment aimed elsewhere leaves this thread asleep
    applyLocal([
      { eid: 'c2', name: 'entity', comp: { eid: 'c2', num: 4 } },
      { eid: 'c2', name: 'comment', comp: { target: 'elsewhere' } },
    ])
    assertEquals(runs, 1)

    // a comment aimed HERE wakes it and joins the set (num-ordered)
    applyLocal([
      { eid: 'c3', name: 'entity', comp: { eid: 'c3', num: 5 } },
      { eid: 'c3', name: 'comment', comp: { target: 'talk' } },
    ])
    assertEquals(runs, 2)
    assertEquals(commentsOn('talk').map((c) => c.eid), ['c1', 'c3'])

    // retargeting c1 away wakes it and drops it — correct through the patch
    applyLocal([{ eid: 'c1', name: 'comment', comp: { target: 'gone' } }])
    assertEquals(runs, 3)
    assertEquals(commentsOn('talk').map((c) => c.eid), ['c3'])
  } finally {
    stop()
  }
})

// boardsOver reads a CONTAINS over `board.query` through the query door (T-18101):
// a board query carries refs as text, so this names every board mentioning the
// target and wakes only when a board's query gains or loses its eid.
Deno.test('boardsOver: awake only when a board names or drops the target', () => {
  cache.value = {
    b1: {
      entity: { eid: 'b1', num: 1 },
      board: { eid: 'b1', query: '.project=P-9' },
    },
    b2: {
      entity: { eid: 'b2', num: 2 },
      board: { eid: 'b2', query: '.status=open' },
    },
    plain: {
      entity: { eid: 'plain', num: 3 },
      doc: { eid: 'plain', title: 'x', body: '' },
    },
  }
  deps.value = []
  resetSignals()
  assertEquals(boardsOver('P-9'), ['b1'])

  let runs = 0
  let stop = effect(() => {
    boardsOver('P-9')
    runs++
  })
  try {
    // an unrelated doc patch — asleep
    applyLocal([{ eid: 'plain', name: 'doc', comp: { title: 'y' } }])
    assertEquals(runs, 1)

    // a board that still doesn't mention P-9 — asleep
    applyLocal([{ eid: 'b2', name: 'board', comp: { query: '.priority=1' } }])
    assertEquals(runs, 1)

    // a new board naming P-9 wakes it and joins the answer
    applyLocal([
      { eid: 'b3', name: 'entity', comp: { eid: 'b3', num: 4 } },
      {
        eid: 'b3',
        name: 'board',
        comp: { query: '.project=P-9&.status=open' },
      },
    ])
    assertEquals(runs, 2)
    assertEquals(boardsOver('P-9').toSorted(), ['b1', 'b3'])

    // b1 drops P-9 — wakes, leaves the answer
    applyLocal([{ eid: 'b1', name: 'board', comp: { query: '.status=wip' } }])
    assertEquals(runs, 3)
    assertEquals(boardsOver('P-9'), ['b3'])
  } finally {
    stop()
  }
})

// foldFor owns MEMBERSHIP through the query door (the unique client+board fold)
// and reads its live `statuses` off that fold's own row signal (T-18099). So a
// collapse/expand of MY fold wakes it, its birth/death wakes it, and another
// client's fold or an unrelated row leaves it asleep.
Deno.test('foldFor: query membership, live statuses off the row', () => {
  cache.value = {
    f1: {
      entity: { eid: 'f1', num: 1 },
      fold: { eid: 'f1', client: 'me', board: 'B-1', statuses: 'done' },
    },
    fOther: {
      entity: { eid: 'fOther', num: 2 },
      fold: { eid: 'fOther', client: 'you', board: 'B-1', statuses: 'wip' },
    },
    plain: {
      entity: { eid: 'plain', num: 3 },
      doc: { eid: 'plain', title: 'x', body: '' },
    },
  }
  deps.value = []
  resetSignals()
  assertEquals(foldFor('me', 'B-1'), { eid: 'f1', statuses: 'done' })
  assertEquals(foldFor('nobody', 'B-1'), undefined)

  let runs = 0
  let stop = effect(() => {
    foldFor('me', 'B-1')
    runs++
  })
  try {
    // another client's fold on the same board — asleep
    applyLocal([{ eid: 'fOther', name: 'fold', comp: { statuses: 'open' } }])
    assertEquals(runs, 1)

    // an unrelated doc — asleep
    applyLocal([{ eid: 'plain', name: 'doc', comp: { title: 'y' } }])
    assertEquals(runs, 1)

    // MY fold's statuses edit wakes it (off the row signal), new value shows
    applyLocal([{ eid: 'f1', name: 'fold', comp: { statuses: 'done,wip' } }])
    assertEquals(runs, 2)
    assertEquals(foldFor('me', 'B-1')?.statuses, 'done,wip')

    // MY fold dies — membership wakes, the answer clears
    applyLocal([{ eid: 'f1', name: 'entity', comp: null }])
    assertEquals(runs, 3)
    assertEquals(foldFor('me', 'B-1'), undefined)
  } finally {
    stop()
  }
})

// The presence/reference facets (projects/sessionRows/shelfFor) ride the query
// door now (T-18099), so each wakes only when ITS membership changes — a project
// born, a session born, a shelf claimed — never on a sibling facet or an
// unrelated row.
Deno.test('facet reads wake only their own membership', () => {
  cache.value = {
    proj: {
      entity: { eid: 'proj', num: 1 },
      project: { eid: 'proj' },
    },
    sess: {
      entity: { eid: 'sess', num: 2 },
      session: { eid: 'sess', id: 'sess' },
    },
    plain: {
      entity: { eid: 'plain', num: 3 },
      doc: { eid: 'plain', title: 'plain', body: '' },
    },
  }
  deps.value = []
  resetSignals()
  let runs = { projects: 0, sessions: 0, shelf: 0 }
  let stops = [
    effect(() => {
      projects()
      runs.projects++
    }),
    effect(() => {
      sessionRows()
      runs.sessions++
    }),
    effect(() => {
      shelfFor('client')
      runs.shelf++
    }),
  ]
  try {
    // an unrelated doc edit touches no facet — all stay asleep
    applyLocal([{ eid: 'plain', name: 'doc', comp: { title: 'changed' } }])
    assertEquals(runs, { projects: 1, sessions: 1, shelf: 1 })

    // a project born wakes only the project census
    applyLocal([{ eid: 'proj2', name: 'project', comp: {} }])
    assertEquals(runs, { projects: 2, sessions: 1, shelf: 1 })

    // a session born wakes only the session census
    applyLocal([{ eid: 'sess2', name: 'session', comp: { id: 'sess2' } }])
    assertEquals(runs, { projects: 2, sessions: 2, shelf: 1 })

    // the client's shelf appears — only shelfFor wakes
    applyLocal([{ eid: 'sh', name: 'shelf', comp: { client: 'client' } }])
    assertEquals(runs, { projects: 2, sessions: 2, shelf: 2 })
    assertEquals(shelfFor('client'), 'sh')
  } finally {
    for (let stop of stops) stop()
  }
})

// backlinks now read `.refs=target` — the multi-column reverse-union — through
// the query door (T-18101): every entity referencing this eid across ALL {eid}
// columns of the SCHEMA, whoever may write the column (a session's stamped
// requested_task counts). Parity: the set equals who points here, each with its
// via label; the face wakes only when a referrer starts or stops pointing here —
// never on an unrelated row — and stays correct through a retarget.
Deno.test('backlinks: reverse-union set + via, awake only for its own target', () => {
  cache.value = {
    t1: {
      entity: { eid: 't1', num: 1 },
      task: { eid: 't1', status: 'open', priority: 1, domain: null },
    },
    s1: {
      entity: { eid: 's1', num: 2 },
      session: { eid: 's1', id: 'x', requested_task: 't1' },
    },
    c1: {
      entity: { eid: 'c1', num: 3 },
      claim: { eid: 'c1', session: 's1' },
    },
    other: {
      entity: { eid: 'other', num: 4 },
      doc: { eid: 'other', title: 'o', body: '' },
    },
  }
  deps.value = []
  resetSignals()
  // a server-stamped association (session.requested_task) counts like any other
  assertEquals(backlinks('t1'), [{ from: 's1', via: 'session.requested_task' }])
  assertEquals(backlinks('s1'), [{ from: 'c1', via: 'claim.session' }])

  let byFrom = <T extends { from: string }>(b: T[]) =>
    b.toSorted((a, z) => (a.from < z.from ? -1 : 1))
  let runs = 0
  let stop = effect(() => {
    backlinks('t1')
    runs++
  })
  try {
    // an unrelated doc edit leaves the target's backlinks asleep
    applyLocal([{ eid: 'other', name: 'doc', comp: { title: 'changed' } }])
    assertEquals(runs, 1)

    // a new referrer through ANY {eid} column wakes it and joins the union
    applyLocal([
      { eid: 'c2', name: 'entity', comp: { eid: 'c2', num: 5 } },
      { eid: 'c2', name: 'comment', comp: { target: 't1' } },
    ])
    assertEquals(runs, 2)
    assertEquals(byFrom(backlinks('t1')), [
      { from: 'c2', via: 'comment.target' },
      { from: 's1', via: 'session.requested_task' },
    ])

    // retargeting the session away wakes it and drops it — correct through the patch
    applyLocal([{ eid: 's1', name: 'session', comp: { requested_task: null } }])
    assertEquals(runs, 3)
    assertEquals(backlinks('t1'), [{ from: 'c2', via: 'comment.target' }])
  } finally {
    stop()
  }
})

// jobOf reads the claim.session reverse index rather than scanning the cache;
// the answer is the newest claim-bearing task the session holds — unchanged.
Deno.test('jobOf: newest claimed task, off the reverse index', () => {
  cache.value = {
    s1: { entity: { eid: 's1', num: 1 }, session: { eid: 's1', id: 'x' } },
    // two claims by s1; the newer claimed_at wins regardless of cache order
    t_old: {
      entity: { eid: 't_old', num: 2 },
      task: { eid: 't_old', status: 'open', priority: 1 },
      claim: { eid: 't_old', session: 's1', claimed_at: '2026-01-01' },
    },
    t_new: {
      entity: { eid: 't_new', num: 3 },
      task: { eid: 't_new', status: 'open', priority: 1 },
      claim: { eid: 't_new', session: 's1', claimed_at: '2026-08-01' },
    },
    // a claim by s1 on a non-task entity is skipped (the `r.task` screen)
    d1: {
      entity: { eid: 'd1', num: 4 },
      doc: { eid: 'd1', title: 'note', body: '' },
      claim: { eid: 'd1', session: 's1', claimed_at: '2026-12-01' },
    },
    // a claim by another session must not leak in
    s2: { entity: { eid: 's2', num: 5 }, session: { eid: 's2', id: 'y' } },
    t_other: {
      entity: { eid: 't_other', num: 6 },
      task: { eid: 't_other', status: 'open', priority: 1 },
      claim: { eid: 't_other', session: 's2', claimed_at: '2026-12-31' },
    },
  }
  assertEquals(jobOf({ eid: 's1' } as Ent), 't_new')
  assertEquals(jobOf({ eid: 's2' } as Ent), 't_other')
})

// myMode reads the subscription.target reverse index; the unique (actor,
// target) row is found, foreign actors are screened, quarantined rows skipped.
Deno.test("myMode: this actor's subscription, off the reverse index", () => {
  config.client = 'me_client'
  cache.value = {
    me_client: {
      entity: { eid: 'me_client', num: 1 },
      client: { eid: 'me_client', user_agent: 'probe', ip: '', actor: 'me' },
    },
    tgt: {
      entity: { eid: 'tgt', num: 2 },
      task: { eid: 'tgt', status: 'open', priority: 1 },
    },
    // my subscription on tgt
    sub_mine: {
      entity: { eid: 'sub_mine', num: 3 },
      subscription: {
        eid: 'sub_mine',
        actor: 'me',
        target: 'tgt',
        mode: 'mute',
      },
    },
    // another actor's subscription on the same target — must not match
    sub_other: {
      entity: { eid: 'sub_other', num: 4 },
      subscription: {
        eid: 'sub_other',
        actor: 'you',
        target: 'tgt',
        mode: 'watch',
      },
    },
  }
  assertEquals(myMode('tgt'), 'mute')
  assertEquals(myMode('absent'), undefined)
  // a quarantined subscription is invisible, exactly as rows() had it
  cache.value = {
    ...cache.value,
    sub_mine: { ...cache.value.sub_mine, quarantined: { eid: 'sub_mine' } },
  }
  assertEquals(myMode('tgt'), undefined)
  config.client = undefined
})

// The inbox signal is only a test/host seam now. Production membership comes
// from useInbox's ordinary query subscriptions, never an HTTP side door.
Deno.test('inbox: planted rows retain the shared unread derivation', () => {
  let item = (eid: string, opened = false) => ({
    eid,
    num: 1,
    kind: 'comment',
    comps: {
      comment: { target: 'actor' },
      ...(opened ? { opened: {} } : {}),
    },
  })
  setInbox('actor', [item('c1'), item('c2', true)])
  assertEquals(inbox('actor').map((r) => r.eid), ['c1', 'c2'])
  assertEquals(unreadFor('actor'), 1)
  setInbox('actor', [])
})

Deno.test('relationship indices wake only their affected targets', () => {
  cache.value = {
    index_target: {
      entity: { eid: 'index_target', num: 1 },
      task: { eid: 'index_target', status: 'open', priority: 1 },
    },
    index_other: {
      entity: { eid: 'index_other', num: 2 },
      doc: { eid: 'index_other', title: 'other', body: '' },
    },
    index_session: {
      entity: { eid: 'index_session', num: 3 },
      session: { eid: 'index_session', id: 'session' },
    },
  }
  deps.value = []
  let runs = { comments: 0, links: 0, parents: 0, job: 0, boards: 0 }
  let stops = [
    effect(() => {
      commentsOn('index_target')
      commentCount('index_target').value
      runs.comments++
    }),
    effect(() => {
      backlinks('index_target')
      runs.links++
    }),
    effect(() => {
      parents('index_target')
      runs.parents++
    }),
    effect(() => {
      jobOf(ent('index_session'))
      runs.job++
    }),
    effect(() => {
      boardsOver('index_target')
      runs.boards++
    }),
  ]
  try {
    applyLocal([{
      eid: 'index_other',
      name: 'doc',
      comp: { title: 'changed' },
    }])
    assertEquals(runs, {
      comments: 1,
      links: 1,
      parents: 1,
      job: 1,
      boards: 1,
    })

    applyLocal([
      {
        eid: 'index_comment',
        name: 'comment',
        comp: { target: 'index_target' },
      },
      {
        eid: 'index_other',
        name: 'task',
        comp: { assignee: 'index_target' },
      },
      {
        eid: 'index_parent',
        name: 'dependency',
        comp: { type: 'reads', child: 'index_target' },
      },
      {
        eid: 'index_target',
        name: 'claim',
        comp: { session: 'index_session' },
      },
      {
        eid: 'index_board',
        name: 'board',
        comp: { query: '.project=index_target' },
      },
    ])
    assertEquals(runs, {
      comments: 2,
      links: 2,
      parents: 2,
      job: 2,
      boards: 2,
    })
  } finally {
    for (let stop of stops) stop()
  }
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

// The alarm is decoupled from deps (D-17094): gated() burns red ONLY on the
// `blocked` facet — an external stuck. Open `requires` edges are normal work,
// so they never redden the Dot; they surface as the calm openDeps() count.
Deno.test('gated: red keys on the blocked facet, never an open requires', () => {
  let mk = (status: string, extra = {}) => ({
    entity: { eid: `x`, num: 0, created_at: '' },
    task: { eid: 'x', status, priority: 1 },
    ...extra,
  })
  // An open requires child: calm, not red — one open dep, no alarm.
  cache.value = { parent: mk('open'), blocker: mk('open') }
  deps.value = [{ parent: 'parent', type: 'requires', child: 'blocker' }]
  assertEquals(gated(ent('parent')), false)
  assertEquals(openDeps(ent('parent')), 1)

  // The blocked facet IS the alarm — independent of any edge.
  cache.value = {
    parent: mk('open', { blocked: { eid: 'parent', on: "Jeff's call" } }),
    blocker: mk('done'),
  }
  assertEquals(gated(ent('parent')), true)

  // A settled child stops counting as an open dep; still no alarm.
  cache.value = { parent: mk('open'), blocker: mk('cancelled') }
  assertEquals(gated(ent('parent')), false)
  assertEquals(openDeps(ent('parent')), 0)
})

// ent(): edges partition into refs (non-contains, {type, child}) and kids
// (contains, resolved). Open refs lead without disturbing the order inside
// either half; kids preserve their graph order.
Deno.test('ent: refs put open work before settled work', () => {
  let sp = (eid: string, status = 'open') => ({
    entity: { eid, num: 0, created_at: '' },
    task: { eid, status, priority: 1, domain: null },
  })
  cache.value = {
    p: sp('p'),
    a: sp('a', 'done'),
    b: sp('b'),
    c: sp('c'),
    d: sp('d', 'cancelled'),
    e: sp('e'),
    n: { entity: { eid: 'n', num: 0 }, doc: { eid: 'n', title: '', body: '' } },
  }
  deps.value = [
    { parent: 'p', type: 'contains', child: 'b' },
    { parent: 'p', type: 'requires', child: 'a' },
    { parent: 'p', type: 'contains', child: 'c' },
    { parent: 'p', type: 'reads', child: 'n' },
    { parent: 'p', type: 'requires', child: 'd' },
    { parent: 'p', type: 'about', child: 'e' },
    { parent: 'other', type: 'requires', child: 'a' },
  ]
  let e = ent('p')
  assertEquals(e.refs, [
    { type: 'reads', child: 'n' },
    { type: 'about', child: 'e' },
    { type: 'requires', child: 'a' },
    { type: 'requires', child: 'd' },
  ])
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
        client: 'client',
        canvas: 'canvas',
        x: 0,
        y: 0,
        zoom: 1,
        w: 800,
        h: 600,
      },
    },
    card: {
      entity: { eid: 'card', num: 4 },
      card: { eid: 'card', target: 'task', view: 'Full' },
      pin: {
        eid: 'card',
        canvas: 'canvas',
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
    assertEquals(runs, { ent: 2, pin: 3, board: 2, pins: 1 })

    applyLocal([{ eid: 'card', name: 'pin', comp: { x: 10 } }])
    assertEquals(runs, { ent: 2, pin: 4, board: 2, pins: 2 })
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
      comp: { type: 'requires', child: 'b' },
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

Deno.test('applyLocal: an idempotent entity death preserves cache identity', () => {
  cache.value = {}
  deps.value = []
  let before = cache.value
  let touched = applyLocal([{ eid: 'gone', name: 'entity', comp: null }])
  assertStrictEquals(cache.value, before)
  assertEquals(touched.eids, ['gone'])
})

Deno.test('an empty sieve does not subscribe to the graph', () => {
  cache.value = {
    a: {
      entity: { eid: 'a', num: 1 },
      doc: { eid: 'a', title: 'a', body: '' },
    },
  }
  let runs = 0
  let stop = effect(() => {
    sieve('')('a')
    runs++
  })
  try {
    applyLocal([{ eid: 'a', name: 'doc', comp: { title: 'changed' } }])
    assertEquals(runs, 1)
  } finally {
    stop()
  }
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
      comp: { type: 'reads', child: 'narrow_b' },
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

Deno.test('board membership sleeps through an unrelated row patch', () => {
  cache.value = {
    board_narrow: {
      entity: { eid: 'board_narrow', num: 1 },
      board: { eid: 'board_narrow', query: '.status=open' },
    },
    task_narrow: {
      entity: { eid: 'task_narrow', num: 2 },
      task: { eid: 'task_narrow', status: 'open', priority: 1 },
    },
    doc_narrow: {
      entity: { eid: 'doc_narrow', num: 3 },
      doc: { eid: 'doc_narrow', title: 'note', body: '' },
    },
  }
  deps.value = []
  let runs = 0
  let stop = effect(() => {
    boardTasks(ent('board_narrow'))
    runs++
  })
  try {
    applyLocal([{
      eid: 'doc_narrow',
      name: 'doc',
      comp: { title: 'changed' },
    }])
    assertEquals(runs, 1)

    applyLocal([{
      eid: 'task_narrow',
      name: 'task',
      comp: { priority: 2 },
    }])
    assertEquals(runs, 2)
  } finally {
    stop()
  }
})

Deno.test('a hot board sleeps through card births and deaths', () => {
  cache.value = {
    board_hot: {
      entity: { eid: 'board_hot', num: 1 },
      board: { eid: 'board_hot', query: '.status=open&.order=hot' },
    },
    task_hot: {
      entity: { eid: 'task_hot', num: 2 },
      task: { eid: 'task_hot', status: 'open', priority: 1 },
    },
  }
  deps.value = []
  let runs = 0
  let stop = effect(() => {
    boardTasks(ent('board_hot'))
    runs++
  })
  try {
    applyLocal([
      { eid: 'card_hot', name: 'entity', comp: { eid: 'card_hot', num: 3 } },
      {
        eid: 'card_hot',
        name: 'card',
        comp: { target: 'task_hot', view: 'Full' },
      },
    ])
    assertEquals(runs, 1)

    applyLocal([{ eid: 'card_hot', name: 'entity', comp: null }])
    assertEquals(runs, 1)

    applyLocal([{ eid: 'task_hot', name: 'task', comp: { priority: 2 } }])
    assertEquals(runs, 2)
  } finally {
    stop()
  }
})

Deno.test('applyLocal: a camera birth still publishes the cache', () => {
  cache.value = {}
  let before = cache.value
  applyLocal([{
    eid: 'cam',
    name: 'camera',
    comp: { client: 'client', canvas: 'canvas' },
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
      memory: { eid: 'mem', scope: null },
    },
    cam: {
      entity: spine('cam', 5),
      camera: {
        eid: 'cam',
        client: 'x',
        canvas: 'y',
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
      comment: { eid: 'note', target: 'task' },
    },
    card: {
      entity: spine('card', 7),
      card: { eid: 'card', target: 'task', view: 'Full' },
    },
    fold: {
      entity: spine('fold', 8),
      fold: {
        eid: 'fold',
        client: 'client',
        board: 'board',
        statuses: 'done',
      },
    },
    shelf: {
      entity: spine('shelf', 9),
      canvas: { eid: 'shelf' },
      shelf: { eid: 'shelf', client: 'client' },
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
      card: { eid: 'c1', target: 'w1', view: 'Web' },
      // exactly what /ws delivers for an MCP card_open: no eid inside
      pin: { canvas: 'cv', x: 0, y: 0, w: 0, h: 0, z: 1 },
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
      card: { eid: 'c1', target: 't1', view: 'Full' },
      pin: { eid: 'c1', canvas: 'cv', x: 0, y: 0, w: 0, h: 0, z: 3 },
    },
  }
  assertEquals(topZ('cv'), 3)
  assertEquals(topZ(undefined as unknown as string), 0)
})

Deno.test('pinned sleeps through an unrelated row patch', () => {
  cache.value = {
    pin_narrow: {
      entity: { eid: 'pin_narrow', num: 1 },
      card: { eid: 'pin_narrow', target: 'target', view: 'Full' },
      pin: {
        eid: 'pin_narrow',
        canvas: 'canvas_narrow',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        z: 1,
      },
    },
    target: {
      entity: { eid: 'target', num: 2 },
      doc: { eid: 'target', title: 'target', body: '' },
    },
  }
  let runs = 0
  let stop = effect(() => {
    pinned('canvas_narrow')
    runs++
  })
  try {
    applyLocal([{
      eid: 'target',
      name: 'doc',
      comp: { title: 'changed' },
    }])
    assertEquals(runs, 1)

    applyLocal([{ eid: 'pin_narrow', name: 'pin', comp: { x: 10 } }])
    assertEquals(runs, 2)
  } finally {
    stop()
  }
})

// A board now renders from the server's subscription (subEids); the local query
// door is the pre-flip agreement check beside it, taken at the render that
// actually reads them. So the counter counts once a render has BOTH doors: the
// subscription's members and the query door resolved against the same cache.
// Before the first sub frame the query door answers alone and there is nothing
// to compare — the deferred counter stays null, which a probe must not mistake
// for "no divergence found".
Deno.test('the agreement counter counts when both doors answer', async () => {
  config.agreement = true
  cache.value = {
    board: {
      entity: { eid: 'board', num: 1 },
      board: { eid: 'board', query: '.status=open' },
    },
    t1: {
      entity: { eid: 't1', num: 2 },
      task: { eid: 't1', status: 'open', priority: 1 },
    },
  }
  // What a Board view does on mount: register the subscription, then render.
  let drop = boardSub(ent('board'))
  try {
    // Before the first sub frame the query door answers alone — nothing yet to
    // compare it against.
    assertEquals(boardTasks(ent('board')).map((e) => e.eid), ['t1'])
    assertEquals(subscriptionChecks(), undefined)

    // The subscription's first frame lands — a SHADOW frame carries the spine
    // alone. It has to be enough: the client is still on the complete
    // broadcast, so membership is the only thing this frame is for.
    landSub({
      sub: 'board:board',
      changes: [{ eid: 't1', name: 'entity', comp: { eid: 't1', num: 2 } }],
      replace: true,
      shadow: true,
    })
    assertEquals(subEids('board:board')?.size, 1)

    // Now a render has the sub's members AND resolves the query door beside
    // them: the two are compared.
    assertEquals(boardTasks(ent('board')).map((e) => e.eid), ['t1'])
    // Poll the off-thread agreement counter instead of guessing its latency.
    let counts = await until(() => {
      let c = subscriptionChecks()
      return c && (c.agreements ?? 0) > 0 ? c : undefined
    }, { label: 'the agreement counter to count' })
    assertEquals(counts?.divergences, 0)
    assertEquals((counts?.agreements ?? 0) > 0, true, 'the counter counted')
  } finally {
    config.agreement = false
    drop()
    unsubscribe('board:board')
  }
})

// A board IS a saved query, so the server's subscription is its membership: the
// render reads subEids, not a cache scan. The first frame paints it, and a
// maintenance frame that adds or drops an eid moves the board live — the join/
// leave the boot flip needs to keep working under a partial cache (T-18099).
Deno.test('a board renders from the subscription and tracks joins and leaves', () => {
  cache.value = {
    board: {
      entity: { eid: 'board', num: 1 },
      board: { eid: 'board', query: '.status=open' },
    },
    t1: {
      entity: { eid: 't1', num: 2 },
      task: { eid: 't1', status: 'open', priority: 1 },
    },
    t2: {
      entity: { eid: 't2', num: 3 },
      task: { eid: 't2', status: 'open', priority: 2 },
    },
  }
  deps.value = []
  let drop = boardSub(ent('board'))
  try {
    // The server's first frame IS the membership — the render reads it. (A
    // shadow frame carries the spine; bodies rode the complete broadcast.)
    landSub({
      sub: 'board:board',
      replace: true,
      shadow: true,
      changes: [{ eid: 't1', name: 'entity', comp: { eid: 't1', num: 2 } }],
    })
    assertEquals(boardTasks(ent('board')).map((e) => e.eid), ['t1'])

    // A task joins the query: a maintenance frame adds it and the board picks
    // it up live — no cache scan, no per-patch re-test.
    landSub({
      sub: 'board:board',
      shadow: true,
      changes: [{ eid: 't2', name: 'entity', comp: { eid: 't2', num: 3 } }],
    })
    assertEquals(
      boardTasks(ent('board')).map((e) => e.eid).toSorted(),
      ['t1', 't2'],
    )

    // A task leaves the query: the server drops it from THIS sub (it still
    // exists), and the board drops it too.
    landSub({ sub: 'board:board', shadow: true, changes: [], drop: ['t1'] })
    assertEquals(boardTasks(ent('board')).map((e) => e.eid), ['t2'])
  } finally {
    drop()
    unsubscribe('board:board')
  }
})

// The render source is the subscription plus each member's own row signal, never
// `cache.value` — so an unrelated ordinary patch (no sub frame, not a member)
// never wakes the board, while a member's own edit does.
Deno.test('a subscribed board sleeps through an unrelated ordinary patch', () => {
  cache.value = {
    board: {
      entity: { eid: 'board', num: 1 },
      board: { eid: 'board', query: '.status=open' },
    },
    t1: {
      entity: { eid: 't1', num: 2 },
      task: { eid: 't1', status: 'open', priority: 1 },
    },
    other: {
      entity: { eid: 'other', num: 3 },
      doc: { eid: 'other', title: 'unrelated', body: '' },
    },
  }
  deps.value = []
  let drop = boardSub(ent('board'))
  landSub({
    sub: 'board:board',
    replace: true,
    shadow: true,
    changes: [{ eid: 't1', name: 'entity', comp: { eid: 't1', num: 2 } }],
  })
  let runs = 0
  let stop = effect(() => {
    boardTasks(ent('board'))
    runs++
  })
  try {
    assertEquals(runs, 1)
    // An unrelated entity changes: not a member, no sub frame — untouched.
    applyLocal([{ eid: 'other', name: 'doc', comp: { title: 'changed' } }])
    assertEquals(runs, 1)
    // A member's own edit wakes the board (its ent rides t1's row signal).
    applyLocal([{ eid: 't1', name: 'task', comp: { priority: 5 } }])
    assertEquals(runs, 2)
  } finally {
    stop()
    drop()
    unsubscribe('board:board')
  }
})

// boardPost is the face split, wherever the members come from: the server can
// stream the board's own eid and chrome (a comment, a card) into the sub's set,
// and boardPost still keeps them out — the whole-graph face drops comment/card/
// self, the tasks face keeps only task-bearing rows.
Deno.test('boardPost excludes chrome and self from the subscription members', () => {
  cache.value = {
    board: {
      entity: { eid: 'board', num: 1 },
      doc: { eid: 'board', title: 'feed', body: '' },
      board: { eid: 'board', query: '.order=hot' },
    },
    task: {
      entity: { eid: 'task', num: 2 },
      task: { eid: 'task', status: 'open', priority: 1 },
    },
    note: {
      entity: { eid: 'note', num: 3 },
      comment: { eid: 'note', target: 'task' },
    },
    card: {
      entity: { eid: 'card', num: 4 },
      card: { eid: 'card', target: 'task', view: 'Full' },
    },
  }
  deps.value = []
  let drop = boardSub(ent('board'))
  try {
    landSub({
      sub: 'board:board',
      replace: true,
      shadow: true,
      changes: [
        { eid: 'board', name: 'entity', comp: { eid: 'board', num: 1 } },
        { eid: 'task', name: 'entity', comp: { eid: 'task', num: 2 } },
        { eid: 'note', name: 'entity', comp: { eid: 'note', num: 3 } },
        { eid: 'card', name: 'entity', comp: { eid: 'card', num: 4 } },
      ],
    })
    assertEquals(boardAll(ent('board')).map((e) => e.eid), ['task'])
    assertEquals(boardTasks(ent('board')).map((e) => e.eid), ['task'])
  } finally {
    drop()
    unsubscribe('board:board')
  }
})

// T-17126: the self-verifying preds→query serializer that decides whether a
// queryEids call can open a server subscription. It must round-trip the shapes
// queryEids actually builds (has/eq/contains/refs) and REFUSE anything else, so a
// shape the grammar can't spell exactly falls back to the local resolver instead
// of putting a divergent query on the wire.
Deno.test('predsToQuery round-trips membership shapes, refuses the rest', () => {
  let E = 'abcdef10-0000-4000-8000-000000000001'
  let F = 'abcdef10-0000-4000-8000-000000000002'
  cache.value = {
    [E]: { entity: { eid: E, num: 51 } },
    [F]: { entity: { eid: F, num: 52 } },
  }
  resetSignals()
  let eq = (comp: string, prop: string, value: string) => ({
    comp,
    prop,
    op: '',
    value,
  })
  let has = (comp: string) => ({ comp, prop: '', op: EXISTS, value: '' })
  let contains = (comp: string, prop: string, value: string) => ({
    comp,
    prop,
    op: '~',
    value,
  })
  let refsTo = (value: string) => ({
    comp: '',
    prop: '',
    op: '',
    value,
    refs: true,
  })
  assertEquals(predsToQuery([has('project')]), '.project!')
  assertEquals(
    predsToQuery([eq('comment', 'target', E)]),
    `.comment.target=${E}`,
  )
  assertEquals(
    predsToQuery([contains('board', 'query', E)]),
    `.board.query~=${E}`,
  )
  assertEquals(predsToQuery([refsTo(E)]), `.refs=${E}`)
  assertEquals(predsToQuery(parseQuery('widget')), 'widget')
  assertEquals(predsToQuery(parseQuery('wid*')), 'wid*')
  assertEquals(
    predsToQuery(parseQuery('"widget alpha" .task!')),
    '"widget alpha"&.task!',
  )
  assertEquals(
    predsToQuery([eq('fold', 'client', E), eq('fold', 'board', F)]),
    `.fold.client=${E}&.fold.board=${F}`,
  )
  // A PROJECTION rides the wire now (D-22567 §3): the eids-only form, and named
  // columns with `~` back on the volatile ones — so the server answers only
  // those columns and the sub's identity includes which.
  assertEquals(
    predsToQuery([{ comp: '', prop: '', op: PROJECT, value: '', fields: [] }]),
    '.fields=eid',
  )
  assertEquals(
    predsToQuery([
      eq('pin', 'canvas', E),
      {
        comp: '',
        prop: '',
        op: PROJECT,
        value: '',
        fields: [
          { comp: 'pin', prop: 'x', wake: true },
          { comp: 'pin', prop: 'z', wake: false },
        ],
      },
    ]),
    `.pin.canvas=${E}&.fields=pin.x,pin.z~`,
  )
  // An empty query has no line.
  assertEquals(predsToQuery([]), undefined)
})

// T-17126: with the flag on, a held membership query is backed by a SERVER
// subscription — its signal is primed from the local cache, then the server's
// frames (landSub) drive it. This walks the four transitions the flip relies on
// (replace / add / drop) and asserts the per-sub signal tracks membership, the
// same landSub path boards ride. A stub WebSocket keeps `holdQuery`'s sub-open
// from dialing a real socket; the test drives landSub directly.
Deno.test('serverQuery: a held membership query tracks its subscription', () => {
  let RealWS = (globalThis as { WebSocket: unknown }).WebSocket
  ;(globalThis as { WebSocket: unknown }).WebSocket = class {
    readyState = 0
    onopen: unknown = null
    onmessage: unknown = null
    onclose: unknown = null
    send() {}
    addEventListener() {}
    close() {}
  }
  let P1 = 'aaaa0000-0000-4000-8000-000000000001'
  let P2 = 'aaaa0000-0000-4000-8000-000000000002'
  let P3 = 'aaaa0000-0000-4000-8000-000000000003'
  let proj = (eid: string, num: number) => [
    { eid, name: 'entity', comp: { eid, num } },
    { eid, name: 'project', comp: { color: '#111' } },
  ]
  try {
    cache.value = {
      [P1]: { entity: { eid: P1, num: 1 }, project: { eid: P1 } },
    }
    let preds = resolveRefs(parseQuery('.project!'), findEid)
    let sub = `q:${JSON.stringify(preds)}`
    let sig = holdQuery(preds)
    // Primed synchronously from the in-memory cache (one project) — no flash.
    assertEquals(sig.value, [P1])
    // The server's initial set REPLACES the prime with the authoritative answer.
    landSub({
      sub,
      replace: true,
      shadow: true,
      changes: [...proj(P1, 1), ...proj(P2, 2)],
    })
    assertEquals(new Set(sig.value), new Set([P1, P2]))
    // A fresh match ADDS.
    landSub({ sub, shadow: true, changes: proj(P3, 3) })
    assertEquals(new Set(sig.value), new Set([P1, P2, P3]))
    // A lost match DROPS (left this query, still exists).
    landSub({ sub, shadow: true, changes: [], drop: [P3] })
    assertEquals(new Set(sig.value), new Set([P1, P2]))
    // A death forwards an entity-null and leaves the set.
    landSub({
      sub,
      shadow: true,
      changes: [{ eid: P2, name: 'entity', comp: null }],
    })
    assertEquals(sig.value, [P1])
    dropQuery(preds)
  } finally {
    ;(globalThis as { WebSocket: unknown }).WebSocket = RealWS
  }
})

// D-22567 §3, the client half: a PROJECTED sub's rows are honest about being
// projected. The cache is already partial at the ENTITY level (absence never
// means non-existence); a projection makes it partial at the COLUMN level too,
// and an undefined column that merely was never asked for must not read as
// null. `loaded()` is what tells the two apart, and it answers off the subs —
// so an unprojected sub, or a row no projected sub holds, is full.
Deno.test('loaded: a projected row does not masquerade as a full one', () => {
  let S = 'dddd0000-0000-4000-8000-000000000001'
  cache.value = {}
  resetSignals()
  let fields = [
    { comp: 'session', prop: 'turn', wake: true },
    { comp: 'session', prop: 'standing', wake: true },
  ]
  landSub({
    sub: 'q:projected',
    replace: true,
    shadow: true,
    fields,
    changes: [
      { eid: S, name: 'entity', comp: { eid: S, num: 9 } },
      { eid: S, name: 'session', comp: { turn: 'busy' } },
    ],
  })
  assertEquals(loaded(S, 'session', 'turn'), true)
  // Declared but absent from this row — an honestly EMPTY column.
  assertEquals(loaded(S, 'session', 'standing'), true)
  // Never declared: unloaded, not null. A render needing it subscribes for more.
  assertEquals(loaded(S, 'session', 'final_text'), false)
  assertEquals(loaded(S, 'doc', 'title'), false)
  // A FULLER sub over the same row heals it — the union of what holds it is
  // what the cache carries, which is why two projections of one query can share
  // a cache without either lying about the other's columns.
  landSub({
    sub: 'q:whole',
    replace: true,
    shadow: true,
    changes: [{ eid: S, name: 'session', comp: { cwd: '/tmp' } }],
  })
  assertEquals(loaded(S, 'session', 'final_text'), true)
  unsubscribe('q:projected')
  unsubscribe('q:whole')
})

Deno.test('loaded: a row no projected sub holds is full', () => {
  // The working-set seed and want() both land whole rows that belong to no sub;
  // saying "unloaded" for those would send every reader chasing a heal.
  let S = 'dddd0000-0000-4000-8000-000000000002'
  cache.value = { [S]: { entity: { eid: S, num: 10 } } }
  resetSignals()
  assertEquals(loaded(S, 'session', 'final_text'), true)
})

// T-21283: a per-rendered-row reverse-lookup (commentCount on every tile) must
// NEVER open a per-entity server sub — that scales with rows on screen and
// floods the leader (1363 subs measured). ONE shared aggregate sub serves every
// tile: the first read may open it; later reads — any target — open nothing.
Deno.test('commentCount shares one aggregate sub across targets (T-21283)', () => {
  let RealWS = (globalThis as { WebSocket: unknown }).WebSocket
  ;(globalThis as { WebSocket: unknown }).WebSocket = class {
    readyState = 0
    onopen: unknown = null
    onmessage: unknown = null
    onclose: unknown = null
    send() {}
    addEventListener() {}
    close() {}
  }
  let probe =
    (globalThis as unknown as { __probe: { subN: () => number } }).__probe
  let X = 'cccc0000-0000-4000-8000-000000000001'
  let Y = 'cccc0000-0000-4000-8000-000000000002'
  try {
    cache.value = {
      [X]: { entity: { eid: X, num: 1 }, canvas: { eid: X } },
      c1: { entity: { eid: 'c1', num: 2 }, comment: { eid: 'c1', target: X } },
      c2: { entity: { eid: 'c2', num: 3 }, comment: { eid: 'c2', target: X } },
    }
    // Prime the shared agg sub (idempotent across the file), then count every
    // subscribe frame that leaves: per-target reads must send NOTHING.
    assertEquals(commentCount(X).value, 2)
    let sent = 0
    let restore = useRoute(() => sent++)
    let n0 = probe.subN()
    try {
      assertEquals(commentCount(X).value, 2)
      assertEquals(commentCount(Y).value, 0)
      assertEquals(sent, 0)
      assertEquals(probe.subN(), n0)
      // A defining presence query DOES open its (bounded) server sub.
      let preds = resolveRefs(parseQuery('.canvas!'), findEid)
      holdQuery(preds)
      assertEquals(probe.subN(), n0 + 1)
      dropQuery(preds)
    } finally {
      useRoute(restore)
    }
  } finally {
    ;(globalThis as { WebSocket: unknown }).WebSocket = RealWS
  }
})

// T-21489: the open card's reverse lists — comments-of X, refs-to X — are HELD
// eid-keyed server subs: opened once per open entity (the hook's mount), reused
// by the plain doors and by later holders, and torn down with the LAST drop, so
// cards accumulate no subs as they open and close.
Deno.test('reverse subs: held per open card, torn down on close (T-21489)', () => {
  let RealWS = (globalThis as { WebSocket: unknown }).WebSocket
  ;(globalThis as { WebSocket: unknown }).WebSocket = class {
    readyState = 0
    onopen: unknown = null
    onmessage: unknown = null
    onclose: unknown = null
    send() {}
    addEventListener() {}
    close() {}
  }
  let probe =
    (globalThis as unknown as { __probe: { subN: () => number } }).__probe
  let X = 'dddd0000-0000-4000-8000-000000000001'
  try {
    cache.value = {
      [X]: { entity: { eid: X, num: 1 }, canvas: { eid: X } },
      c1: { entity: { eid: 'c1', num: 2 }, comment: { eid: 'c1', target: X } },
      k1: { entity: { eid: 'k1', num: 3 }, claim: { eid: 'k1', session: X } },
    }
    let comments = resolveRefs(parseQuery(`.comment.target=${X}`), findEid)
    let refs = resolveRefs(parseQuery(`.refs=${X}`), findEid)
    let n0 = probe.subN()
    // The card opens: one sub per reverse list, primed from the local cache.
    let thread = holdQuery(comments)
    let pointers = holdQuery(refs)
    assertEquals(probe.subN(), n0 + 2)
    assertEquals(thread.value, ['c1'])
    // The reverse-union sees every pointer: the claim AND the comment.
    assertEquals(new Set(pointers.value), new Set(['c1', 'k1']))
    // The plain doors REUSE the held sets — no third sub, same answers.
    assertEquals(commentsOn(X).map((c) => c.eid), ['c1'])
    assertEquals(
      new Set(backlinks(X).map((b) => `${b.from} ${b.via}`)),
      new Set(['c1 comment.target', 'k1 claim.session']),
    )
    assertEquals(probe.subN(), n0 + 2)
    // A second view of the same card shares; its release keeps the sub.
    holdQuery(comments)
    dropQuery(comments)
    assertEquals(probe.subN(), n0 + 2)
    // The card closes: the last drops tear both down — nothing accumulates.
    dropQuery(comments)
    dropQuery(refs)
    assertEquals(probe.subN(), n0)
  } finally {
    ;(globalThis as { WebSocket: unknown }).WebSocket = RealWS
  }
})

Deno.test('projected edge subs are refcounted and feed citation reads', () => {
  let X = 'dddd0000-0000-4000-8000-000000000011'
  let Y = 'dddd0000-0000-4000-8000-000000000012'
  let rider = '.edges[referenced,entry.session]!'
  let sub = `edges:${X}:${rider}`
  let sent: unknown[] = []
  let restore = useRoute((frame) => sent.push(frame))
  try {
    let off = edgeSub(X, rider)
    let again = edgeSub(X, rider)
    assertEquals(sent, [{ sub, q: `id=${X}&${rider}`, shadow: true }])
    landSub({
      sub,
      changes: [],
      replace: true,
      shadow: true,
      edges: [{ parent: X, type: 'referenced', child: Y }],
    })
    assertEquals(references(X), { out: [{ eid: Y }], in: [] })
    assertEquals(references(Y), { out: [], in: [{ eid: X }] })
    again()
    assertEquals(sent.length, 1)
    off()
    assertEquals(sent.at(-1), { unsub: sub })
    assertEquals(references(X), { out: [], in: [] })
  } finally {
    useRoute(restore)
  }
})

Deno.test('result-component subs are refcounted and stay outside the cache', () => {
  let X = 'dddd0000-0000-4000-8000-000000000021'
  let sub = `result:${X}:materialized`
  let sent: unknown[] = []
  let restore = useRoute((frame) => sent.push(frame))
  try {
    let value = resultComponent(X, 'materialized')
    let off = resultSub(X, 'materialized')
    let again = resultSub(X, 'materialized')
    assertEquals(sent, [{
      sub,
      q: `id=${X}&.materialized!`,
      shadow: true,
    }])
    landSub({
      sub,
      changes: [{
        eid: X,
        name: 'materialized',
        comp: { text: 'prompt\n', scoped: ['M1'] },
      }],
      replace: true,
      shadow: true,
    })
    assertEquals(value.value, { text: 'prompt\n', scoped: ['M1'] })
    assertEquals(cache.peek()[X], undefined)
    again()
    assertEquals(sent.length, 1)
    off()
    assertEquals(sent.at(-1), { unsub: sub })
  } finally {
    useRoute(restore)
  }
})

// The client half of the aggregate wire (T-21283): the server's initial tally
// REPLACES the local count and is authoritative from then on; delta frames
// merge (n=0 drops the key); rows never ride, so the cache is untouched.
Deno.test('an aggregate frame replaces, then deltas merge', () => {
  let X = 'cccc0000-0000-4000-8000-000000000011'
  let Y = 'cccc0000-0000-4000-8000-000000000012'
  cache.value = {
    c1: { entity: { eid: 'c1', num: 1 }, comment: { eid: 'c1', target: X } },
  }
  let x = commentCount(X)
  let y = commentCount(Y)
  assertEquals(x.value, 1) // local prime — the working-set count
  // The server answers the whole tally: X has three comments beyond the
  // working set, Y one — authoritative over the local scan.
  landSub({
    sub: 'agg:comments',
    changes: [],
    replace: true,
    agg: { [X]: 3, [Y]: 1 },
  })
  assertEquals(x.value, 3)
  assertEquals(y.value, 1)
  // A delta frame moves one key and leaves the rest standing.
  landSub({ sub: 'agg:comments', changes: [], agg: { [X]: 4 } })
  assertEquals(x.value, 4)
  assertEquals(y.value, 1)
  // n=0 drops the key — the last comment left.
  landSub({ sub: 'agg:comments', changes: [], agg: { [Y]: 0 } })
  assertEquals(y.value, 0)
  assertEquals(Object.keys(cache.value).length, 1) // no rows landed
})

// T-21511: socket-liveness predicates. A heartbeat frame is liveness only, and a
// socket-owning tab force-reconnects a stale connection (on the watchdog timeout
// or on refocus) instead of going silently deaf.
Deno.test('isPing recognizes only heartbeat frames', () => {
  assert(isPing({ ping: 1 }))
  assert(!isPing({ apply: [], id: 'x' }))
  assert(!isPing([{ eid: 'a', name: 'doc' }]))
  assert(!isPing('reload'))
  assert(!isPing({ hmr: 1 }))
  assert(!isPing(null))
  assert(!isPing(undefined))
})

Deno.test('socketStale: fresh OPEN is live, silence or non-OPEN is stale', () => {
  let OPEN = WebSocket.OPEN
  assert(!socketStale(OPEN, 9_000, 10_000, 60_000)) // heard 1s ago → live
  assert(socketStale(OPEN, 9_000, 80_000, 60_000)) // silent past window → stale
  assert(!socketStale(OPEN, 0, 60_000, 60_000)) // exactly the window, strict >
  assert(socketStale(WebSocket.CONNECTING, 10_000, 10_000, 60_000)) // not OPEN
  assert(socketStale(WebSocket.CLOSED, 10_000, 10_000, 60_000))
})

// T-21490: per-client singletons — cursor, camera, fold, shelf — ride ONE small
// server sub per tab (`.client=<uuid>`, the shared-ref scan query.ts already
// speaks), held for the tab's life; the readers stay LOCAL lookups over the
// rows it streams, so visiting boards or canvases opens no further wire subs.
Deno.test('client singletons: one tab sub, local reads, isolation (T-21490)', () => {
  let RealWS = (globalThis as { WebSocket: unknown }).WebSocket
  ;(globalThis as { WebSocket: unknown }).WebSocket = class {
    readyState = 0
    onopen: unknown = null
    onmessage: unknown = null
    onclose: unknown = null
    send() {}
    addEventListener() {}
    close() {}
  }
  let probe =
    (globalThis as unknown as { __probe: { subN: () => number } }).__probe
  let A = 'aaaa0000-0000-4000-8000-0000000000aa'
  let B = 'bbbb0000-0000-4000-8000-0000000000bb'
  let CV = 'cccc0000-0000-4000-8000-0000000000cc'
  let T = 'eeee0000-0000-4000-8000-0000000000ee'
  let b1 = 'b1b10000-0000-4000-8000-0000000000b1'
  let b2 = 'b2b20000-0000-4000-8000-0000000000b2'
  try {
    cache.value = {
      [T]: { entity: { eid: T, num: 1 }, canvas: { eid: T } },
      [CV]: { entity: { eid: CV, num: 2 }, canvas: { eid: CV } },
      ca: {
        entity: { eid: 'ca', num: 3 },
        cursor: { eid: 'ca', client: A, target: T },
      },
      fa: {
        entity: { eid: 'fa', num: 4 },
        fold: { eid: 'fa', client: A, board: b1, statuses: 'open' },
      },
      sa: { entity: { eid: 'sa', num: 5 }, shelf: { eid: 'sa', client: A } },
      ka: {
        entity: { eid: 'ka', num: 6 },
        camera: {
          eid: 'ka',
          client: A,
          canvas: CV,
          x: 7,
          y: 8,
          zoom: 1,
          w: 1,
          h: 1,
        },
      },
      cb: {
        entity: { eid: 'cb', num: 7 },
        cursor: { eid: 'cb', client: B, target: CV },
      },
    }
    // The sub line is the shared-ref scan, proven round-trippable to the wire.
    let preds = resolveRefs(parseQuery(`.client=${A}`), findEid)
    assertEquals(predsToQuery(preds), `.client=${A}`)
    let n0 = probe.subN()
    // Every singleton read for A answers A's rows through ONE wire sub.
    assertEquals(myCursor(A)?.target, T)
    assertEquals(foldFor(A, b1)?.statuses, 'open')
    assertEquals(foldFor(A, b2), undefined) // a second board: no second sub
    assertEquals(shelfFor(A), 'sa')
    assertEquals(myCamera(A, CV)?.x, 7)
    assertEquals(probe.subN(), n0 + 1)
    // Isolation: A's reads never surface B's rows; B's first read adds ITS sub.
    assertEquals(myCursor(B)?.target, CV)
    assertEquals(probe.subN(), n0 + 2)
    // The tab sub streams a new fold row for A — the local reader sees it.
    landSub({
      sub: `q:${JSON.stringify(preds)}`,
      changes: [
        { eid: 'f2', name: 'entity', comp: { eid: 'f2', num: 9 } },
        {
          eid: 'f2',
          name: 'fold',
          comp: { eid: 'f2', client: A, board: b2, statuses: 'wip' },
        },
      ],
    })
    assertEquals(foldFor(A, b2)?.statuses, 'wip')
    assertEquals(probe.subN(), n0 + 2) // still no per-shape subs
  } finally {
    ;(globalThis as { WebSocket: unknown }).WebSocket = RealWS
  }
})

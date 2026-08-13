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
  commentCount,
  commentsOn,
  config,
  deps,
  domains,
  dropQuery,
  ent,
  findEid,
  gated,
  holdQuery,
  jobOf,
  landObservation,
  landSub,
  observation,
  openDeps,
  parents,
  pinned,
  projects,
  relations,
  repoUrl,
  row,
  sessionRows,
  shelfFor,
  sieve,
  subEids,
  subscriptionChecks,
  topZ,
  unsubscribe,
} from './live.ts'
import { parseQuery, resolveRefs } from './query.ts'
import { type Ent } from './types.ts'
import { effect } from '@preact/signals'
import {
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

// Backlinks read the SCHEMA — every declared association points back at
// its target, whoever is allowed to write the column.
Deno.test('backlinks: stamped associations count', () => {
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
  }
  assertEquals(backlinks('t1'), [{
    from: 's1',
    via: 'session.requested_task',
  }])
  assertEquals(backlinks('s1'), [{ from: 'c1', via: 'claim.session' }])
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

// The facet reads (projects/sessionRows/shelfFor) ride the query door now, so
// each wakes only when ITS membership changes — a project born, a session born,
// a shelf claimed — never on an unrelated row patch.
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
    // An unrelated doc edit touches no facet — all stay asleep.
    applyLocal([{ eid: 'plain', name: 'doc', comp: { title: 'changed' } }])
    assertEquals(runs, { projects: 1, sessions: 1, shelf: 1 })

    // A project born wakes only the project census.
    applyLocal([{ eid: 'proj2', name: 'project', comp: {} }])
    assertEquals(runs, { projects: 2, sessions: 1, shelf: 1 })

    // A session born wakes only the session census.
    applyLocal([{ eid: 'sess2', name: 'session', comp: { id: 'sess2' } }])
    assertEquals(runs, { projects: 2, sessions: 2, shelf: 1 })

    // The client's shelf appears — only shelfFor wakes.
    applyLocal([{ eid: 'sh', name: 'shelf', comp: { client: 'client' } }])
    assertEquals(runs, { projects: 2, sessions: 2, shelf: 2 })
    assertEquals(shelfFor('client'), 'sh')
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

// The agreement counter is the evidence stage 2b is waiting on, and it was
// structurally unable to count. scanBoard is the only place that compared, and
// a simple board scans exactly once — at mount, BEFORE its subscription's first
// frame lands, so there is nothing to compare against. Every batch after that
// takes the incremental branch of refreshBoards, which stamps `set.graph` and
// so keeps any later render from rescanning either.
//
// The order below is the bug's order: scan first, subscription second, write
// third. A counter that only ever reads zero is indistinguishable from one that
// found no divergence, which is the worse of the two failures.
Deno.test('the agreement counter counts on the incremental path', async () => {
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
  // What the Board component does on mount: register the subscription (the
  // deferred counter only counts a sub some view is actually holding), then
  // render from the scan.
  let drop = boardSub(ent('board'))
  try {
    // Mount: the scan runs with no subscription frame to compare against.
    assertEquals(boardTasks(ent('board')).map((e) => e.eid), ['t1'])
    assertEquals(subscriptionChecks(), undefined)

    // The subscription's first frame lands after the mount scan, as it does —
    // and a SHADOW frame carries the spine alone. It has to be enough: the
    // client is still on the complete broadcast, so membership is the only
    // thing this frame is for.
    landSub({
      sub: 'board:board',
      changes: [{ eid: 't1', name: 'entity', comp: { eid: 't1', num: 2 } }],
      replace: true,
      shadow: true,
    })
    assertEquals(subEids('board:board')?.size, 1)

    // A committed batch — the only thing that reaches a simple board now.
    applyLocal([{
      eid: 't1',
      name: 'task',
      comp: { eid: 't1', status: 'open', priority: 0 },
    }])
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

// Work-lane readiness and candidate envelopes: managed dispatch and external
// workers share membership, while each keeps its own ordering. The db-backed
// cases also hold the lane reads to indexed, bounded graph queries.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from '@std/assert'
import { link } from './edge.ts'
import { type Change, idOf, uuid } from './types.ts'
import {
  buildWorkSql,
  evalBuildWork,
  evalDispatchWork,
  evalGraph,
  evalVerifyWork,
  evalWork,
  rowsFor,
  verifyWorkSql,
  workCompletionSql,
  workReviewSql,
  workVerifierSql,
} from './graph_query.ts'
import { dispatchSpawn } from './dispatch.ts'
import { parseQuery } from './query.ts'
import { where } from './sql.ts'
import { toSql } from './relation.ts'
import {
  buildReady,
  workCandidates,
  workFilters,
  type WorkRead,
} from './work.ts'
import { verificationPending } from './verification.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, depsOf } = await import('./db.ts')
let { bareDb } = await import('./testdb.ts')
let { localQuery } = await import('./graph_query.ts')
let { backlog } = await import('./dispatch.ts')

let readFor = (db: ReturnType<typeof bareDb>): WorkRead => ({
  query: localQuery(db),
  get: (ids) => localQuery(db)(ids.length ? [`id=${ids.join(',')}`] : []),
})

let task = (
  eid: string,
  title: string,
  priority: number,
  project: string,
  extra: Change[] = [],
): Change[] => [
  { eid, name: 'doc', comp: { title, body: '' } },
  { eid, name: 'task', comp: { priority, project, domain: 'Eng' } },
  ...extra,
]

let completedTask = (
  db: ReturnType<typeof bareDb>,
  project: string,
  title: string,
  at: string,
  accept = 'exercise the shipped door',
) => {
  let builder = uuid(), eid = uuid()
  apply(db, [
    { eid: builder, name: 'session', comp: { id: uuid() } },
    ...task(
      eid,
      title,
      1,
      project,
      accept ? [{ eid, name: 'accept', comp: { body: accept } }] : [],
    ),
  ])
  apply(db, [{ eid, name: 'completed', comp: { at } }], undefined, builder)
  db.prepare(
    `update completed set at = ?
      where entity = (select id from entity where eid = ?)`,
  ).run(at, eid)
  return { eid, builder }
}

let workReview = (
  db: ReturnType<typeof bareDb>,
  target: string,
  reviewer: string,
  verdict: 'approved' | 'rejected' | 'changes_requested',
  at: string,
  body = 'Ran the acceptance recipe.',
  eid = uuid(),
) => {
  apply(
    db,
    [
      { eid, name: 'doc', comp: { title: '', body } },
      { eid, name: 'comment', comp: { target } },
      { eid, name: 'review', comp: { verdict } },
    ],
    undefined,
    reviewer,
  )
  db.prepare(
    `update created set at = ?
      where entity = (select id from entity where eid = ?)`,
  ).run(at, eid)
  return eid
}

let workVerifier = (
  db: ReturnType<typeof bareDb>,
  target: string,
  at: string,
  status: string | null,
) => {
  let eid = uuid()
  apply(db, [
    {
      eid,
      name: 'session',
      comp: { id: uuid(), requested_task: target },
    },
    { eid, name: 'verifier', comp: {} },
  ])
  db.prepare(
    `update created set at = ?
      where entity = (select id from entity where eid = ?)`,
  ).run(at, eid)
  db.prepare(
    `update session set status = ?
      where entity = (select id from entity where eid = ?)`,
  ).run(status, eid)
  return eid
}

let world = () => {
  let db = bareDb()
  let P = uuid(), N = uuid(), S = uuid()
  let old = uuid(), fresh = uuid(), urgent = uuid()
  let gated = uuid(), blocker = uuid(), pending = uuid(), declined = uuid()
  let done = uuid(), held = uuid(), stuck = uuid()
  let root = uuid(), child = uuid(), heldGate = uuid(), grandchild = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Task Graph', body: '' } },
    { eid: P, name: 'project', comp: {} },
    {
      eid: P,
      name: 'repo',
      comp: {
        path: '/repo/tasks',
        url: 'https://example.test/tasks',
        gate: 'deno task check',
      },
    },
    { eid: N, name: 'doc', comp: { title: 'Coder', body: '' } },
    { eid: N, name: 'persona', comp: {} },
    { eid: S, name: 'session', comp: { id: 'holder' } },
    ...task(old, 'Old P1', 1, P, [{ eid: old, name: 'decided', comp: {} }]),
    ...task(fresh, 'Fresh P1', 1, P, [
      { eid: fresh, name: 'decided', comp: {} },
      { eid: fresh, name: 'spawn', comp: { provider: 'codex', persona: N } },
    ]),
    ...task(urgent, 'Fresh P0', 0, P, [{
      eid: urgent,
      name: 'decided',
      comp: {},
    }]),
    ...task(blocker, 'Open blocker', 2, P),
    ...task(gated, 'Gated', 0, P, [{ eid: gated, name: 'decided', comp: {} }]),
    ...link(gated, 'requires', blocker),
    ...task(pending, 'Needs decision', 0, P, [{
      eid: pending,
      name: 'proposed',
      comp: {},
    }]),
    ...task(declined, 'Said no', 0, P, [
      { eid: declined, name: 'proposed', comp: {} },
      { eid: declined, name: 'decided', comp: { verdict: 'declined' } },
    ]),
    ...task(done, 'Finished', 0, P, [
      { eid: done, name: 'decided', comp: {} },
      { eid: done, name: 'completed', comp: {} },
    ]),
    ...task(held, 'Claimed', 0, P, [
      { eid: held, name: 'decided', comp: {} },
      { eid: held, name: 'claim', comp: { session: S } },
    ]),
    ...task(stuck, 'External block', 0, P, [
      { eid: stuck, name: 'decided', comp: {} },
      { eid: stuck, name: 'blocked', comp: { on: 'vendor' } },
    ]),
    ...task(root, 'Approved umbrella', 2, P, [{
      eid: root,
      name: 'decided',
      comp: {},
    }]),
    ...task(child, 'Inherited child', 2, P),
    ...link(root, 'requires', child),
    ...link(root, 'requires', declined),
    ...task(heldGate, 'Pending boundary', 2, P, [{
      eid: heldGate,
      name: 'proposed',
      comp: {},
    }]),
    ...task(grandchild, 'Behind pending boundary', 2, P),
    ...link(root, 'requires', heldGate),
    ...link(heldGate, 'requires', grandchild),
  ])
  let read = readFor(db)
  return {
    db,
    read,
    P,
    N,
    old,
    fresh,
    urgent,
    gated,
    pending,
    declined,
    root,
    child,
    heldGate,
    grandchild,
  }
}

Deno.test('build readiness excludes every non-runnable state', async () => {
  let w = world()
  let candidates = await workCandidates(w.read, 'build', { limit: 20 })
  assertEquals(candidates.map((c) => c.id), [
    idOf(rowsFor(w.db, [w.urgent])[0]),
    idOf(rowsFor(w.db, [w.fresh])[0]),
    idOf(rowsFor(w.db, [w.old])[0]),
  ])
  assertEquals(candidates[1].project, {
    id: idOf(rowsFor(w.db, [w.P])[0]),
    title: 'Task Graph',
  })
  assertEquals(candidates[1].execution, {
    repo: {
      path: '/repo/tasks',
      url: 'https://example.test/tasks',
      gate: 'deno task check',
      base_branch: 'main',
    },
    spawn: { provider: 'codex', persona: idOf(rowsFor(w.db, [w.N])[0]) },
  })
  assertEquals(candidates.every((c) => c.authorization?.kind == 'direct'), true)
})

Deno.test('recursive authorization stops at pending and declined boundaries', async () => {
  let w = world()
  let candidates = await workCandidates(w.read, 'build', {
    recursive: true,
    limit: 20,
  })
  let ids = candidates.map((c) => c.id)
  let child = idOf(rowsFor(w.db, [w.child])[0])
  assert(ids.includes(child))
  assertEquals(ids.includes(idOf(rowsFor(w.db, [w.heldGate])[0])), false)
  assertEquals(ids.includes(idOf(rowsFor(w.db, [w.declined])[0])), false)
  assertEquals(ids.includes(idOf(rowsFor(w.db, [w.grandchild])[0])), false)
  let inherited = candidates.find((c) => c.id == child)!
  assertEquals(inherited.authorization, {
    kind: 'inherited',
    from: [idOf(rowsFor(w.db, [w.root])[0])],
    truncated: false,
  })
})

Deno.test('build candidates and managed backlog have identical membership', async () => {
  let w = world()
  for (let recursive of [false, true]) {
    let candidates = await workCandidates(w.read, 'build', {
      recursive,
      limit: 100,
    })
    // The reference side is the complete task partition plus every incident
    // endpoint, not the selector (or one of its windows) under test.
    let tasks = await w.read.query(['.task!'])
    let deps = depsOf(w.db, tasks.map((r) => r.eid))
    let ends = rowsFor(w.db, deps.flatMap((d) => [d.parent, d.child]))
    let unique = new Map([...tasks, ...ends].map((r) => [r.eid, r]))
    let members = backlog([...unique.values()], deps, recursive)
      .map((r) => idOf(r)).sort()
    assertEquals(candidates.map((c) => c.id).sort(), members)
  }
})

Deno.test('build selection is exact beyond a recent declined window', async () => {
  let db = bareDb()
  let P = uuid(), old = uuid(), newer = uuid()
  let changes: Change[] = [
    { eid: P, name: 'doc', comp: { title: 'Ordering', body: '' } },
    { eid: P, name: 'project', comp: {} },
    ...task(old, 'Old P0 ready', 0, P, [{
      eid: old,
      name: 'decided',
      comp: {},
    }]),
    ...task(newer, 'Newer P1 ready', 1, P, [{
      eid: newer,
      name: 'decided',
      comp: {},
    }]),
  ]
  for (let i = 0; i < 250; i++) {
    let eid = uuid()
    changes.push(...task(eid, `Declined ${i}`, 0, P, [
      { eid, name: 'proposed', comp: {} },
      { eid, name: 'decided', comp: { verdict: 'declined' } },
    ]))
  }
  apply(db, changes)
  let candidates = await workCandidates(readFor(db), 'build', { limit: 1 })
  assertEquals(candidates.map((c) => c.id), [idOf(rowsFor(db, [old])[0])])
})

Deno.test('recursive DB selection stops beyond a high-fanout pending boundary', async () => {
  let db = bareDb()
  let P = uuid(), root = uuid(), target = uuid()
  let boundary = 'ffffffff-ffff-4fff-bfff-fffffffffff0'
  let changes: Change[] = [
    { eid: P, name: 'doc', comp: { title: 'Fanout', body: '' } },
    { eid: P, name: 'project', comp: {} },
  ]
  for (let i = 0; i < 450; i++) {
    let eid = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    changes.push(...task(eid, `Sibling ${i}`, 5, P))
  }
  changes.push(
    ...task(boundary, 'Pending boundary', 4, P, [{
      eid: boundary,
      name: 'proposed',
      comp: {},
    }]),
    ...task(root, 'Approved root', -2, P, [{
      eid: root,
      name: 'decided',
      comp: {},
    }]),
    ...task(target, 'Must stay held', -3, P),
  )
  for (let i = 0; i < 450; i++) {
    changes.push(
      ...link(
        root,
        'requires',
        `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    )
  }
  changes.push(
    ...link(root, 'requires', boundary),
    ...link(boundary, 'requires', target),
  )
  apply(db, changes)
  let ids = (await workCandidates(readFor(db), 'build', {
    recursive: true,
    limit: 100,
  })).map((c) => c.id)
  assertEquals(ids.includes(idOf(rowsFor(db, [target])[0])), false)
})

Deno.test('evaluate bounds high-fanout blockers and emits only human ids', async () => {
  let db = bareDb()
  let P = uuid(), candidate = uuid()
  let changes: Change[] = [
    { eid: P, name: 'doc', comp: { title: 'Blockers', body: '' } },
    { eid: P, name: 'project', comp: {} },
  ]
  let blockers: string[] = []
  for (let i = 0; i < 450; i++) {
    let eid = uuid()
    blockers.push(eid)
    changes.push(...task(eid, `Blocker ${i}`, 2, P))
  }
  changes.push(...task(candidate, 'Evaluate fanout', 0, P, [{
    eid: candidate,
    name: 'proposed',
    comp: {},
  }]))
  for (let child of blockers) {
    changes.push(...link(candidate, 'requires', child))
  }
  apply(db, changes)
  let [found] = await workCandidates(readFor(db), 'evaluate', { limit: 1 })
  assertEquals(found.blockers.items.length, 20)
  assertEquals(found.blockers.truncated, true)
  assert(found.blockers.items.every((b) => /^T-\d+$/.test(b.id)))
  assert(found.blockers.items.every((b) => b.status == 'open'))
})

Deno.test('evaluate is newest-first, filtered, bounded, and human-addressed', async () => {
  let w = world()
  let all = await workCandidates(w.read, 'evaluate', { limit: 1 })
  assertEquals(all.length, 1)
  assertEquals(all[0].id, idOf(rowsFor(w.db, [w.heldGate])[0]))
  assertEquals(all[0].decision, 'pending')
  let filtered = await workCandidates(w.read, 'evaluate', {
    filters: ['.title~=Needs'],
  })
  assertEquals(filtered.map((c) => c.id), [idOf(rowsFor(w.db, [w.pending])[0])])
  let byProject = await workCandidates(w.read, 'evaluate', {
    filters: ['.task.project.doc.title=Task Graph'],
  })
  assertEquals(byProject.length, 2)
})

Deno.test('work filters reject unsupported query riders explicitly', async () => {
  let w = world()
  for (let filter of ['.comments!', '.count!', 'free text']) {
    await assertRejects(
      () => workCandidates(w.read, 'build', { filters: [filter] }),
      Error,
      'work filters support indexed scalar dot-params',
    )
  }
})

Deno.test('recursive authorization traverses non-task intermediates', async () => {
  let db = bareDb()
  let P = uuid(), root = uuid(), design = uuid(), leaf = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Mixed tree', body: '' } },
    { eid: P, name: 'project', comp: {} },
    ...task(root, 'Approved root', 1, P, [{
      eid: root,
      name: 'decided',
      comp: {},
    }]),
    { eid: design, name: 'doc', comp: { title: 'Design', body: '' } },
    { eid: design, name: 'design', comp: {} },
    ...task(leaf, 'Build leaf', 1, P),
    ...link(root, 'requires', design),
    ...link(design, 'requires', leaf),
  ])
  let candidates = await workCandidates(readFor(db), 'build', {
    recursive: true,
    limit: 20,
  })
  let found = candidates.find((c) => c.id == idOf(rowsFor(db, [leaf])[0]))
  assertEquals(found?.authorization, {
    kind: 'inherited',
    from: [idOf(rowsFor(db, [root])[0])],
    truncated: false,
  })
})

Deno.test('managed dispatch shares the complete recursive DB membership', async () => {
  let db = bareDb()
  let P = uuid(), root = uuid(), a = uuid(), b = uuid(), leaf = uuid()
  let direct = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Dispatch closure', body: '' } },
    { eid: P, name: 'project', comp: {} },
    ...task(root, 'Approved root', 0, P, [
      { eid: root, name: 'decided', comp: {} },
    ]),
    { eid: a, name: 'doc', comp: { title: 'Design A', body: '' } },
    { eid: a, name: 'design', comp: {} },
    { eid: b, name: 'doc', comp: { title: 'Design B', body: '' } },
    { eid: b, name: 'design', comp: {} },
    ...task(leaf, 'Inherited leaf', 1, P),
    ...task(direct, 'Direct newer', 1, P, [{
      eid: direct,
      name: 'decided',
      comp: {},
    }]),
    ...link(root, 'requires', a),
    ...link(a, 'requires', b),
    ...link(b, 'requires', a),
    ...link(b, 'requires', leaf),
  ])
  // created.at is server-stamped and therefore cannot be supplied on the
  // wire. Put the higher-numbered direct task first in time so a num-only
  // dispatch order would fail this assertion.
  let stamp = db.prepare(
    `update created set at = ?
      where entity = (select id from entity where eid = ?)`,
  )
  stamp.run('2026-01-03T00:00:00.000Z', leaf)
  stamp.run('2026-01-02T00:00:00.000Z', direct)
  let q = workFilters('build', true).join('&')
  let worker = evalBuildWork(db, q, { recursive: true, limit: 100 })
  let managed = evalDispatchWork(db, q, true)
  assertEquals(
    managed.map((r) => r.eid).sort(),
    worker.map((r) => r.eid).sort(),
  )
  // Same membership, separate established orders: worker number-desc and
  // dispatch oldest-created. The A↔B cycle terminates under UNION.
  assertEquals(worker.map((r) => r.eid), [direct, leaf])
  assertEquals(managed.map((r) => r.eid), [direct, leaf])
  db.prepare(
    `insert into resume(entity, at, rank)
     select id, ?, ? from entity where eid = ?`,
  ).run('2026-01-04T00:00:00.000Z', 7, leaf)
  assertEquals(evalDispatchWork(db, q, true).map((r) => r.eid), [leaf, direct])
  assertEquals(
    evalBuildWork(db, q, { recursive: true, limit: 100 }).map((r) => r.eid),
    [direct, leaf],
  )

  // This is the old dispatch input: deps incident only to open tasks. It sees
  // root→A and B→leaf, but omits A→B and therefore cannot authorize the leaf.
  let taskRows = await localQuery(db)(['.task!'])
  let partial = depsOf(db, taskRows.map((r) => r.eid))
  let ends = rowsFor(db, partial.flatMap((d) => [d.parent, d.child]))
  let all = new Map([...taskRows, ...ends].map((r) => [r.eid, r]))
  assertEquals(
    backlog([...all.values()], partial, true).some((r) => r.eid == leaf),
    false,
  )
  let spawned = dispatchSpawn(
    [...all.values()],
    partial,
    [{ name: 'claude', models: ['sonnet'] }],
    2,
    true,
    Date.now(),
    undefined,
    managed,
  ).filter((c) => c.name == 'session').map((c) => c.comp!.requested_task)
  assertEquals(spawned.slice(0, 2), [direct, leaf])
  let off = workFilters('build', false).join('&')
  assertEquals(evalBuildWork(db, off, { limit: 100 }).map((r) => r.eid), [
    direct,
  ])
  assertEquals(evalDispatchWork(db, off, false).map((r) => r.eid), [
    direct,
  ])
})

Deno.test('work lanes reject direct and dotted quarantine reveal filters', async () => {
  let db = bareDb()
  let hidden = uuid()
  apply(db, [
    { eid: hidden, name: 'doc', comp: { title: 'Moderated', body: '' } },
    { eid: hidden, name: 'quarantined', comp: {} },
  ])
  assertEquals(evalGraph(db, '.quarantined!').hits.map((r) => r.eid), [hidden])
  for (let lane of ['evaluate', 'build', 'verify'] as const) {
    for (let filter of ['.quarantined!', '.task.project.quarantined!']) {
      let filters = [...workFilters(lane), filter]
      assertThrows(
        () => evalWork(db, filters.join('&'), { work: lane }),
        Error,
        'work filters never reveal quarantined entities',
      )
      await assertRejects(
        () => localQuery(db)(filters, { work: lane }),
        Error,
        'work filters never reveal quarantined entities',
      )
      await assertRejects(
        () => workCandidates(readFor(db), lane, { filters: [filter] }),
        Error,
        'work filters never reveal quarantined entities',
      )
    }
  }
})

Deno.test('managed dispatch does not window its eligible feed', () => {
  let db = bareDb()
  let P = uuid()
  let changes: Change[] = [
    { eid: P, name: 'doc', comp: { title: 'Long queue', body: '' } },
    { eid: P, name: 'project', comp: {} },
  ]
  for (let i = 0; i < 125; i++) {
    let eid = uuid()
    changes.push(
      ...task(eid, `Ready ${i}`, 1, P, [{
        eid,
        name: 'decided',
        comp: {},
      }]),
    )
  }
  apply(db, changes)
  assertEquals(
    evalDispatchWork(db, workFilters('build').join('&')).length,
    125,
  )
})

Deno.test('quarantine is private in blocker and authorization projections', async () => {
  let db = bareDb()
  let P = uuid(), hidden = uuid(), visible = uuid()
  let proposed = uuid(), approved = uuid(), hiddenRoot = uuid(), leaf = uuid()
  let hiddenSession = uuid(), hiddenPersona = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Private', body: '' } },
    { eid: P, name: 'project', comp: {} },
    ...task(hidden, 'SECRET BLOCKER', 1, P),
    { eid: hidden, name: 'quarantined', comp: {} },
    { eid: hiddenSession, name: 'session', comp: { id: 'secret-holder' } },
    { eid: hiddenSession, name: 'quarantined', comp: {} },
    {
      eid: hiddenPersona,
      name: 'doc',
      comp: { title: 'SECRET PERSONA', body: '' },
    },
    { eid: hiddenPersona, name: 'persona', comp: {} },
    { eid: hiddenPersona, name: 'quarantined', comp: {} },
    ...task(visible, 'Visible blocker', 1, P),
    { eid: visible, name: 'claim', comp: { session: hiddenSession } },
    ...task(proposed, 'Needs review', 1, P, [{
      eid: proposed,
      name: 'proposed',
      comp: {},
    }, {
      eid: proposed,
      name: 'spawn',
      comp: { provider: 'codex', persona: hiddenPersona },
    }]),
    ...link(proposed, 'requires', hidden),
    ...link(proposed, 'requires', visible),
    ...task(approved, 'Gated by hidden work', 1, P, [{
      eid: approved,
      name: 'decided',
      comp: {},
    }]),
    ...link(approved, 'requires', hidden),
    ...task(hiddenRoot, 'SECRET ROOT', 1, P, [{
      eid: hiddenRoot,
      name: 'decided',
      comp: {},
    }]),
    { eid: hiddenRoot, name: 'quarantined', comp: {} },
    ...task(leaf, 'Unapproved leaf', 1, P),
    ...link(hiddenRoot, 'requires', leaf),
  ])
  let [candidate] = await workCandidates(readFor(db), 'evaluate', { limit: 20 })
  assertEquals(candidate.blockers, {
    items: [{
      id: idOf(rowsFor(db, [visible])[0]),
      title: 'Visible blocker',
      status: 'wip',
      claim: null,
    }],
    truncated: false,
  })
  assertEquals(JSON.stringify(candidate).includes('SECRET'), false)
  assertEquals(candidate.execution, { spawn: { provider: 'codex' } })
  let build = await workCandidates(readFor(db), 'build', {
    recursive: true,
    limit: 100,
  })
  let ids = build.map((c) => c.id)
  assertEquals(ids.includes(idOf(rowsFor(db, [approved])[0])), false)
  assertEquals(ids.includes(idOf(rowsFor(db, [leaf])[0])), false)
  assertEquals(JSON.stringify(build).includes('SECRET'), false)
})

Deno.test('deep authorization is one bounded query projection', async () => {
  let db = bareDb()
  let P = uuid(), root = uuid(), leaf = uuid()
  let changes: Change[] = [
    { eid: P, name: 'doc', comp: { title: 'Deep', body: '' } },
    { eid: P, name: 'project', comp: {} },
    ...task(root, 'Approved root', 1, P, [{
      eid: root,
      name: 'decided',
      comp: {},
    }]),
    ...task(leaf, 'Deep leaf', 1, P),
  ]
  let parent = root
  for (let i = 0; i < 201; i++) {
    let eid = uuid()
    changes.push(
      { eid, name: 'doc', comp: { title: `Design ${i}`, body: '' } },
      { eid, name: 'design', comp: {} },
      ...link(parent, 'requires', eid),
    )
    parent = eid
  }
  changes.push(...link(parent, 'requires', leaf))
  apply(db, changes)
  let local = readFor(db)
  let queries = 0, gets = 0
  let read: WorkRead = {
    query: (filters, opts) => {
      queries++
      return local.query(filters, opts)
    },
    get: (ids) => {
      gets++
      return local.get(ids)
    },
  }
  let candidates = await workCandidates(read, 'build', {
    recursive: true,
    limit: 100,
  })
  let found = candidates.find((c) => c.id == idOf(rowsFor(db, [leaf])[0]))
  assertEquals(found?.authorization?.from, [idOf(rowsFor(db, [root])[0])])
  assertEquals({ queries, gets }, { queries: 1, gets: 1 })
})

Deno.test('authorization sources are capped and say when truncated', async () => {
  let db = bareDb()
  let P = uuid(), leaf = uuid()
  let changes: Change[] = [
    { eid: P, name: 'doc', comp: { title: 'Many roots', body: '' } },
    { eid: P, name: 'project', comp: {} },
    ...task(leaf, 'Shared leaf', 1, P),
  ]
  for (let i = 0; i < 25; i++) {
    let root = uuid()
    changes.push(
      ...task(root, `Root ${i}`, 1, P, [{
        eid: root,
        name: 'decided',
        comp: {},
      }]),
      ...link(root, 'requires', leaf),
    )
  }
  apply(db, changes)
  let candidates = await workCandidates(readFor(db), 'build', {
    recursive: true,
    limit: 100,
  })
  let found = candidates.find((c) => c.id == idOf(rowsFor(db, [leaf])[0]))!
  assertEquals(found.authorization?.from.length, 20)
  assertEquals(found.authorization?.truncated, true)
  assert(found.authorization!.from.every((id) => /^T-\d+$/.test(id)))
})

Deno.test('verify lane has exact VERIFY_PENDING membership across review and verifier states', () => {
  let db = bareDb()
  let P = uuid(), reviewer = uuid(), muted = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Verification', body: '' } },
    { eid: P, name: 'project', comp: {} },
    { eid: reviewer, name: 'session', comp: { id: uuid() } },
    { eid: muted, name: 'doc', comp: { title: 'Muted', body: '' } },
    { eid: muted, name: 'project', comp: {} },
    { eid: muted, name: 'noverify', comp: {} },
  ])
  let made: string[] = []
  let add = (title: string, at: string, project = P, accept?: string) => {
    let found = completedTask(db, project, title, at, accept)
    made.push(found.eid)
    return found
  }
  let pending = add('No review', '2026-01-01T00:00:00.000Z')
  let approved = add('Approved', '2026-01-02T00:00:00.000Z')
  workReview(
    db,
    approved.eid,
    reviewer,
    'approved',
    '2026-01-02T01:00:00.000Z',
  )
  let rejected = add('Rejected', '2026-01-03T00:00:00.000Z')
  workReview(
    db,
    rejected.eid,
    reviewer,
    'rejected',
    '2026-01-03T01:00:00.000Z',
  )
  let changes = add('Changes', '2026-01-04T00:00:00.000Z')
  workReview(
    db,
    changes.eid,
    reviewer,
    'changes_requested',
    '2026-01-04T01:00:00.000Z',
  )
  let empty = add('Empty evidence', '2026-01-05T00:00:00.000Z')
  workReview(
    db,
    empty.eid,
    reviewer,
    'approved',
    '2026-01-05T01:00:00.000Z',
    '\u2003\ufeff',
  )
  let self = add('Self review', '2026-01-06T00:00:00.000Z')
  workReview(
    db,
    self.eid,
    self.builder,
    'approved',
    '2026-01-06T01:00:00.000Z',
  )
  let stale = add('Stale review', '2026-01-07T00:00:00.000Z')
  workReview(
    db,
    stale.eid,
    reviewer,
    'approved',
    '2026-01-06T23:00:00.000Z',
  )
  let active = add('Active verifier', '2026-01-08T00:00:00.000Z')
  workVerifier(db, active.eid, '2026-01-08T01:00:00.000Z', 'running')
  let terminal = add('Terminal verifier', '2026-01-09T00:00:00.000Z')
  workVerifier(db, terminal.eid, '2026-01-09T01:00:00.000Z', 'failed')
  let noverify = add(
    'Manual despite noverify',
    '2026-01-10T00:00:00.000Z',
    muted,
  )
  let missing = add('Missing criteria', '2026-01-11T00:00:00.000Z', P, '')
  let cancelled = add('Cancelled', '2026-01-12T00:00:00.000Z')
  apply(db, [{
    eid: cancelled.eid,
    name: 'cancelled',
    comp: { at: '2026-01-12T01:00:00.000Z' },
  }])

  let expected = made.filter((eid) => verificationPending(db, eid)).sort()
  let actual = evalVerifyWork(db, workFilters('verify').join('&'), {
    limit: 100,
  }).map((r) => r.eid).sort()
  assertEquals(actual, expected)
  assertEquals(actual.includes(active.eid), false)
  assertEquals(actual.includes(approved.eid), false)
  assertEquals(actual.includes(noverify.eid), true)
  assertEquals(actual.includes(missing.eid), false)
  assertEquals(actual.includes(cancelled.eid), false)
  for (let task of [pending, rejected, changes, empty, self, stale, terminal]) {
    assertEquals(actual.includes(task.eid), true)
  }
})

Deno.test('verify lane orders before LIMIT and projects bounded human evidence', async () => {
  let db = bareDb()
  let P = uuid(), reviewer = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Verify order', body: '' } },
    { eid: P, name: 'project', comp: {} },
    { eid: reviewer, name: 'session', comp: { id: uuid() } },
  ])
  let old = completedTask(
    db,
    P,
    'Old pending',
    '2026-01-01T00:00:00.000Z',
    'x'.repeat(5000),
  )
  let review = workReview(
    db,
    old.eid,
    reviewer,
    'rejected',
    '2026-01-01T01:00:00.000Z',
    'y'.repeat(5001),
  )
  let verifier = workVerifier(
    db,
    old.eid,
    '2026-01-01T02:00:00.000Z',
    'failed',
  )
  // A filtered prefix full of newer approved work cannot starve an older
  // pending candidate: VERIFY_PENDING screens before LIMIT.
  for (let i = 0; i < 125; i++) {
    let done = completedTask(
      db,
      P,
      `Approved ${i}`,
      `2026-02-${String((i % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
    )
    workReview(
      db,
      done.eid,
      reviewer,
      'approved',
      `2026-03-${String((i % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
    )
  }
  let [candidate] = await workCandidates(readFor(db), 'verify', { limit: 1 })
  assertEquals(candidate.id, idOf(rowsFor(db, [old.eid])[0]))
  assertEquals(candidate.accept, {
    body: 'x'.repeat(4000),
    truncated: true,
  })
  assertEquals(candidate.completed, {
    at: '2026-01-01T00:00:00.000Z',
    via: idOf(rowsFor(db, [old.builder])[0]),
  })
  assertEquals(candidate.review, {
    id: idOf(rowsFor(db, [review])[0]),
    verdict: 'rejected',
    body: 'y'.repeat(4000),
    truncated: true,
    reviewer: idOf(rowsFor(db, [reviewer])[0]),
    at: '2026-01-01T01:00:00.000Z',
  })
  assertEquals(candidate.verifier, {
    id: idOf(rowsFor(db, [verifier])[0]),
    status: 'failed',
    at: '2026-01-01T02:00:00.000Z',
    active: false,
  })

  let tie = '2026-04-01T00:00:00.000Z'
  let a = completedTask(db, P, 'Tie A', tie)
  let b = completedTask(db, P, 'Tie B', tie)
  let tied = await workCandidates(readFor(db), 'verify', { limit: 2 })
  let expected = rowsFor(db, [a.eid, b.eid])
    .sort((x, y) => y.num - x.num).map(idOf)
  assertEquals(tied.map((c) => c.id), expected)
})

Deno.test('verify filters reuse the driving completed row exactly', async () => {
  let db = bareDb()
  let P = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Completed filters', body: '' } },
    { eid: P, name: 'project', comp: {} },
  ])
  let old = completedTask(db, P, 'Old', '2026-01-01T12:00:00.000Z')
  let fresh = completedTask(db, P, 'Fresh', '2026-01-03T12:00:00.000Z')
  let ids = (filters: string[]) =>
    workCandidates(readFor(db), 'verify', { filters, limit: 20 }).then((rows) =>
      rows.map((row) => row.id)
    )
  let oldId = idOf(rowsFor(db, [old.eid])[0])
  let freshId = idOf(rowsFor(db, [fresh.eid])[0])

  assertEquals(await ids(['.completed!']), [freshId, oldId])
  assertEquals(await ids(['.completed=']), [])
  assertEquals(await ids(['.completed.at!']), [freshId, oldId])
  assertEquals(await ids(['.completed.at>=2026-01-02']), [freshId])
  assertEquals(await ids(['.completed.at=2026-01-01..2026-01-02']), [oldId])
})

Deno.test('verify evidence never reveals quarantined candidates or references', async () => {
  let db = bareDb()
  let P = uuid(), reviewer = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'SECRET PROJECT', body: '' } },
    { eid: P, name: 'project', comp: {} },
    { eid: P, name: 'quarantined', comp: {} },
    { eid: reviewer, name: 'session', comp: { id: 'SECRET REVIEWER' } },
    { eid: reviewer, name: 'quarantined', comp: {} },
  ])
  let visible = completedTask(
    db,
    P,
    'Visible candidate',
    '2026-01-01T00:00:00.000Z',
  )
  apply(db, [{ eid: visible.builder, name: 'quarantined', comp: {} }])
  let hiddenReview = workReview(
    db,
    visible.eid,
    reviewer,
    'rejected',
    '2026-01-01T01:00:00.000Z',
    'SECRET REVIEW',
  )
  apply(db, [{ eid: hiddenReview, name: 'quarantined', comp: {} }])
  let hidden = completedTask(
    db,
    P,
    'SECRET CANDIDATE',
    '2026-01-02T00:00:00.000Z',
  )
  apply(db, [{ eid: hidden.eid, name: 'quarantined', comp: {} }])

  let candidates = await workCandidates(readFor(db), 'verify', { limit: 20 })
  assertEquals(candidates.length, 1)
  assertEquals(candidates[0].title, 'Visible candidate')
  assertEquals(candidates[0].project, undefined)
  assertEquals(candidates[0].completed?.via, null)
  assertEquals(candidates[0].review, undefined)
  assertEquals(JSON.stringify(candidates).includes('SECRET'), false)
})

Deno.test('verify lane and evidence plans stay on their keyed walks', () => {
  let db = bareDb()
  let P = uuid()
  apply(db, [
    { eid: P, name: 'doc', comp: { title: 'Plan', body: '' } },
    { eid: P, name: 'project', comp: {} },
  ])
  let pending = completedTask(db, P, 'Pending', '2026-01-01T00:00:00.000Z')
  let built = verifyWorkSql(db, workFilters('verify').join('&'))
  let plan = db.prepare(`explain query plan ${built.sql}`).all(
    ...built.params,
  ) as { detail: string }[]
  let details = plan.map((row) => row.detail).join('\n')
  assertMatch(
    plan[0].detail,
    /SCAN completed USING COVERING INDEX completed_at/,
  )
  assertMatch(details, /comment_target/)
  assertMatch(details, /session_requested_task/)
  assertEquals(plan.some((row) => row.detail == 'SCAN entity'), false)
  assertEquals(
    plan.some((row) => /MATERIALIZE|SCAN task/.test(row.detail)),
    false,
  )

  // Evidence starts from the bounded human-id set. Every component lookup is
  // a primary-key or reference-index search; scans are confined to the ranked
  // CTE result, never a persistent component table.
  for (
    let [name, evidence, index] of [
      ['completion', workCompletionSql([pending.eid]), /autoindex_entity/],
      ['review', workReviewSql([pending.eid]), /comment_target/],
      ['verifier', workVerifierSql([pending.eid]), /session_requested_task/],
    ] as const
  ) {
    let evidencePlan = db.prepare(`explain query plan ${evidence.sql}`).all(
      ...evidence.params,
    ) as { detail: string }[]
    let evidenceDetails = evidencePlan.map((row) => row.detail).join('\n')
    assertMatch(evidenceDetails, index, name)
    assertEquals(
      evidencePlan.some((row) =>
        /SCAN (entity|task|accept|completed|comment|review|session|verifier)(?:\s|$)/
          .test(row.detail)
      ),
      false,
      name,
    )
  }
})

Deno.test('lane membership queries compile to indexed component scans', () => {
  let w = world()
  for (let lane of ['evaluate', 'build', 'verify'] as const) {
    let rel = where(parseQuery(workFilters(lane).join('&')))
    assert(rel, lane)
    let built = toSql(rel)
    let plan = w.db.prepare(`explain query plan ${built.sql}`).all(
      ...built.params,
    ) as {
      detail: string
    }[]
    assertEquals(plan.some((row) => row.detail == 'SCAN entity'), false, lane)
  }
  let built = buildWorkSql(
    w.db,
    workFilters('build', true).join('&'),
    { recursive: true },
  )
  let plan = w.db.prepare(`explain query plan ${built.sql}`).all(
    ...built.params,
  ) as { detail: string }[]
  assertEquals(plan.some((row) => row.detail == 'SCAN entity'), false)
  // The lineage walk steps by the reverse endpoint's own index — `edge_to`
  // now that a sentence is an edge entity, where it was `dependency_child`.
  assert(plan.some((row) => row.detail.includes('edge_to')))
  let path = buildWorkSql(
    w.db,
    `${workFilters('build').join('&')}&.task.project.doc.title=Task Graph`,
  )
  let pathPlan = w.db.prepare(`explain query plan ${path.sql}`).all(
    ...path.params,
  ) as { detail: string }[]
  assertEquals(pathPlan.some((row) => row.detail == 'SCAN entity'), false)
  assert(pathPlan.some((row) => row.detail == 'CORRELATED SCALAR SUBQUERY 1'))
  assert(pathPlan.some((row) => row.detail.includes('INTEGER PRIMARY KEY')))
})

Deno.test('buildReady counts a missing requires child as unresolved', () => {
  let w = world()
  let [row] = rowsFor(w.db, [w.urgent])
  assertEquals(
    buildReady(row, new Map([[row.eid, row]]), [{
      parent: row.eid,
      type: 'requires',
      child: uuid(),
    }]),
    false,
  )
})

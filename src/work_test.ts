// Work-lane readiness and candidate envelopes: managed dispatch and external
// workers share membership, while each keeps its own ordering. The db-backed
// cases also hold the lane reads to indexed, bounded graph queries.
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { type Change, idOf, uuid } from './types.ts'
import {
  buildWorkSql,
  evalBuildWork,
  evalDispatchWork,
  evalGraph,
  evalWork,
  rowsFor,
} from './graph_query.ts'
import { dispatchSpawn } from './dispatch.ts'
import { parseQuery } from './query.ts'
import { where } from './sql.ts'
import {
  buildReady,
  workCandidates,
  workFilters,
  type WorkRead,
} from './work.ts'

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
    {
      eid: gated,
      name: 'dependency',
      comp: { type: 'requires', child: blocker },
    },
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
    { eid: root, name: 'dependency', comp: { type: 'requires', child } },
    {
      eid: root,
      name: 'dependency',
      comp: { type: 'requires', child: declined },
    },
    ...task(heldGate, 'Pending boundary', 2, P, [{
      eid: heldGate,
      name: 'proposed',
      comp: {},
    }]),
    ...task(grandchild, 'Behind pending boundary', 2, P),
    {
      eid: root,
      name: 'dependency',
      comp: { type: 'requires', child: heldGate },
    },
    {
      eid: heldGate,
      name: 'dependency',
      comp: { type: 'requires', child: grandchild },
    },
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
    changes.push({
      eid: root,
      name: 'dependency',
      comp: {
        type: 'requires',
        child: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      },
    })
  }
  changes.push(
    {
      eid: root,
      name: 'dependency',
      comp: { type: 'requires', child: boundary },
    },
    {
      eid: boundary,
      name: 'dependency',
      comp: { type: 'requires', child: target },
    },
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
    changes.push({
      eid: candidate,
      name: 'dependency',
      comp: { type: 'requires', child },
    })
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
    {
      eid: root,
      name: 'dependency',
      comp: { type: 'requires', child: design },
    },
    {
      eid: design,
      name: 'dependency',
      comp: { type: 'requires', child: leaf },
    },
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
    { eid: root, name: 'dependency', comp: { type: 'requires', child: a } },
    { eid: a, name: 'dependency', comp: { type: 'requires', child: b } },
    { eid: b, name: 'dependency', comp: { type: 'requires', child: a } },
    { eid: b, name: 'dependency', comp: { type: 'requires', child: leaf } },
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
  for (let lane of ['evaluate', 'build'] as const) {
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
    {
      eid: proposed,
      name: 'dependency',
      comp: { type: 'requires', child: hidden },
    },
    {
      eid: proposed,
      name: 'dependency',
      comp: { type: 'requires', child: visible },
    },
    ...task(approved, 'Gated by hidden work', 1, P, [{
      eid: approved,
      name: 'decided',
      comp: {},
    }]),
    {
      eid: approved,
      name: 'dependency',
      comp: { type: 'requires', child: hidden },
    },
    ...task(hiddenRoot, 'SECRET ROOT', 1, P, [{
      eid: hiddenRoot,
      name: 'decided',
      comp: {},
    }]),
    { eid: hiddenRoot, name: 'quarantined', comp: {} },
    ...task(leaf, 'Unapproved leaf', 1, P),
    {
      eid: hiddenRoot,
      name: 'dependency',
      comp: { type: 'requires', child: leaf },
    },
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
      {
        eid: parent,
        name: 'dependency',
        comp: { type: 'requires', child: eid },
      },
    )
    parent = eid
  }
  changes.push({
    eid: parent,
    name: 'dependency',
    comp: { type: 'requires', child: leaf },
  })
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
      {
        eid: root,
        name: 'dependency',
        comp: { type: 'requires', child: leaf },
      },
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

Deno.test('lane membership queries compile to indexed component scans', () => {
  let w = world()
  for (let lane of ['evaluate', 'build'] as const) {
    let built = where(parseQuery(workFilters(lane).join('&')))
    assert(built, lane)
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
  assert(plan.some((row) => row.detail.includes('dependency_child')))
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

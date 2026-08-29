// Work-lane readiness and candidate envelopes: managed dispatch and external
// workers share membership, while each keeps its own ordering. The db-backed
// cases also hold the lane reads to indexed, bounded graph queries.
import { assert, assertEquals } from '@std/assert'
import { type Change, idOf, uuid } from './types.ts'
import { buildWorkSql, rowsFor, workBlockers } from './graph_query.ts'
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
  let query = localQuery(db)
  let read: WorkRead = {
    query,
    get: (ids) => Promise.resolve(rowsFor(db, ids)),
    deps: (eids) => Promise.resolve(depsOf(db, eids)),
    blockers: (eids, limit) => Promise.resolve(workBlockers(db, eids, limit)),
  }
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
  let read: WorkRead = {
    query: localQuery(db),
    get: (ids) => Promise.resolve(rowsFor(db, ids)),
    deps: (eids) => Promise.resolve(depsOf(db, eids)),
    blockers: (eids, limit) => Promise.resolve(workBlockers(db, eids, limit)),
  }
  let candidates = await workCandidates(read, 'build', { limit: 1 })
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
  let read: WorkRead = {
    query: localQuery(db),
    get: (ids) => Promise.resolve(rowsFor(db, ids)),
    deps: (eids) => Promise.resolve(depsOf(db, eids)),
    blockers: (eids, limit) => Promise.resolve(workBlockers(db, eids, limit)),
  }
  let ids = (await workCandidates(read, 'build', {
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
  let read: WorkRead = {
    query: localQuery(db),
    get: (ids) => Promise.resolve(rowsFor(db, ids)),
    deps: (eids) => Promise.resolve(depsOf(db, eids)),
    blockers: (eids, limit) => Promise.resolve(workBlockers(db, eids, limit)),
  }
  let [found] = await workCandidates(read, 'evaluate', { limit: 1 })
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

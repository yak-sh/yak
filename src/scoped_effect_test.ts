// The equivalence spine for the effect/sweep callers (T-3683, M-21143): dream,
// heal, knock and scribe used to hand a change-builder (memoryChanges,
// spawnChanges, spawnPlan, scribeSpawn) the WHOLE graph via rows(snapshot(db))
// and let it look three entities up. They now read just those entities off the
// live db (rowsFor / evalGraph / depsOf). This file proves the swap is
// BUILD-IDENTICAL: for a seeded graph, the builder fed the SCOPED set produces
// the same changes as the builder fed the materialized snapshot — the reference
// the scoped read must reproduce. Only the freshly minted eid/session-id differ
// (a new uuid per call), so those are masked; every RESOLVED reference
// (requested_task, persona, actor, memory scope) is held to the last field.
import { assertEquals } from '@std/assert'
import { uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, snapshot, depsOf, locate } = await import('./db.ts')
let { freshDb } = await import('./testdb.ts')
let { rows, spawnChanges, spawnPlan, memoryChanges, DESK, STUB } = await import(
  './client.ts'
)
let { rowsFor, evalGraph } = await import('./graph_query.ts')
let { providers } = await import('./adapters.ts')

// Minted-eid-blind comparison: mask the builder's own fresh primary eid and any
// fresh session.id it stamped, then hold everything else — every reference to a
// PRE-EXISTING entity is stable and must match.
let norm = (made: { eid: string; changes: unknown[] }) => {
  let s = JSON.stringify(made.changes)
  s = s.replaceAll(made.eid, '#EID')
  for (let c of made.changes as { name: string; comp?: { id?: unknown } }[]) {
    if (c.name == 'session' && c.comp?.id) {
      s = s.replaceAll(String(c.comp.id), '#SID')
    }
  }
  return s
}

let ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

// A graph with everything the four callers resolve: a project owning a bug task,
// a scribe desk + persona (project-owned, so spawnChanges reads an actor off the
// edge), a plain session, and a quiet stub session for the scribe queue.
let seed = () => {
  let db = freshDb()
  let [P, B, D, SC, SESS, STUBBED] = Array.from({ length: 6 }, () => uuid())
  apply(db, [
    { eid: P, name: 'entity', comp: { eid: P } },
    { eid: P, name: 'doc', comp: { title: 'Widgets' } },
    { eid: P, name: 'project', comp: {} },
    { eid: P, name: 'repo', comp: { path: '/w', base_branch: 'main' } },
    { eid: P, name: 'created', comp: { at: ago(9999) } },

    { eid: B, name: 'entity', comp: { eid: B } },
    { eid: B, name: 'doc', comp: { title: 'It broke', body: 'a stack' } },
    { eid: B, name: 'task', comp: { status: 'open', priority: 2, project: P } },
    { eid: B, name: 'bug', comp: { fault: 'boom' } },
    { eid: B, name: 'created', comp: { at: ago(9999) } },

    { eid: D, name: 'entity', comp: { eid: D } },
    { eid: D, name: 'doc', comp: { title: 'the desk' } },
    { eid: D, name: 'task', comp: { status: 'open', priority: 3, project: P } },
    { eid: D, name: 'alias', comp: { slug: DESK.task } },
    { eid: D, name: 'created', comp: { at: ago(9999) } },

    { eid: SC, name: 'entity', comp: { eid: SC } },
    { eid: SC, name: 'doc', comp: { title: 'scribe', body: 'you write' } },
    { eid: SC, name: 'persona', comp: { home: P } },
    { eid: SC, name: 'alias', comp: { slug: DESK.persona } },
    { eid: SC, name: 'created', comp: { at: ago(9999) } },
    // The persona's ownership edge — spawnChanges reads it for the run's actor.
    { eid: P, name: 'dependency', comp: { type: 'contains', child: SC } },

    { eid: SESS, name: 'entity', comp: { eid: SESS } },
    { eid: SESS, name: 'doc', comp: { title: 'a run' } },
    { eid: SESS, name: 'session', comp: { id: 's1' } },
    { eid: SESS, name: 'created', comp: { at: ago(120) } },

    { eid: STUBBED, name: 'entity', comp: { eid: STUBBED } },
    {
      eid: STUBBED,
      name: 'doc',
      comp: { title: 'wrapped', body: `${STUB} x` },
    },
    { eid: STUBBED, name: 'session', comp: { id: 's2' } },
    { eid: STUBBED, name: 'created', comp: { at: ago(120) } },
  ])
  return { db, P, B, D, SC, SESS }
}

// heal.ts ensureFixer: spawnChanges scoped to the bug task alone.
Deno.test('heal — spawnChanges over the scoped bug equals the snapshot', () => {
  let { db, B } = seed()
  let arg = { task: B, provider: 'claude', model: 'haiku' }
  let scoped = spawnChanges(rowsFor(db, [B]), arg)
  let full = spawnChanges(rows(snapshot(db)), arg)
  assertEquals(norm(scoped), norm(full))
})

// knock.ts rung 2: spawnPlan reads the task's hint, spawnChanges the task +
// planned persona. Both scoped to those, no deps (so no owner walk) — exactly
// as the caller passes them.
Deno.test('knock — spawnPlan + spawnChanges scoped equal the snapshot', () => {
  let { db, B } = seed()
  let ps = providers()
  let scopedPlan = spawnPlan(rowsFor(db, [B]), ps, { task: B })
  let fullPlan = spawnPlan(rows(snapshot(db)), ps, { task: B })
  assertEquals(scopedPlan, fullPlan)

  let arg = { task: B, provider: 'claude', model: 'haiku' }
  let scoped = spawnChanges(rowsFor(db, [B, scopedPlan.persona]), arg)
  let full = spawnChanges(rows(snapshot(db)), arg)
  assertEquals(norm(scoped), norm(full))
})

// dream.ts fileFinding: memoryChanges scoped to the session (find-or-mint by
// its id) and the scope project.
Deno.test('dream — memoryChanges scoped equals the snapshot', () => {
  let { db, P, SESS } = seed()
  let m = { title: 'a lesson', body: 'learned', session: 's1', scope: P }
  let scoped = memoryChanges(rowsFor(db, [SESS, P]), m)
  let full = memoryChanges(rows(snapshot(db)), m)
  // The session is reused, not minted, so its eid is stable both ways.
  assertEquals(norm(scoped), norm(full))
})

// scribe.ts scribeSweep: the scoped read (sessions by kind + the three named
// entities + the persona's neighbours) must build the same spawn as the whole
// graph, owner edge and all.
Deno.test('scribe — scribeSpawn over the scoped read equals the snapshot', async () => {
  let { db } = seed()
  let { scribeSpawn } = await import('./scribe.ts')
  // apply() server-stamps created.at to the wall clock, so read the graph from
  // an hour ahead — past the quiet window — to make the seeded stub due. Both
  // paths read the SAME now, so the equivalence is unaffected.
  let now = Date.now() + 3_600_000

  let persona = locate(db, DESK.persona)
  if (!persona) throw new Error('seed persona missing')
  let deps = depsOf(db, [persona])
  let neighbours = deps.flatMap((d) => [d.parent, d.child])
  let scopedAll = [
    ...evalGraph(db, '.kind=session').hits,
    ...rowsFor(db, [DESK.task, DESK.persona, ...neighbours]),
  ]
  let scoped = scribeSpawn(scopedAll, deps, now)

  let snap = snapshot(db)
  let full = scribeSpawn(rows(snap), snap.deps, now)

  // the stub session makes a spawn due on both paths
  if (!scoped || !full) throw new Error('expected a scribe spawn')
  assertEquals(
    norm({ eid: scoped[0].eid, changes: scoped }),
    norm({ eid: full[0].eid, changes: full }),
  )
})

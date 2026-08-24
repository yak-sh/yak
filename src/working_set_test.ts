// The working-set boot (M-21143 / T-18059): a joining serverQuery client is
// seeded the DEFINING sets (canvas chrome + this client's UI state) plus the
// entities its cards point at — NOT the whole graph. This holds the two facts
// the flip rests on: the boot INCLUDES the chrome + card targets, and EXCLUDES
// the long tail (memories, unpinned tasks) that a whole-graph snapshot shipped
// and that the SessionDot-class re-brick was made of. A future edit that lets a
// non-defining kind leak into the boot, or drops a card's target, fails here.
import { assertEquals } from '@std/assert'
import { uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { freshDb } = await import('./testdb.ts')
let { workingSet, WS_SETS } = await import('./graph_query.ts')

// eid → the components the working set shipped for it (empty = absent).
let seededAs = (
  changes: { eid: string; name: string }[],
) => {
  let by = new Map<string, Set<string>>()
  for (let c of changes) {
    let s = by.get(c.eid) ?? new Set<string>()
    s.add(c.name)
    by.set(c.eid, s)
  }
  return by
}

Deno.test('working set seeds the chrome + card targets, excludes the long tail', () => {
  let db = freshDb()
  let canvas = uuid(), card = uuid(), pinnedTask = uuid()
  let coldTask = uuid(), mem = uuid(), project = uuid()
  apply(db, [
    // The root canvas and a card on it pointing at a task — the chrome. A card
    // shows a target; a pin places it on the canvas.
    { eid: canvas, name: 'canvas', comp: {} },
    { eid: card, name: 'card', comp: { target: pinnedTask, view: 'text' } },
    { eid: card, name: 'pin', comp: { canvas, x: 0, y: 0, w: 1, h: 1, z: 0 } },
    // The pinned task IS reachable — one hop off the card.
    { eid: pinnedTask, name: 'doc', comp: { title: 'pinned', body: 'x' } },
    { eid: pinnedTask, name: 'task', comp: { status: 'open', priority: 0 } },
    // A project — a defining set (nav lists it).
    { eid: project, name: 'doc', comp: { title: 'Proj', body: '' } },
    { eid: project, name: 'project', comp: {} },
    // The long tail: a task on no canvas, and a memory. NEITHER is defining
    // and NEITHER is a card target — the whole-graph snapshot shipped both.
    { eid: coldTask, name: 'doc', comp: { title: 'cold', body: '' } },
    { eid: coldTask, name: 'task', comp: { status: 'open', priority: 0 } },
    { eid: mem, name: 'doc', comp: { title: 'a lesson', body: 'widgets rot' } },
    { eid: mem, name: 'memory', comp: {} },
  ])

  let snap = workingSet(db)
  let by = seededAs(snap.changes)

  // Included: the canvas chrome, the card, its one-hop target, the project.
  assertEquals(by.has(canvas), true, 'canvas in working set')
  assertEquals(by.has(card), true, 'card in working set')
  assertEquals(
    by.has(pinnedTask),
    true,
    'card target (pinned task) in working set',
  )
  assertEquals(by.has(project), true, 'project in working set')
  // The pinned task rides WHOLE — its task component too, not just the doc.
  assertEquals(
    by.get(pinnedTask)?.has('task'),
    true,
    'pinned task carries its task comp',
  )

  // Excluded: the long tail. This is the re-brick the flip removes.
  assertEquals(
    by.has(coldTask),
    false,
    'an unpinned task is NOT in the working set',
  )
  assertEquals(by.has(mem), false, 'a memory is NOT in the working set')
})

Deno.test('working set carries all edges and a live cursor', () => {
  let db = freshDb()
  let canvas = uuid(), card = uuid(), task = uuid()
  apply(db, [
    { eid: canvas, name: 'canvas', comp: {} },
    { eid: card, name: 'card', comp: { target: task, view: 'text' } },
    { eid: card, name: 'pin', comp: { canvas, x: 0, y: 0, w: 1, h: 1, z: 0 } },
    { eid: task, name: 'doc', comp: { title: 't', body: '' } },
    { eid: task, name: 'task', comp: { status: 'open', priority: 0 } },
    // An edge between two entities: the working set ships edges wholesale.
    // The parent IS the eid; the comp names the rest of the sentence.
    { eid: card, name: 'dependency', comp: { type: 'requires', child: task } },
  ])
  let snap = workingSet(db)
  // Edges ride wholesale (cheap; the client's index heals dangling refs).
  assertEquals(
    snap.deps.some((d) => d.parent == card && d.child == task),
    true,
    'the requires edge rides the working set',
  )
  // A real cursor and vocab so the client's handshake reconciles like any reset.
  assertEquals(typeof snap.cursor, 'number')
  assertEquals((snap.cursor ?? 0) > 0, true)
  assertEquals(typeof snap.vocabHash, 'string')
})

Deno.test('WS_SETS excludes .session! (the one unbounded kind)', () => {
  // Sessions are thousands and no boot-time chrome reads them: they must stream
  // via a view's own sub, never at every boot. A regression that re-adds them
  // reinstates most of the boot cost the flip removed.
  assertEquals(WS_SETS.includes('.session!'), false)
  assertEquals(WS_SETS.includes('.canvas!'), true)
})

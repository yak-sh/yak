// The working-set boot (M-21143 / T-18059): a joining serverQuery client is
// seeded the DEFINING sets (canvas chrome + this client's UI state) — NOT the
// whole graph. This holds the facts the flip rests on: the boot INCLUDES the
// chrome, and EXCLUDES the long tail (memories, unpinned tasks) that a
// whole-graph snapshot shipped and that the SessionDot-class re-brick was made
// of. It also holds the two things T-22371 took OUT, because both were
// whole-graph reads with no scoped door: every EDGE in the graph, and a one-hop
// walk from every card to whatever it pointed at. Each has a subscription now,
// so a future edit that puts either back in the boot fails here.
import { assertEquals } from '@std/assert'
import { link } from './edge.ts'
import { uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, depsOf } = await import('./db.ts')
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

Deno.test('working set seeds the chrome only, never the long tail', () => {
  let db = freshDb()
  let canvas = uuid(), card = uuid(), pinnedTask = uuid()
  let coldTask = uuid(), mem = uuid(), project = uuid()
  apply(db, [
    // The root canvas and a card on it pointing at a task — the chrome. A card
    // shows a target; a pin places it on the canvas.
    { eid: canvas, name: 'canvas', comp: {} },
    { eid: card, name: 'card', comp: { target: pinnedTask, view: 'text' } },
    { eid: card, name: 'pin', comp: { canvas, x: 0, y: 0, w: 1, h: 1, z: 0 } },
    // The pinned task is what the card points at. It is NOT boot cargo: the
    // Card holds a route sub for it (live.ts routeSub, T-22371).
    { eid: pinnedTask, name: 'doc', comp: { title: 'pinned', body: 'x' } },
    { eid: pinnedTask, name: 'task', comp: { priority: 0 } },
    // A project — a defining set (nav lists it).
    { eid: project, name: 'doc', comp: { title: 'Proj', body: '' } },
    { eid: project, name: 'project', comp: {} },
    // The long tail: a task on no canvas, and a memory. NEITHER is defining
    // and NEITHER is a card target — the whole-graph snapshot shipped both.
    { eid: coldTask, name: 'doc', comp: { title: 'cold', body: '' } },
    { eid: coldTask, name: 'task', comp: { priority: 0 } },
    { eid: mem, name: 'doc', comp: { title: 'a lesson', body: 'widgets rot' } },
    { eid: mem, name: 'memory', comp: {} },
  ])

  let snap = workingSet(db)
  let by = seededAs(snap.changes)

  // Included: the canvas chrome, the card, the project.
  assertEquals(by.has(canvas), true, 'canvas in working set')
  assertEquals(by.has(card), true, 'card in working set')
  assertEquals(by.has(project), true, 'project in working set')
  // NOT the card's target: preseeding it read one hop off every card in the
  // graph, for rows a client may never paint. The Card subscribes it instead.
  assertEquals(
    by.has(pinnedTask),
    false,
    'a card target is subscribed by the card, not preseeded',
  )

  // Excluded: the long tail. This is the re-brick the flip removes.
  assertEquals(
    by.has(coldTask),
    false,
    'an unpinned task is NOT in the working set',
  )
  assertEquals(by.has(mem), false, 'a memory is NOT in the working set')
})

Deno.test('working set carries NO edges — a rider delivers them scoped', () => {
  let db = freshDb()
  let canvas = uuid(), card = uuid(), task = uuid()
  apply(db, [
    { eid: canvas, name: 'canvas', comp: {} },
    { eid: card, name: 'card', comp: { target: task, view: 'text' } },
    { eid: card, name: 'pin', comp: { canvas, x: 0, y: 0, w: 1, h: 1, z: 0 } },
    { eid: task, name: 'doc', comp: { title: 't', body: '' } },
    { eid: task, name: 'task', comp: { priority: 0 } },
    // An edge between two entities. The boot used to ship every one of these
    // (4,909 on a copy of the live graph — 557 KB, 81% of the whole join frame)
    // because an edge had no other way to reach a client; the rider is that way
    // now.
    ...link(card, 'requires', task),
  ])
  let snap = workingSet(db)
  assertEquals(snap.deps, [], 'no edge rides the boot')
  // The SCOPED door answers the same edge for whoever subscribes an endpoint.
  assertEquals(
    depsOf(db, [card]).some((d) => d.parent == card && d.child == task),
    true,
    'the requires edge is incident to the card',
  )
  assertEquals(
    depsOf(db, [task]).some((d) => d.parent == card && d.child == task),
    true,
    'and incident to the child, read from the reverse endpoint',
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

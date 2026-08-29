// The action menu names claim holders with the same chip id as every claim
// flag.
import { assertEquals } from '@std/assert'
import { backlinks, cache, ent, reveal, revealed, shown } from '../live.ts'
import { actionsFor, applicable, resolve } from './registry.ts'
import './Entity.tsx'

Deno.test('boards open on Board with List still available', () => {
  cache.value = {
    board: {
      entity: { eid: 'board', num: 1 },
      doc: { eid: 'board', title: 'Board', body: '' },
      board: { eid: 'board' },
    },
  }
  assertEquals(applicable(ent('board')).slice(0, 2), ['Board', 'List'])
  cache.value = {}
})

Deno.test('sessions open on Session with Full still available', () => {
  cache.value = {
    session: {
      entity: { eid: 'session', num: 31 },
      doc: { eid: 'session', title: 'Session', body: '' },
      session: { eid: 'session', id: 'thread' },
    },
  }
  let session = ent('session')
  assertEquals(resolve(session).view, 'Session')
  assertEquals(applicable(session).slice(0, 2), ['Session', 'Full'])
  cache.value = {}
})

Deno.test('release names the session by its chip id', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      task: { eid: 'task', priority: 0 },
      claim: { eid: 'task', session: 'session' },
    },
    session: {
      entity: { eid: 'session', num: 31 },
      session: { eid: 'session', id: 'raw-session-uuid' },
    },
  }
  assertEquals(
    actionsFor(ent('task')).find((a) => a.label.startsWith('release'))?.label,
    'release S-31',
  )
  cache.value = {}
})

Deno.test('quarantine is hidden until revealed and can be cleared', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'unsafe', body: 'hidden' },
      task: { eid: 'task', priority: 0 },
      quarantined: { eid: 'task', at: 'now' },
    },
  }
  revealed.value = new Set()
  assertEquals(shown('task'), false)
  reveal('task')
  assertEquals(shown('task'), true)
  assertEquals(
    actionsFor(ent('task')).some((a) => a.label == 'unquarantine'),
    true,
  )
  cache.value = {}
  revealed.value = new Set()
})

Deno.test('a pending proposal keeps deletion named as deletion', () => {
  cache.value = {
    design: {
      entity: { eid: 'design', num: 45 },
      doc: { eid: 'design', title: 'A proposal', body: '' },
      design: { eid: 'design' },
      proposed: { eid: 'design', at: '2026-08-07T00:00:00.000Z' },
    },
  }
  let labels = () => actionsFor(ent('design')).map((a) => a.label)
  assertEquals(labels().includes('accept'), true)
  assertEquals(labels().includes('reject'), false)
  assertEquals(labels().includes('delete'), true)

  cache.value = {
    design: {
      ...cache.value.design,
      task: { eid: 'design', priority: 1 },
      cancelled: { eid: 'design' },
    },
  }
  assertEquals(labels().includes('accept'), false)
  assertEquals(labels().includes('delete'), true)

  cache.value = {
    design: {
      ...cache.value.design,
      decided: { eid: 'design', at: '2026-08-07T01:00:00.000Z' },
    },
  }
  assertEquals(labels().includes('accept'), false)
  assertEquals(labels().includes('reject'), false)
  assertEquals(labels().includes('delete'), true)
  cache.value = {}
})

Deno.test('a renamed view still resolves through the renames table', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'T', body: '' },
      task: { eid: 'task', priority: 0 },
    },
  }
  let e = ent('task')
  // Old view names (types.ts renames, `view:` namespace) heal to current
  // instead of falling to JSON — card.view is live data and old ?v= URLs
  // linger. The registry reads the ONE table, so this is that door proven: an
  // old name resolves to exactly what its current name resolves to (proving
  // the heal fired — without it 'Show' would fall to JSON, not to 'Full').
  assertEquals(resolve(e, 'Show').view, 'Full')
  assertEquals(resolve(e, 'Show').view, resolve(e, 'Full').view)
  assertEquals(resolve(e, 'Task.Row').view, resolve(e, 'Board.List.Tile').view)
  cache.value = {}
})

Deno.test('a role owns its lifecycle face, actions, and linked sessions', () => {
  cache.value = {
    role: {
      entity: { eid: 'role', num: 7 },
      doc: { eid: 'role', title: 'Coordinator', body: '' },
      role: {
        eid: 'role',
        state: 'running',
        surface: 'native',
        scope: 'project',
      },
    },
    session: {
      entity: { eid: 'session', num: 31 },
      session: { eid: 'session', id: 'thread', role: 'role' },
    },
  }
  let role = ent('role')
  assertEquals(resolve(role).view, 'Role')
  assertEquals(
    actionsFor(role).find((a) => a.label.includes('role'))?.label,
    'pause role',
  )
  assertEquals(actionsFor(role).some((a) => a.label == 'stop role'), true)
  assertEquals(
    backlinks(role.eid).some((b) => b.via == 'session.role'),
    true,
  )
  cache.value = {}
})

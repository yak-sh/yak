// The action menu names claim holders with the same chip id as every claim
// flag.
import { assertEquals } from '@std/assert'
import { backlinks, cache, ent } from '../live.ts'
import { actionsFor, resolve } from './registry.ts'
import './Entity.tsx'

Deno.test('release names the session by its chip id', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      task: { eid: 'task', status: 'open', priority: 0 },
      claim: { eid: 'task', session_eid: 'session' },
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

Deno.test('a pending proposal offers acceptance or rejection', () => {
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
  assertEquals(labels().includes('reject'), true)
  assertEquals(labels().includes('delete'), false)

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

Deno.test('a role owns its lifecycle face, actions, and linked sessions', () => {
  cache.value = {
    role: {
      entity: { eid: 'role', num: 7 },
      doc: { eid: 'role', title: 'Coordinator', body: '' },
      role: {
        eid: 'role',
        state: 'running',
        surface: 'native',
        scope_eid: 'project',
      },
    },
    session: {
      entity: { eid: 'session', num: 31 },
      session: { eid: 'session', id: 'thread', role_eid: 'role' },
    },
  }
  let role = ent('role')
  assertEquals(resolve(role).view, 'Role')
  assertEquals(
    actionsFor(role).find((a) => a.label.includes('role'))?.label,
    'stop role',
  )
  assertEquals(
    backlinks(role.eid).some((b) => b.via == 'session.role_eid'),
    true,
  )
  cache.value = {}
})

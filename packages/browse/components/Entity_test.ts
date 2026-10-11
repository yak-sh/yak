// The app's curated faces, actions and mounted Entity door preserve the same
// defaults and live behavior across the web and terminal hosts.
import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { useState } from 'preact/hooks'
import { parse } from '@yaks/query'
import { commentHost, configureComments } from '@yaks/kernel/comment-host'
import { applyLocal, cache, ent, reveal, revealed, shown } from '../live.ts'
import { type Ent, kindOf } from '../types.ts'
import { actionsFor, applicable, extend, resolve, ux } from './registry.ts'
import { Entity } from './Entity.tsx'
import { mount } from './mount.ts'

let fixture = (comps: Record<string, object>, eid = 'x', num = 1): Ent =>
  ({ eid, num, kind: kindOf(comps), refs: [], kids: [], ...comps }) as Ent

// Start the mounted host once; the test checks its hooks and live updates.
cache.value = {
  doc: {
    entity: { eid: 'doc', num: 1 },
    doc: { eid: 'doc', title: 'Page', body: '' },
  },
  task: {
    entity: { eid: 'task', num: 2 },
    doc: { eid: 'task', title: 'unsafe', body: 'hidden' },
    task: { eid: 'task' },
    filed: { eid: 'task', priority: 0 },
    quarantined: { eid: 'task', at: 'now' },
  },
}
extend([{
  view: 'Test.State',
  match: parse('.doc'),
  Render: ({ e, suffix }) => {
    let [count, set] = useState(0)
    return h(
      'button',
      { onClick: () => set(count + 1) },
      `${e.eid} ${e.doc!.title}${suffix} ${count}`,
    )
  },
}])
let { root, free } = mount(h(Entity, {
  eid: 'doc',
  view: 'Test.State',
  suffix: '!',
}))
let button = root.querySelector('button')!
test('Entity mounts hooks with the original Ent and extra props', async () => {
  try {
    assertEquals(root.textContent, 'doc Page! 0')
    button.click()
    await Promise.resolve()
    assertEquals(root.textContent, 'doc Page! 1')
    applyLocal([{ eid: 'doc', name: 'doc', comp: { title: 'Changed' } }])
    await Promise.resolve()
    assertEquals(root.textContent, 'doc Changed! 1')
  } finally {
    free()
  }
})

test('query groups preserve chosen tabs and default faces', () => {
  let project = fixture({ doc: { title: 'Project' }, project: {} })
  assertEquals(resolve(project).view, 'Full')
  assertEquals(applicable(project).includes('Dashboard'), true)
  assertEquals(
    applicable(fixture({ project: {} })).includes('Dashboard'),
    false,
  )
  for (let comp of ['board', 'canvas']) {
    assertEquals(applicable(fixture({ [comp]: {} })).includes('Split'), true)
  }
  assertEquals(applicable(fixture({ doc: {} })).includes('Split'), false)
})

test('boards open on Board with List still available', () => {
  let board = fixture({
    doc: { eid: 'board', title: 'Board', body: '' },
    board: { eid: 'board' },
  }, 'board')
  assertEquals(applicable(board).slice(0, 2), ['Board', 'List'])
})

test('sessions open on Session with Full still available', () => {
  let session = fixture(
    {
      doc: { eid: 'session', title: 'Session', body: '' },
      session: { eid: 'session', id: 'thread' },
    },
    'session',
    31,
  )
  assertEquals(resolve(session).view, 'Session')
  assertEquals(applicable(session).slice(0, 2), ['Session', 'Full'])
})

test('release names the session by its chip id', () => {
  let prior = commentHost()
  configureComments({
    ...prior,
    get: (eid) => {
      assertEquals(eid, 'session')
      return {
        entity: { eid, num: 31 },
        session: { id: 'raw-session-uuid' },
      }
    },
    id: ux.id,
  })
  try {
    let task = fixture({
      task: { eid: 'task' },
      filed: { eid: 'task', priority: 0 },
      claim: { eid: 'task', session: 'session' },
    }, 'task')
    assertEquals(
      actionsFor(task).find((a) => a.label.startsWith('release'))?.label,
      'release S-31',
    )
  } finally {
    configureComments(prior)
  }
})

test('quarantine is hidden until revealed and can be cleared', () => {
  revealed.value = new Set()
  try {
    assertEquals(shown('task'), false)
    reveal('task')
    assertEquals(shown('task'), true)
    assertEquals(
      actionsFor(ent('task')).some((a) => a.label == 'unquarantine'),
      true,
    )
  } finally {
    cache.value = {}
    revealed.value = new Set()
  }
})

test('a pending proposal keeps deletion named as deletion', () => {
  let design = fixture(
    {
      doc: { eid: 'design', title: 'A proposal', body: '' },
      design: { eid: 'design' },
      proposed: { eid: 'design', at: '2026-08-07T00:00:00.000Z' },
    },
    'design',
    45,
  )
  let labels = () => actionsFor(design).map((a) => a.label)
  assertEquals(labels().includes('approve'), true)
  assertEquals(labels().includes('decline'), true)
  assertEquals(labels().includes('delete'), true)

  // An OPEN task's approval arms dispatch, and the label says so.
  design = {
    ...design,
    task: { eid: 'design' },
    filed: { eid: 'design', priority: 1 },
  }
  assertEquals(labels().includes('approve · dispatches a coder'), true)
  assertEquals(labels().includes('decline'), true)

  design = { ...design, cancelled: { eid: 'design' } }
  assertEquals(labels().some((l) => l.startsWith('approve')), false)
  assertEquals(labels().includes('decline'), false)
  assertEquals(labels().includes('delete'), true)

  design = {
    ...design,
    decided: { eid: 'design', at: '2026-08-07T01:00:00.000Z' },
  }
  assertEquals(labels().some((l) => l.startsWith('approve')), false)
  assertEquals(labels().includes('decline'), false)
  assertEquals(labels().includes('delete'), true)
})

test('a role keeps its face without lifecycle actions', () => {
  let role = fixture(
    {
      doc: { eid: 'role', title: 'Coordinator', body: '' },
      role: { eid: 'role', surface: 'native', scope: null },
    },
    'role',
    7,
  )
  assertEquals(resolve(role).view, 'Role')
  assertEquals(actionsFor(role).some((a) => a.label.includes('role')), false)
})

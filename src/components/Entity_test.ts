// The app's curated faces, actions and mounted Entity door preserve the same
// defaults and live behavior across the web and terminal hosts.
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { useState } from 'preact/hooks'
import { parse } from '@yaks/query'
import {
  backlinks,
  cache,
  ent,
  reveal,
  revealed,
  shown,
  useRoute,
} from '../live.ts'
import { actionsFor, applicable, extend, resolve } from './registry.ts'
import { Entity } from './Entity.tsx'
import { mount } from './mount.ts'

// A mounted view holds subscriptions. In a test there is no server to hold
// them against, so control frames go nowhere through live.ts's transport
// seam — the cache here is only ever what the test seeds.
useRoute(() => {})

Deno.test('Entity mounts hooks with the original Ent and extra props', async () => {
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Page', body: '' },
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
  try {
    assertEquals(root.textContent, 'doc Page! 0')
    root.querySelector('button')!.click()
    await Promise.resolve()
    assertEquals(root.textContent, 'doc Page! 1')
    cache.value = {
      doc: {
        ...cache.value.doc,
        doc: { eid: 'doc', title: 'Changed', body: '' },
      },
    }
    await Promise.resolve()
    assertEquals(root.textContent, 'doc Changed! 1')
  } finally {
    free()
    cache.value = {}
  }
})

Deno.test('query groups preserve chosen tabs and default faces', () => {
  let fixture = (comps: Record<string, object>) => {
    cache.value = { x: { entity: { eid: 'x', num: 1 }, ...comps } }
    return ent('x')
  }
  try {
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
  } finally {
    cache.value = {}
  }
})

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
  assertEquals(labels().includes('approve'), true)
  assertEquals(labels().includes('decline'), true)
  assertEquals(labels().includes('delete'), true)

  // An OPEN task's approval arms dispatch, and the label says so.
  cache.value = {
    design: { ...cache.value.design, task: { eid: 'design', priority: 1 } },
  }
  assertEquals(labels().includes('approve · dispatches a coder'), true)
  assertEquals(labels().includes('decline'), true)

  cache.value = {
    design: { ...cache.value.design, cancelled: { eid: 'design' } },
  }
  assertEquals(labels().some((l) => l.startsWith('approve')), false)
  assertEquals(labels().includes('decline'), false)
  assertEquals(labels().includes('delete'), true)

  cache.value = {
    design: {
      ...cache.value.design,
      decided: { eid: 'design', at: '2026-08-07T01:00:00.000Z' },
    },
  }
  assertEquals(labels().some((l) => l.startsWith('approve')), false)
  assertEquals(labels().includes('decline'), false)
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

// The census derives from the vocabulary — held as a property: a comp
// added to types.ts appears in the admin's columns and sidebar with ZERO
// admin edits. The fixture comp is injected into the live comps object
// and removed again; if columnsFor had its own list, this test would
// have nothing to find.
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { adminRoute, columnsFor, groupedKinds } from './admin.ts'
import { Admin } from './Admin.tsx'
import { route } from './nav.tsx'
import { cache } from '../live.ts'
import { comps, kindOrder, stamped } from '../types.ts'
import { assertEquals } from '@std/assert'

Deno.test("columnsFor: a kind's columns ARE its vocabulary row", () => {
  let keys = columnsFor('task').map((c) => c.key)
  assertEquals(keys[0], 'id')
  assertEquals(keys[1], 'title')
  for (let prop of Object.keys(comps.task)) {
    assertEquals(keys.includes(prop), true)
  }
  assertEquals(keys[keys.length - 1], 'modified')
})

Deno.test('columnsFor: stamped columns render too', () => {
  // any vocabulary comp that also has stamped columns — found, not named,
  // so a comp rename never breaks the property being held
  let kind = Object.keys(stamped).find((k) => comps[k])!
  let keys = columnsFor(kind).map((c) => c.key)
  for (let prop of Object.keys(stamped[kind])) {
    assertEquals(keys.includes(prop), true)
  }
})

Deno.test('derivation: a new comp needs zero admin edits', () => {
  ;(comps as Record<string, Record<string, unknown>>).gadget = {
    size: 'number',
    owner_eid: { eid: '' },
  }
  kindOrder.push('gadget')
  try {
    let cols = columnsFor('gadget')
    assertEquals(cols.map((c) => c.key), [
      'id',
      'title',
      'size',
      'owner_eid',
      'modified',
    ])
    assertEquals(cols[2].t, 'number')
    assertEquals(groupedKinds().content.includes('gadget'), true)
  } finally {
    delete (comps as Record<string, unknown>).gadget
    kindOrder.pop()
  }
})

Deno.test('groupedKinds: sessions are content and machinery folds', () => {
  let { content, system } = groupedKinds()
  assertEquals(content.includes('task'), true)
  assertEquals(content.includes('memory'), true)
  assertEquals(content.includes('session'), true)
  assertEquals(system.includes('session'), false)
  assertEquals(system.includes('claim'), true)
  assertEquals(content.includes('claim'), false)
})

Deno.test('adminRoute: bare, kind, and new forms', () => {
  assertEquals(adminRoute('/admin'), { kind: 'task', form: false })
  assertEquals(adminRoute('/admin/memory'), { kind: 'memory', form: false })
  assertEquals(adminRoute('/admin/person/new'), { kind: 'person', form: true })
})

Deno.test('the index is a typed grid and grid mode is bare tiles', async () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let task = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  cache.value = {
    [project]: {
      entity: { eid: project, num: 1 },
      doc: { eid: project, title: 'Task Graph', body: '' },
      project: { eid: project },
    },
    [task]: {
      entity: { eid: task, num: 2 },
      doc: { eid: task, title: 'Ship it', body: '' },
      task: {
        eid: task,
        status: 'open',
        priority: 1,
        project_eid: project,
        assignee_eid: null,
        domain: null,
      },
    },
  }
  route.value = '/admin/task'
  let root = document.querySelector('main')!
  try {
    render(h(Admin, {}), root)
    let table = root.querySelector('.Admin_Table')!
    assertEquals(table.tagName, 'DIV')
    assertEquals(
      [...root.querySelectorAll('.Admin_Cell')].map((x) => x.textContent),
      ['T-2', 'Ship it', 'open', 'P1', 'Task Graph', '—', '—', ''],
    )

    let grid = [...root.querySelectorAll<HTMLButtonElement>('.Admin_Tool')]
      .find((x) => x.textContent == 'grid')!
    grid.dispatchEvent(
      new document.defaultView!.Event('click', { bubbles: true }),
    )
    await Promise.resolve()
    assertEquals(root.querySelector('.Admin_Grid > .TaskTile') != null, true)
    assertEquals(root.querySelector('.Admin_Grid > div > .TaskTile'), null)
  } finally {
    render(null, root)
    cache.value = {}
    route.value = '/'
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

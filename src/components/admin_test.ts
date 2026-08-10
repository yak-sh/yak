// The census derives from the vocabulary — held as a property: a comp
// added to types.ts appears in the admin's columns and sidebar with ZERO
// admin edits. The fixture comp is injected into the live comps object
// and removed again; if columnsFor had its own list, this test would
// have nothing to find.
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import {
  adminRoute,
  columnsFor,
  countsByPresence,
  groupedKinds,
  inSection,
} from './admin.ts'
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

// P-19's shape: a project that also wears an alias facet. kindOf(P-19) is
// 'project', so a kind filter would empty the alias section — presence
// lists it under both. A revert to r.kind == kind fails these.
let faceted = {
  eid: 'p',
  num: 19,
  kind: 'project',
  comps: { doc: {}, project: {}, alias: { slug: 'home' } },
}
let plain = { eid: 't', num: 2, kind: 'task', comps: { doc: {}, task: {} } }

Deno.test('inSection: an entity appears under every component it wears', () => {
  let rows = [faceted, plain]
  assertEquals(inSection(rows, 'alias'), [faceted])
  assertEquals(inSection(rows, 'project'), [faceted])
  // a plain entity lands only in its own section — presence == kind there
  assertEquals(inSection(rows, 'task'), [plain])
})

Deno.test('countsByPresence: each entity counts under every component', () => {
  let counts = countsByPresence([faceted, plain], ['project', 'alias', 'task'])
  assertEquals(counts.project, 1)
  assertEquals(counts.alias, 1)
  assertEquals(counts.task, 1)
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
    assertEquals(root.querySelector('.Admin_Grid > .Tile') != null, true)
    assertEquals(root.querySelector('.Admin_Grid > div > .Tile'), null)
  } finally {
    render(null, root)
    cache.value = {}
    route.value = '/'
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('an admin query deep link filters the index', async () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let home = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let away = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let mine = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  let other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  cache.value = {
    [home]: {
      entity: { eid: home, num: 19 },
      doc: { eid: home, title: 'Task Graph', body: '' },
      project: { eid: home },
    },
    [away]: {
      entity: { eid: away, num: 20 },
      doc: { eid: away, title: 'Elsewhere', body: '' },
      project: { eid: away },
    },
    [mine]: {
      entity: { eid: mine, num: 21 },
      doc: { eid: mine, title: 'Mine', body: '' },
      task: { eid: mine, status: 'open', priority: 1, project_eid: home },
    },
    [other]: {
      entity: { eid: other, num: 22 },
      doc: { eid: other, title: 'Other', body: '' },
      task: { eid: other, status: 'open', priority: 1, project_eid: away },
    },
  }
  route.value = '/admin/task?q=.task.project_eid%3DP-19'
  let root = document.querySelector('main')!
  try {
    render(h(Admin, {}), root)
    await Promise.resolve()
    assertEquals(root.textContent.includes('Mine'), true)
    assertEquals(root.textContent.includes('Other'), false)
  } finally {
    render(null, root)
    cache.value = {}
    route.value = '/'
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

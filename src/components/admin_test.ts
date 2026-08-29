// DOM-mount tests for the <Admin/> index view — these render the real view
// through Preact + linkedom, so they import the heavy Admin.tsx and cannot hit
// the 1ms budget. The PURE census-derivation tests moved to admin_logic_test.ts
// (light imports, sub-ms); keep only the render tests here.
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { Admin } from './Admin.tsx'
import { route } from './nav.tsx'
import { cache } from '../live.ts'
import { assertEquals } from '@std/assert'
import { until } from '../testing.ts'

// The index is a DB renderer: each section fetches `/query?.{kind}!`. Answer
// that fetch from the seeded cache bags, so these tests keep one source of
// truth; everything else falls through to the real fetch.
let stubFetch = () => {
  let real = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL) => {
    let m = String(input).match(/\/query\?\.(\w+)!/)
    if (!m) return real(input)
    let kind = m[1]
    let out = Object.values(cache.peek())
      .filter((bag) => (bag as Record<string, unknown>)[kind])
    return Promise.resolve(Response.json(out))
  }) as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}
// Preact runs effects on its ~100ms rAF-fallback clock under linkedom, so a
// fixed tick cannot cover the fetch round-trip — wait on the rendered fact.
let settle = (root: Element, sel = '.Admin_Cell') =>
  until(() => root.querySelector(sel), { label: sel })

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
        priority: 1,
        project: project,
        assignee: null,
        domain: null,
      },
    },
  }
  route.value = '/admin/task'
  let root = document.querySelector('main')!
  let restore = stubFetch()
  try {
    render(h(Admin, {}), root)
    await settle(root)
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
    restore()
    cache.value = {}
    route.value = '/'
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('facet pages list their carriers without widening task', async () => {
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
      entity: { eid: project, num: 19 },
      doc: { eid: project, title: 'Task Graph', body: '' },
      project: { eid: project },
      email: { eid: project, address: 'task@bot.yak.sh' },
      alias: { eid: project, slug: 'tasks' },
    },
    [task]: {
      entity: { eid: task, num: 20 },
      doc: { eid: task, title: 'Ship it', body: '' },
      task: { eid: task, priority: 1, project },
    },
  }
  let root = document.querySelector('main')!
  let restore = stubFetch()
  let texts = async (kind: string, lead: string) => {
    route.value = `/admin/${kind}`
    render(h(Admin, {}), root)
    // The section clears then refetches on kind change, so wait for a row of
    // THIS kind — any row could still be the outgoing section's.
    await until(
      () =>
        [...root.querySelectorAll('.Admin_Row:not(.Admin_Row-head)')]
          .some((x) => x.textContent?.startsWith(lead)),
      { label: kind },
    )
    return [...root.querySelectorAll('.Admin_Row:not(.Admin_Row-head)')]
      .map((x) => x.textContent)
  }
  try {
    assertEquals(await texts('email', 'P-19'), [
      'P-19Task Graphtask@bot.yak.sh',
    ])
    assertEquals(await texts('alias', 'P-19'), ['P-19Task Graphtasks—'])
    assertEquals(await texts('task', 'T-20'), ['T-20Ship itopenP1Task Graph——'])
  } finally {
    render(null, root)
    restore()
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
      task: { eid: mine, priority: 1, project: home },
    },
    [other]: {
      entity: { eid: other, num: 22 },
      doc: { eid: other, title: 'Other', body: '' },
      task: { eid: other, priority: 1, project: away },
    },
  }
  route.value = '/admin/task?q=.task.project%3DP-19'
  let root = document.querySelector('main')!
  let restore = stubFetch()
  try {
    render(h(Admin, {}), root)
    await settle(root)
    assertEquals(root.textContent.includes('Mine'), true)
    assertEquals(root.textContent.includes('Other'), false)
  } finally {
    render(null, root)
    restore()
    cache.value = {}
    route.value = '/'
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

/** @jsxImportSource preact */
// A project's inbox line names and opens the thing that asked for attention,
// in the policy's order, with the whole count above a bounded list.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import type { Row } from './reader.ts'
import type { Thread } from './threads.ts'
import { host, mount, press, shop, texts, wait } from './testing.tsx'

let project = { entity: { eid: 'venture', num: 1 }, project: {} }
let at = (n: number) => `2026-08-07T12:00:${String(n).padStart(2, '0')}.000Z`
// Tasks assigned to the venture, the newest last; `more` adds to each.
let work = (i: number) => `work${i}`
let assigned = (
  n: number,
  more: (i: number) => Record<string, unknown> = () => ({}),
) =>
  Array.from({ length: n }, (_, i): Bundle => ({
    entity: { eid: work(i), num: i + 2 },
    task: {},
    doc: { title: `Work ${i}`, body: '' },
    filed: { assignee: 'venture' },
    created: { at: at(i) },
    ...more(i),
  }))
let drawn = async (rows: Bundle[], ctx = {}) => {
  let g = await shop([project, ...rows])
  let h = host({ read: (l) => g.read(l) })
  let seen = mount(<h.Door e={project} view='Inbox' ctx={ctx} />)
  await wait(() => !!seen.root.querySelector('.Inbox_Summary'), 'the list')
  return { h, seen }
}

test('a line is in the policy’s order, and reading or archiving it marks its thread', async () => {
  let { h, seen } = await drawn(
    assigned(2, (i) => i == 1 ? { opened: { at: at(9) } } : {}),
  )
  try {
    assertEquals(texts(seen.root, '.Tile_Title'), ['Work 1', 'Work 0'])
    assertEquals(texts(seen.root, '.Inbox_Summary'), ['2 items · 1 unread'])
    assertEquals(
      [...seen.root.querySelectorAll('.Inbox_Thread .Dot')].map((d) =>
        d.getAttribute('title')
      ),
      ['read', 'unread'],
    )
    assertEquals(texts(seen.root, '.Inbox_Reason'), [
      'assigned to you',
      'assigned to you',
    ])
    assertEquals(seen.root.querySelectorAll('.Stamp').length, 2)
    // Opening the unread one reads it; the read one is left as it is.
    let lines = seen.root.querySelectorAll('.Inbox_Thread > div')
    await press(lines[0])
    await press(lines[1])
    await wait(() => h.applied.length == 1, 'one read mark')
    assertEquals(h.applied[0], [
      { entity: { eid: work(0) }, opened: null },
      { entity: { eid: work(0) }, opened: {} },
    ])
    await press(seen.root.querySelector('button[title=archive]'))
    await wait(() => h.applied.length == 2, 'an archive mark')
    assertEquals(h.applied[1], [
      { entity: { eid: work(1) }, archived: null },
      { entity: { eid: work(1) }, archived: {} },
    ])
  } finally {
    seen.free()
  }
})

test('a limited list keeps the whole count and bounds its lines', async () => {
  let { seen } = await drawn(assigned(10), { limit: 8 })
  try {
    assertEquals(texts(seen.root, '.Inbox_Summary'), ['10 items · 10 unread'])
    assertEquals(seen.root.querySelectorAll('.Inbox_Thread').length, 8)
    assertEquals(texts(seen.root, '.Inbox_Empty'), ['+2 more'])
  } finally {
    seen.free()
  }
})

test('a knock names and opens its target, with its own id beside', async () => {
  let target = {
    entity: { eid: 'printbound', num: 30 },
    doc: { title: 'PrintBound', body: '' },
    project: {},
  }
  let knock = {
    entity: { eid: 'knock', num: 2 },
    knock: { target: 'printbound' },
    deliver: { to: 'venture' },
    created: { at: at(1) },
  }
  let row = { eid: 'knock', comps: knock } as unknown as Row
  let thread: Thread<Row> = {
    eid: 'knock',
    row,
    latest: row,
    messages: [],
    lane: 'Needs you',
    reason: 'knock',
    blocking: false,
    at: at(1),
    unread: true,
  }
  let h = host({
    read: (l) =>
      l.startsWith('.inbox_summary')
        ? [{ entity: { eid: 'summary' }, inbox_summary: { threads: [thread] } }]
        : [target, knock],
  })
  let seen = mount(<h.Door e={project} view='Inbox' />)
  try {
    await wait(() => !!seen.root.querySelector('.Tile'), 'the line')
    assertEquals(texts(seen.root, '.Tile_Title'), ['PrintBound'])
    assertEquals(
      seen.root.querySelector('.Tile')?.getAttribute('href'),
      '/printbound',
    )
    assertEquals(texts(seen.root, '.Id'), ['#30', '#2'])
    assertEquals(texts(seen.root, '.Inbox_Reason'), ['knock'])
    assertEquals(
      seen.root.querySelector('.Dot')?.getAttribute('title'),
      'unread',
    )
  } finally {
    seen.free()
  }
})

test('an empty list names who it is for', () => {
  let h = host()
  h.hold([{ ...project, doc: { title: 'Venture' } }])
  let seen = mount(<h.Door e={project} view='Inbox' />)
  try {
    assertEquals(seen.root.textContent, 'nothing addressed to Venture yet')
  } finally {
    seen.free()
  }
})

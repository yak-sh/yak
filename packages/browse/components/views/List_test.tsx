// A board's list is a window the reader grows by scrolling: the next page
// lands below the rows already shown, and those rows stay while it loads.
import { test } from '@yaks/testing'
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { act } from 'preact/test-utils'
import type { Bundle } from '@yaks/graph'
import { applyLocal, cache, config, ent } from '../../live.ts'
import { host, reader } from '../../host_testing.ts'
import { entityPath } from '../../url.ts'
import { until } from '../../testing.ts'
import { idOf, uuid } from '../../types.ts'

// Enter through the registry, as the app does (Board_test.tsx).
await import('../Entity.tsx')
let { BoardList, ListEntry } = await import('./List.tsx')
let { mount } = await import('../mount.ts')

// Twelve tasks, newest last; the oldest was edited most recently.
let task = (n: number): Bundle => ({
  entity: {
    eid: `eeee4045-0000-4000-8000-${String(n).padStart(12, '0')}`,
    num: n,
  },
  doc: { title: `task ${n}` },
  task: {},
  created: { at: `2026-09-${String(n).padStart(2, '0')}T00:00:00Z` },
  ...n == 1 ? { updated: { at: '2026-09-26T00:00:00Z' } } : {},
})
let read = reader(Array.from({ length: 12 }, (_, i) => task(i + 1)))
let titles = (root: Element) =>
  [...root.querySelectorAll('.Row_Title')].map((n) => n.textContent)

test('a list grows by appending, and keeps its rows while it loads', async () => {
  let prior = config.host
  config.host = 'browser.test'
  cache.value = {}
  let wire = host()
  let board = uuid()
  applyLocal([
    { eid: board, name: 'entity', comp: { eid: board, num: 100 } },
    { eid: board, name: 'board', comp: { query: '.task' } },
  ])
  let mounted = mount(<BoardList e={ent(board)} />)
  // The nth page the list asks for, and its answer as the server gives it.
  let pages = () => wire.asked().filter((a) => a.subscribe.includes('.limit'))
  let page = async (n: number) => {
    await until(() => pages().length >= n)
    let ask = pages()[n - 1]
    return () =>
      act(() => wire.say({ id: ask.id, bundles: read(ask.subscribe) }))
  }
  try {
    let first = await page(1)
    assertEquals(
      mounted.root.querySelector('[role=status]')?.textContent,
      'Loading…',
    )
    assertEquals(mounted.root.textContent?.includes('No results.'), false)
    await act(() => wire.say({ id: pages()[0].id, bundles: [] }))
    assertEquals(mounted.root.querySelector('[role=status]'), null)
    assertEquals(mounted.root.textContent, 'No results.')
    await first()
    assertEquals(mounted.root.querySelector('[role=status]'), null)
    let shown = titles(mounted.root)
    assertEquals(shown.length, 10)
    assertEquals(
      [...mounted.root.querySelectorAll('.Rows_Kind')].map((n) =>
        n.textContent
      ),
      Array(10).fill('task'),
    )
    assertEquals(
      mounted.root.querySelector('.Rows')?.classList.contains('Rows-ruled'),
      true,
    )
    let more = [...mounted.root.querySelectorAll('button')]
      .find((b) => /more/.test(b.textContent ?? ''))!
    assertEquals(more.textContent?.trim(), 'Load more')
    await act(() => more.click())
    let grown = await page(2)
    assertEquals(titles(mounted.root), shown)
    assertEquals(
      mounted.root.querySelector('[role=status]')?.textContent,
      'Loading more…',
    )
    await grown()
    assertEquals(mounted.root.querySelector('[role=status]'), null)
    assertEquals(titles(mounted.root).slice(0, 10), shown)
    assertEquals(titles(mounted.root).length, 12)
  } finally {
    mounted.free()
    wire.free()
    cache.value = {}
    config.host = prior
  }
})

// A session has no numbered handle. Its secondary text is part of the same
// navigable entry as its heading, and a native link can open it in a new tab.
test('a favorite session opens from its whole entry, without a numbered handle', async () => {
  let id = uuid()
  applyLocal([
    { eid: id, name: 'entity', comp: { eid: id } },
    { eid: id, name: 'session', comp: {} },
    { eid: id, name: 'doc', comp: { title: 'Investigating the problem' } },
    { eid: id, name: 'brief', comp: { text: 'Found the cause' } },
    { eid: id, name: 'favorite', comp: {} },
  ])
  let mounted = mount(<ListEntry e={ent(id)} />)
  try {
    let brief = mounted.root.querySelector<HTMLElement>('.Rows_Kind')!
    assertEquals(
      brief.closest('a')?.getAttribute('href'),
      entityPath(idOf(ent(id))),
    )
    assertEquals(mounted.root.querySelectorAll('a a').length, 0)
  } finally {
    mounted.free()
  }
})

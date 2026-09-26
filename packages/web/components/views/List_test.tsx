// A board's list is a window the reader grows by scrolling: the next page
// lands below the rows already shown, and those rows stay while it loads.
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { act } from 'preact/test-utils'
import type { Bundle } from '@yaks/graph'
import { applyLocal, cache, config, ent } from '../../live.ts'
import { host, reader } from '../../host_testing.ts'
import { until } from '../../testing.ts'
import { uuid } from '../../types.ts'

// Enter through the registry, as the app does (Board_test.tsx).
await import('../Entity.tsx')
let { BoardList } = await import('./List.tsx')
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
  [...root.querySelectorAll('.Tile_Title')].map((n) => n.textContent)

Deno.test('a list grows by appending, and keeps its rows while it loads', async () => {
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
    await (await page(1))()
    let shown = titles(mounted.root)
    assertEquals(shown.length, 10)
    let more = [...mounted.root.querySelectorAll('button')]
      .find((b) => /more/.test(b.textContent ?? ''))!
    await act(() => more.click())
    let grown = await page(2)
    assertEquals(titles(mounted.root), shown)
    await grown()
    assertEquals(titles(mounted.root).slice(0, 10), shown)
    assertEquals(titles(mounted.root).length, 12)
  } finally {
    mounted.free()
    wire.free()
    cache.value = {}
    config.host = prior
  }
})

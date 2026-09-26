// Large board columns stay bounded until the operator asks for their tail.
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { act } from 'preact/test-utils'
import type { Bundle } from '@yaks/graph'
import { applyLocal, cache, config, ent } from '../../live.ts'
import { host, reader } from '../../host_testing.ts'
import { uuid } from '../../types.ts'
import {
  edgeRider,
  fieldsOf,
  orderOf,
  parseQuery,
  windowOf,
} from '../../query.ts'

// Enter through the registry, as the app does; importing Board first would
// invert its deliberate Entity render cycle.
await import('../Entity.tsx')
let { Board, columnLine, QuickAdd } = await import('./Board.tsx')
let { mount } = await import('../mount.ts')
let { tick, until } = await import('../../testing.ts')
let { drop } = await import('../drafts.ts')

Deno.test('board columns request a projected, priority-ordered screenful', () => {
  let q = columnLine('.task', 'open', 8)
  assertEquals(windowOf(parseQuery(q)), { limit: 8 })
  assertEquals(orderOf(parseQuery(q)), 'priority')
  assertEquals(edgeRider(parseQuery(q))?.limit, 32)
  assertEquals(fieldsOf(parseQuery(q))?.some((f) => f.prop == 'body'), false)
  assertEquals(windowOf(parseQuery(columnLine('.limit=3 .task', 'open', 8))), {
    limit: 3,
  })
  assertEquals(
    orderOf(parseQuery(columnLine('.task .order=hot', 'wip', 8))),
    'hot',
  )
  assertEquals(columnLine('', 'open', 8), '')
})

Deno.test('quick-add previews empty facets and ordinary properties', async () => {
  let key = `test:quick-add:${crypto.randomUUID()}`
  let mounted = mount(
    <QuickAdd dkey={key} file={() => true} close={() => {}} />,
  )
  try {
    let input = mounted.root.querySelector<HTMLTextAreaElement>('.Board_New')!
    input.setSelectionRange = () => {}
    input.value = '.design=true .architecture=false .domain=Eng Ship'
    input.dispatchEvent(
      new input.ownerDocument.defaultView!.Event('input', { bubbles: true }),
    )
    await tick()
    assertEquals(
      [...mounted.root.querySelectorAll('.Board_Chip')].map((e) =>
        e.textContent
      ),
      ['design=true', 'architecture=false', 'domain=Eng'],
    )
  } finally {
    mounted.free()
    drop(key)
  }
})

// Twenty-four open tasks, none prioritized: the column's order is their age.
let task = (n: number): Bundle => ({
  entity: {
    eid: `eeee4046-0000-4000-8000-${String(n).padStart(12, '0')}`,
    num: n,
  },
  doc: { title: `task ${n}` },
  task: {},
})
let read = reader(Array.from({ length: 24 }, (_, i) => task(i + 1)))

Deno.test('a column grows by appending, and keeps its rows while it loads', async () => {
  let prior = config.host
  config.host = 'browser.test'
  cache.value = {}
  let wire = host()
  let board = uuid()
  applyLocal([
    { eid: board, name: 'entity', comp: { eid: board, num: 100 } },
    { eid: board, name: 'board', comp: { query: '.task' } },
  ])
  let mounted = mount(<Board e={ent(board)} />)
  let open = () => wire.asked().filter((a) => a.subscribe.includes('=open'))
  let answer = (a: { id: string; subscribe: string }) =>
    act(() =>
      wire.say(
        a.subscribe.includes('.tally=')
          ? { id: a.id, tally: { open: 24 } }
          : { id: a.id, bundles: read(a.subscribe) },
      )
    )
  // The open column's rows, top to bottom.
  let shown = () =>
    [...mounted.root.querySelector('.Board_Col')!.querySelectorAll(
      '.Board_Item',
    )]
      .map((n) => n.getAttribute('data-eid'))
  try {
    await until(() => open().length)
    for (let a of wire.asked()) await answer(a)
    let first = shown()
    assertEquals(first.length, 10)
    let more = mounted.root.querySelector<HTMLElement>('.Board_More')!
    await act(() => more.click())
    await until(() => open().length > 1)
    assertEquals(shown(), first)
    await answer(open()[1])
    assertEquals(shown().slice(0, 10), first)
    assertEquals(shown().length, 20)
  } finally {
    mounted.free()
    wire.free()
    cache.value = {}
    config.host = prior
  }
})

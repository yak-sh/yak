// Large board columns stay bounded until the operator asks for their tail.
import { assertEquals } from '@std/assert'
import {
  edgeRider,
  fieldsOf,
  orderOf,
  parseQuery,
  windowOf,
} from '../../query.ts'

Deno.env.set('DB_PATH', ':memory:')

// Enter through the registry, as the app does; importing Board first would
// invert its deliberate Entity render cycle.
await import('../Entity.tsx')
let { Board, columnLine, QuickAdd } = await import('./Board.tsx')
let { apply } = await import('../../db.ts')
let { subserve } = await import('../../subserve.ts')
let { freshDb } = await import('../../testdb.ts')
let { uuid } = await import('../../types.ts')
let { cache, ent, landSub, resetSignals, useRoute } = await import(
  '../../live.ts'
)
let { mount } = await import('../mount.ts')
let { tick, until } = await import('../../testing.ts')
let { drop } = await import('../drafts.ts')

Deno.test('board columns request a projected, priority-ordered screenful', () => {
  let q = columnLine('.task!', 'open', 8)
  assertEquals(windowOf(parseQuery(q)), { limit: 8 })
  assertEquals(orderOf(parseQuery(q)), 'priority')
  assertEquals(edgeRider(parseQuery(q))?.limit, 32)
  assertEquals(fieldsOf(parseQuery(q))?.some((f) => f.prop == 'body'), false)
  assertEquals(windowOf(parseQuery(columnLine('.limit=3 .task!', 'open', 8))), {
    limit: 3,
  })
  assertEquals(
    orderOf(parseQuery(columnLine('.task! .order=hot', 'wip', 8))),
    'hot',
  )
  assertEquals(columnLine('', 'open', 8), '')
})

Deno.test('cold Board holds a page, grows on scroll, and releases its queries', async () => {
  let db = freshDb()
  let board = uuid()
  apply(db, [
    { eid: board, name: 'board', comp: { query: '.domain=tile-window' } },
  ])
  for (let i = 0; i < 35; i++) {
    let eid = uuid()
    apply(db, [
      { eid, name: 'task', comp: {} },
      { eid, name: 'filed', comp: { domain: 'tile-window', priority: i } },
      {
        eid,
        name: 'doc',
        comp: { title: `Visible ${i}`, body: 'not on a tile' },
      },
    ])
  }
  cache.value = {
    [board]: { board: { eid: board, query: '.domain=tile-window' } },
  }
  resetSignals()
  let sent: Record<string, unknown>[] = []
  let server = subserve(db, (f) => landSub(f as Parameters<typeof landSub>[0]))
  let prior = useRoute((f) => {
    sent.push(f as Record<string, unknown>)
    // No browser owner in this fixture: serve real working-set payloads,
    // not the legacy shadow's membership-only response.
    server.frame({ ...f as Record<string, unknown>, shadow: false })
  })
  let mounted = mount(<Board e={ent(board)} />)
  try {
    await until(() => mounted.root.querySelectorAll('.Board_Item').length > 0, {
      label: () => mounted.root.textContent ?? 'board rows',
    })
    let initial = mounted.root.querySelectorAll('.Board_Item').length
    assertEquals(initial > 0 && initial < 35, true)
    let q = sent.find((f) => String(f.q).includes('.status=open'))!
    assertEquals(initial, windowOf(parseQuery(String(q.q))).limit)
    let scroll = mounted.root.querySelector('.Board_Scroll')!
    for (let prop of ['scrollHeight', 'scrollTop', 'clientHeight']) {
      Object.defineProperty(scroll, prop, { value: 0 })
    }
    scroll.dispatchEvent(new scroll.ownerDocument.defaultView!.Event('scroll'))
    await until(() =>
      mounted.root.querySelectorAll('.Board_Item').length > initial
    )
    assertEquals(
      mounted.root.querySelectorAll('.Board_Item').length > initial,
      true,
    )
  } finally {
    mounted.free()
    await tick()
    for (
      let sub of new Set(
        sent.flatMap((f) =>
          typeof f.sub == 'string' && String(f.q).includes('.order=priority')
            ? [f.sub]
            : []
        ),
      )
    ) {
      assertEquals(
        sent.some((f) => f.unsub == sub),
        true,
        'unmounted page releases ' + sub,
      )
    }
    useRoute(prior)
    cache.value = {}
    resetSignals()
    db.close()
  }
})

Deno.test('quick-add previews empty facets and ordinary properties', async () => {
  let key = `test:quick-add:${crypto.randomUUID()}`
  let mounted = mount(
    <QuickAdd dkey={key} file={() => true} close={() => {}} />,
  )
  try {
    let input = mounted.root.querySelector<HTMLTextAreaElement>('.Board_New')!
    input.setSelectionRange = () => {}
    input.value = '.verifier=true .noverify=false .domain=Eng Ship'
    input.dispatchEvent(
      new input.ownerDocument.defaultView!.Event('input', { bubbles: true }),
    )
    await tick()
    assertEquals(
      [...mounted.root.querySelectorAll('.Board_Chip')].map((e) =>
        e.textContent
      ),
      ['verifier=true', 'noverify=false', 'domain=Eng'],
    )
  } finally {
    mounted.free()
    drop(key)
  }
})

Deno.test('a server refusal reaches a mounted Board with its retry identity', async () => {
  let db = freshDb()
  let a = uuid(), b = uuid()
  apply(db, [
    { eid: a, name: 'session', comp: { id: uuid() } },
    { eid: b, name: 'session', comp: { id: uuid() } },
  ])
  cache.value = {
    board: {
      entity: { eid: 'board', num: 1 },
      doc: { eid: 'board', title: 'Entries', body: '' },
      board: { eid: 'board', query: `.entry.session=${a},${b}` },
    },
  }
  resetSignals()
  let sent: Record<string, unknown>[] = []
  let server = subserve(
    db,
    (frame) => landSub(frame as Parameters<typeof landSub>[0]),
  )
  let prior = useRoute((frame) => {
    sent.push(frame as Record<string, unknown>)
    server.frame(frame as Record<string, unknown>)
  })
  let mounted: ReturnType<typeof mount> | undefined
  try {
    mounted = mount(<Board e={ent('board')} />)
    await tick()
    let failure = mounted.root.querySelector('.SubscriptionFailure')
    let sub = sent.find((f) => String(f.q).includes('.status=open'))!.sub
    assertEquals(
      failure?.textContent,
      'Query could not be loaded: entry pages require one scalar ' +
        '.entry.session= value; query each Session separately ' +
        `[subscription:${sub}] retry`,
    )
    assertEquals(mounted.root.querySelector('.Board_Col'), null)

    let before = sent.filter((f) => f.sub == sub).length
    mounted.root.querySelector<HTMLButtonElement>(
      '.SubscriptionFailure_Retry',
    )!.click()
    await tick()
    assertEquals(
      sent.filter((f) => f.sub == sub).length,
      before + 1,
    )
    assertEquals(
      mounted.root.querySelector('.SubscriptionFailure')?.textContent
        .includes('Retry requested.'),
      true,
    )
  } finally {
    mounted?.free()
    for (
      let sub of new Set(
        sent.flatMap((f) => typeof f.sub == 'string' ? [f.sub] : []),
      )
    ) {
      landSub({ sub, changes: [], replace: true })
    }
    useRoute(prior)
    cache.value = {}
    resetSignals()
    db.close()
  }
})

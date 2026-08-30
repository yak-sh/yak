// Large board columns stay bounded until the operator asks for their tail.
import { assertEquals } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')

// Enter through the registry, as the app does; importing Board first would
// invert its deliberate Entity render cycle.
await import('../Entity.tsx')
let { Board, CAP, QuickAdd, visible } = await import('./Board.tsx')
let { apply } = await import('../../db.ts')
let { subserve } = await import('../../subserve.ts')
let { freshDb } = await import('../../testdb.ts')
let { uuid } = await import('../../types.ts')
let { cache, ent, landSub, resetSignals, useRoute } = await import(
  '../../live.ts'
)
let { mount } = await import('../mount.ts')
let { tick } = await import('../../testing.ts')
let { drop } = await import('../drafts.ts')

Deno.test('board columns reveal a bounded first page and report the tail', () => {
  let rows = Array.from({ length: CAP + 7 }, (_, i) => i)
  assertEquals(visible(rows, false), {
    rows: rows.slice(0, CAP),
    more: 7,
  })
  assertEquals(visible(rows, true), { rows, more: 0 })
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
  let server = subserve(db, (json) => landSub(JSON.parse(json)))
  let prior = useRoute((frame) => {
    sent.push(frame as Record<string, unknown>)
    server.frame(frame as Record<string, unknown>)
  })
  let mounted: ReturnType<typeof mount> | undefined
  try {
    mounted = mount(<Board e={ent('board')} />)
    await tick()
    let failure = mounted.root.querySelector('.SubscriptionFailure')
    assertEquals(
      failure?.textContent,
      'Query could not be loaded: entry pages require one scalar ' +
        '.entry.session= value; query each Session separately ' +
        '[subscription:board:board] retry',
    )
    assertEquals(mounted.root.querySelector('.Board_Col'), null)

    let before = sent.filter((f) => f.sub == 'board:board').length
    mounted.root.querySelector<HTMLButtonElement>(
      '.SubscriptionFailure_Retry',
    )!.click()
    await tick()
    assertEquals(
      sent.filter((f) => f.sub == 'board:board').length,
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

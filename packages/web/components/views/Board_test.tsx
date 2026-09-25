// Large board columns stay bounded until the operator asks for their tail.
import '../../testing.ts'
import { assertEquals } from '@std/assert'
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

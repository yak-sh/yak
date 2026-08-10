// A wake reads from its clock and addressing facets, never a stored title.
import { render } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, ent } from '../../live.ts'
import { ago, pretty } from '../ui.tsx'
import { applicable, resolve } from '../Entity.tsx'
import { Wake, WakeTitle } from './Wake.tsx'

let at = new Date(Date.now() + 7_200_000).toISOString()
let data = (by: string, outcome: Record<string, unknown> = {}) => ({
  wake: {
    entity: { eid: 'wake', num: 1 },
    wake: { eid: 'wake', at },
    deliver: { eid: 'wake', to: 'recipient' },
    created: { eid: 'wake', by },
    ...outcome,
  },
  recipient: {
    entity: { eid: 'recipient', num: 2 },
    doc: { eid: 'recipient', title: 'Home', body: '' },
    project: { eid: 'recipient' },
  },
  creator: {
    entity: { eid: 'creator', num: 3 },
    doc: { eid: 'creator', title: 'Jeff', body: '' },
    person: { eid: 'creator' },
  },
})

Deno.test('wake owns the default view and derives its title', () => {
  cache.value = data('creator')
  let e = ent('wake')
  assertEquals(applicable(e)[0], 'Wake')
  assertEquals(resolve(e).Render, Wake)
  assertEquals(resolve(e, 'Card.Title').Render, WakeTitle)

  let title = WakeTitle({ e })
  let text = Array.isArray(title.props.children)
    ? title.props.children[2]
    : undefined
  assertEquals(text?.props.children, `wake P-2 · ${ago(at)}`)
  cache.value = {}
})

Deno.test('wake coordinates pending, delivered, and failed states', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let face = () => ({
    moment: root.querySelector('.Wake_Moment')?.className,
    state: root.querySelector('.Wake_Status')?.textContent,
    detail: root.querySelector('.Wake_Detail')?.textContent,
    dot: root.querySelector('.Dot')?.className,
  })
  try {
    cache.value = data('recipient')
    render(
      <>
        <WakeTitle e={ent('wake')} />
        <Wake e={ent('wake')} />
      </>,
      root,
    )
    assertEquals(face(), {
      moment: 'Wake_Moment Wake_Moment-pending',
      state: 'pending',
      detail: undefined,
      dot: 'Dot Dot-pending',
    })

    cache.value = data('recipient', {
      delivered: {
        eid: 'wake',
        at: '2026-08-10T14:00:00Z',
        via: 'knock K-9',
      },
    })
    render(
      <>
        <WakeTitle e={ent('wake')} />
        <Wake e={ent('wake')} />
      </>,
      root,
    )
    assertEquals(face(), {
      moment: 'Wake_Moment Wake_Moment-delivered',
      state: 'delivered',
      detail: 'via knock K-9',
      dot: 'Dot Dot-done',
    })

    cache.value = data('recipient', {
      error: {
        eid: 'wake',
        at: '2026-08-10T14:00:00Z',
        message: 'no door',
      },
    })
    render(
      <>
        <WakeTitle e={ent('wake')} />
        <Wake e={ent('wake')} />
      </>,
      root,
    )
    assertEquals(face(), {
      moment: 'Wake_Moment Wake_Moment-failed',
      state: 'failed',
      detail: 'no door',
      dot: 'Dot Dot-failed',
    })
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('wake shows its relative and exact time and addressed people', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  cache.value = data('creator')
  let root = document.querySelector('main')!
  try {
    render(<Wake e={ent('wake')} />, root)
    assertEquals(root.querySelector('.Wake_Relative')?.textContent, ago(at))
    assertEquals(root.querySelector('.Wake_Exact')?.textContent, pretty(at))
    assertEquals(
      [...root.querySelectorAll('.Wake_Label')].map((x) => x.textContent),
      ['deliver to', 'created by'],
    )
    assertEquals(
      [...root.querySelectorAll('.ListTile_Title')].map((x) => x.textContent),
      ['Home', 'Jeff'],
    )

    cache.value = data('recipient')
    render(<Wake e={ent('wake')} />, root)
    assertEquals(root.querySelectorAll('.Wake_Party').length, 1)
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

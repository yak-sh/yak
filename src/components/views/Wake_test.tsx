// A wake reads from its clock and addressing facets, never a stored title.
import { render } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, ent } from '../../live.ts'
import { ago, pretty } from '../ui.tsx'
import { applicable, resolve } from '../Entity.tsx'
import { Wake, WakeTitle } from './Wake.tsx'

let at = new Date(Date.now() + 3_600_000).toISOString()
let data = (by: string) => ({
  wake: {
    entity: { eid: 'wake', num: 1 },
    wake: { eid: 'wake', at },
    deliver: { eid: 'wake', to: 'recipient' },
    created: { eid: 'wake', by },
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
    ? title.props.children[1]
    : undefined
  assertEquals(text?.props.children, ['wake ', 'P-2', ' · ', ago(at)])
  cache.value = {}
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

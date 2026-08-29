// The prop registry's faces and edit doors: a PropType picks the words
// and the control that owns its value.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { editorFor, Prop } from './editors.tsx'
import { Prio } from './Prio.tsx'
import { ago, pretty } from './ui.tsx'
import { cache, ent } from '../live.ts'
import { formatProp, type Prop as PropRow } from '../props.ts'
import { idOf } from '../types.ts'
import { type PropType } from '../types.ts'

let prop = (type: PropType): PropRow => ({
  comp: 'test',
  prop: 'value',
  name: 'value',
  type,
})
let describe = (eid: string) => {
  if (!cache.value[eid]) return
  let e = ent(eid)
  return e.doc?.title || idOf(e)
}
let show = (t: PropType, v: unknown) =>
  editorFor(t)!.show!(formatProp(prop(t), v, { describe }), t)
// deno-lint-ignore no-explicit-any
let vn = (x: unknown) => x as any

Deno.test('the type picks its face', () => {
  // text is its own words (a fragment face)
  assertEquals(vn(show('text', 'hi')).props.children, 'hi')
  assertEquals(vn(show('number', 3)).props.children, '3')
  // a url face is an anchor whose href IS the value
  let a = vn(show('url', 'https://x.dev/'))
  assertEquals(a.type, 'a')
  assertEquals(a.props.href, 'https://x.dev/')
  assertEquals(a.props.children, 'https://x.dev/')
  // a time face wears relative words, the full stamp in the tooltip
  let iso = '2026-01-01T00:00:00Z'
  let s = vn(show('time', iso))
  assertEquals(s.type, 'span')
  assertEquals(s.props['data-tip'], pretty(iso))
  assertEquals(s.props.children, ago(iso))
  // empty shows nothing — Prop paints the ghost
  assertEquals(show('text', ''), null)
  assertEquals(show('time', null), null)
  assertEquals(show('url', null), null)
})

Deno.test('formatted scalars feed browser faces and badges', () => {
  let badge = vn(Prio({ p: 'p02' }))
  assertEquals(badge.props.children, 'P2')
  assertEquals(Prio({ p: null }), null)
  assertEquals(formatProp(prop('bool'), 'YES'), 'true')
  assertEquals(formatProp(prop('number'), '+01.0'), '1')
})

Deno.test('an eid face prefers its target title and falls back to id', () => {
  let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  cache.value = {
    [eid]: {
      entity: { eid, num: 5 },
      doc: { eid, title: 'Hello', body: '' },
    },
  }
  let t: PropType = { eid: '', death: 'keep' }
  assertEquals(vn(show(t, eid)).props.children, 'Hello')
  cache.value[eid]!.doc = undefined
  assertEquals(vn(show(t, eid)).props.children, 'E-5')
  assertEquals(show(t, null), null)
  cache.value = {}
})

Deno.test('a linked prop keeps a separate edit press', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let task = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let person = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  cache.value = {
    [task]: {
      entity: { eid: task, num: 1 },
      task: {
        eid: task,
        priority: 0,
        project: null,
        assignee: person,
        domain: null,
      },
    },
    [person]: {
      entity: { eid: person, num: 2 },
      doc: { eid: person, title: 'Jeff', body: '' },
      person: { eid: person },
    },
  }
  let root = document.querySelector('main')!
  try {
    render(
      h(Prop, {
        eid: task,
        comp: 'task',
        prop: 'assignee',
        editable: true,
        handle: true,
        name: 'assignee',
        show: (face) => h('a', { href: '/U-2' }, face),
      }),
      root,
    )
    assertEquals(root.querySelector('a')?.textContent, 'Jeff')
    let hand = root.querySelector('button')
    assertEquals(hand?.textContent, '▾')
    assertEquals(hand?.getAttribute('aria-label'), 'change assignee')
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('ago says the distance in words', () => {
  let now = Date.parse('2026-07-23T12:00:00Z')
  assertEquals(ago('2026-07-23T11:00:00Z', now), '1 hour ago')
  assertEquals(ago('2026-07-23T11:59:40Z', now), 'just now')
  assertEquals(ago('2026-07-21T12:00:00Z', now), '2 days ago')
  assertEquals(ago(null, now), '')
})

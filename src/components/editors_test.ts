// The prop registry's faces: the PropType picks its entry, the entry's
// show says the value the human way. Pure VNode inspection — no DOM.
import { assertEquals } from '@std/assert'
import { editorFor } from './editors.tsx'
import { ago, pretty } from './ui.tsx'
import { cache } from '../live.ts'
import { type PropType } from '../types.ts'

let show = (t: PropType, v: unknown) => editorFor(t)!.show!(v, t)
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

Deno.test('an eid face reads as its target title', () => {
  cache.value = {
    abc: {
      entity: { eid: 'abc', num: 5 },
      doc: { eid: 'abc', title: 'Hello', body: '' },
    },
  }
  let t: PropType = { eid: '', death: 'keep' }
  assertEquals(vn(show(t, 'abc')).props.children, 'Hello')
  assertEquals(vn(show(t, 'nope')).props.children, 'nope') // unknown: raw
  assertEquals(show(t, null), null)
  cache.value = {}
})

Deno.test('ago says the distance in words', () => {
  let now = Date.parse('2026-07-23T12:00:00Z')
  assertEquals(ago('2026-07-23T11:00:00Z', now), '1 hour ago')
  assertEquals(ago('2026-07-23T11:59:40Z', now), 'just now')
  assertEquals(ago('2026-07-21T12:00:00Z', now), '2 days ago')
  assertEquals(ago(null, now), '')
})

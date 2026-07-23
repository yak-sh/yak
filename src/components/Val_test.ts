// The untyped door dispatches on constructors and distinctive shapes —
// never a date-parse of prose. Unclaimed values fall back to String.
import { assertEquals } from '@std/assert'
import { faceFor, Val } from './Val.tsx'
import { View } from './View.tsx'
import { cache } from '../live.ts'

// deno-lint-ignore no-explicit-any
let vn = (x: unknown) => x as any

Deno.test('Val dispatches by shape', () => {
  cache.value = {
    abc: {
      entity: { eid: 'abc', num: 5, created_at: '2026-01-01T00:00:00Z' },
      doc: { eid: 'abc', title: 'Hello', body: '' },
      task: { eid: 'abc', status: 'open', priority: 0 },
    },
  }
  // a Date wears the time face
  assertEquals(
    vn(Val({ value: new Date('2026-01-01T00:00:00Z') })).type,
    'span',
  )
  // a URL is an anchor
  let u = vn(Val({ value: new URL('https://x.dev/') }))
  assertEquals(u.type, 'a')
  assertEquals(u.props.href, 'https://x.dev/')
  // an id-shaped string resolves through the cache to its Inline
  let id = vn(Val({ value: 'T-5' }))
  assertEquals(id.type, View)
  assertEquals(id.props.eid, 'abc')
  assertEquals(id.props.view, 'Inline')
  // an id that resolves to nothing, and plain prose, stay unclaimed
  assertEquals(faceFor('T-99'), undefined)
  assertEquals(faceFor('2026-01-01T00:00:00Z'), undefined)
  // the String fallback
  assertEquals(vn(Val({ value: 42 })).props.children, '42')
  assertEquals(vn(Val({ value: null })).props.children, '') // nil says nothing
  cache.value = {}
})

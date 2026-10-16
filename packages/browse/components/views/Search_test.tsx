// Search decorates real domain tiles; it never supplies a substitute title.
import { test } from '@yaks/testing'
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { applyLocal } from '../../live.ts'
import { hitOf, rowOf } from '../../client.ts'
import { Entity } from '../Entity.tsx'
import { mount } from '../mount.ts'
import { hitSlots } from './Search.tsx'

let cases = [
  {
    kind: 'mail',
    comps: {
      mail: {},
      doc: { title: '=?UTF-8?Q?Hello_=E2=9C=93?=', body: '' },
    },
    title: 'Hello ✓',
  },
  {
    kind: 'comment',
    comps: { comment: {}, doc: { body: 'Use the shared renderer' } },
    title: 'Use the shared renderer',
  },
  {
    kind: 'session',
    comps: { session: {}, brief: { text: 'Ship the update' } },
    title: 'Ship the update',
  },
]

for (let { kind, comps, title } of cases) {
  let eid = `search-${kind}`
  let bundle = { entity: { eid, num: 1 }, ...comps }
  applyLocal(
    Object.entries(bundle).map(([name, comp]) => ({
      eid,
      name,
      comp,
    })),
  )
  let seen = mount(
    h(Entity, { eid, view: 'Search.Tile', hit: hitOf(rowOf(bundle)) }),
  )
  test(`search preserves the ${kind} tile's own reading`, () => {
    let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
      value: seen.root.ownerDocument,
      configurable: true,
    })
    try {
      assertEquals(seen.root.textContent?.includes(title), true)
      assertEquals(
        seen.root.textContent?.toLowerCase().includes('untitled'),
        false,
      )
      assertEquals(
        seen.root.querySelector('a')?.getAttribute('href') != null,
        true,
      )
    } finally {
      seen.free()
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else delete (globalThis as { document?: unknown }).document
    }
  })
}

test('a generic unmarked search title does not override a domain title', () => {
  assertEquals(
    hitSlots(hitOf(rowOf({
      entity: { eid: 'search-title' },
      doc: { title: 'Generic fallback' },
    }))).title,
    undefined,
  )
})

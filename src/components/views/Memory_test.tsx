// The memory's list face: registry specificity and the three facts a row
// promises.
import { type ComponentChildren, type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { type Ent } from '../../types.ts'
import { resolve } from '../Entity.tsx'
import { Stamp } from '../ui.tsx'
import { Id } from './Inline.tsx'
import { MemoryTile } from './Memory.tsx'

let memory: Ent = {
  eid: 'memory',
  num: 42,
  kind: 'memory',
  refs: [],
  kids: [],
  doc: { eid: 'memory', title: 'Prefer examples over prose', body: '' },
  memory: {
    eid: 'memory',
    type: 'feedback',
    last_confirmed_at: '2026-07-25T12:00:00.000Z',
  },
}

let children = (v: VNode) =>
  (Array.isArray(v.props.children)
    ? v.props.children
    : [v.props.children]) as VNode[]

let text = (v: VNode): ComponentChildren => v.props.children

Deno.test('memory owns its list tile', () => {
  assertEquals(resolve(memory, 'List.Tile').Render, MemoryTile)
})

Deno.test('memory tile says type, index, confirmation age, and id', () => {
  let [type, title, stamp, id] = children(MemoryTile({ e: memory }))
  assertEquals(text(type), 'feedback')
  assertEquals(text(title), 'Prefer examples over prose')
  assertEquals(stamp.type === Stamp, true)
  assertEquals(stamp.props as unknown, {
    at: '2026-07-25T12:00:00.000Z',
    label: 'confirmed',
  })
  assertEquals(id.type === Id, true)
})

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
    last_confirmed_at: '2026-07-25T12:00:00.000Z',
  },
  feedback: { eid: 'memory' },
}

let children = (v: VNode) =>
  (Array.isArray(v.props.children) ? v.props.children : [v.props.children])
    .filter((x) => x !== undefined && x !== false) as VNode[]

let text = (v: VNode): ComponentChildren => v.props.children

Deno.test('memory owns its list tile', () => {
  assertEquals(resolve(memory, 'Tile').Render, MemoryTile)
})

Deno.test('memory tile says feedback, index, confirmation age, and id', () => {
  let [tag, title, stamp, id] = children(MemoryTile({ e: memory }))
  assertEquals(text(tag), 'feedback')
  assertEquals(text(title), 'Prefer examples over prose')
  assertEquals(stamp.type === Stamp, true)
  assertEquals(stamp.props as unknown, {
    at: '2026-07-25T12:00:00.000Z',
    label: 'confirmed',
  })
  assertEquals(id.type === Id, true)
})

// A memory that records nobody's correction shows no tag at all — the
// retired enum's other three values said only what the row already held.
Deno.test('memory tile: no feedback tag, no slot', () => {
  let { feedback: _gone, ...plain } = memory
  let [tag] = children(MemoryTile({ e: plain }))
  assertEquals(tag, null)
})

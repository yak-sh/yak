// A task tile owns the frame; its facts come through the shared Meta view.
import { type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { type Ent } from '../../types.ts'
import { TileSlot } from '../Tile.tsx'
import { TaskTile } from './TaskTile.tsx'

let children = (v: VNode) =>
  (Array.isArray(v.props.children) ? v.props.children : [v.props.children])
    .flat().filter(Boolean) as VNode[]

Deno.test('task tile delegates its dense meta row to the registry', () => {
  let e: Ent = {
    eid: 'task',
    num: 1,
    kind: 'task',
    doc: { eid: 'task', title: 'One row', body: '' },
    task: { eid: 'task', status: 'open', priority: 0 },
    refs: [],
    kids: [],
  }

  let before = <span>before</span>
  let after = <span>after</span>
  let opened = 0
  let tile = TaskTile({
    e,
    slots: { before, after },
    onOpen: () => opened++,
  })
  let parts = children(tile)
  let meta = parts[3]
  let props = meta.props as unknown as Record<string, unknown>
  assertEquals(tile.props.mod, ['task', 'dense'])
  assertEquals(parts[0].type === TileSlot, true)
  assertEquals(parts[0].props.children, before)
  assertEquals(props.eid, 'task')
  assertEquals(props.view, 'Meta')
  assertEquals(props.id, true)
  let tail = props.children as VNode
  assertEquals(tail.type === TileSlot, true)
  assertEquals(tail.props.children, after)
  tile.props.onClick({ metaKey: true } as MouseEvent)
  assertEquals(opened, 1)
})

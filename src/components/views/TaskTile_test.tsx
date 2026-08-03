// A task tile owns the frame; its facts come through the shared Meta view.
import { type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { type Ent } from '../../types.ts'
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

  let tile = TaskTile({ e })
  let meta = children(tile)[2]
  let props = meta.props as unknown as Record<string, unknown>
  assertEquals(tile.props.mod, 'dense')
  assertEquals(props, { eid: 'task', view: 'Meta', id: true })
})

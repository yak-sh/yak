import { type ComponentChild, type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { cache, ent } from '../../live.ts'
import { resolve } from '../Entity.tsx'
import { Chip } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Inline, TaskInline } from './Inline.tsx'

let vnode = (child: ComponentChild): child is VNode =>
  typeof child == 'object' && child != null &&
  'type' in child && 'props' in child

let nodes = (child: ComponentChild): VNode[] => {
  if (Array.isArray(child)) return child.flatMap(nodes)
  if (!vnode(child)) return []
  return [child, ...nodes(child.props.children)]
}

Deno.test('Inline renderers say the title without the id', () => {
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'A document', body: '' },
    },
    task: {
      entity: { eid: 'task', num: 2 },
      doc: { eid: 'task', title: 'A task', body: '' },
      task: { eid: 'task', status: 'open', priority: 1 },
    },
  }

  for (let [eid, title] of [['doc', 'A document'], ['task', 'A task']]) {
    let e = ent(eid)
    let task = eid == 'task'
    assertEquals(resolve(e, 'Inline').Render, task ? TaskInline : Inline)
    let line = Inline({ e, dot: task })
    let tree = nodes(line)
    assertEquals(tree.some((node) => node.type == Chip), false)
    assertEquals(tree.some((node) => node.type == Dot), task)
    assertEquals(tree.some((node) => node.props.children == title), true)
  }
  cache.value = {}
})

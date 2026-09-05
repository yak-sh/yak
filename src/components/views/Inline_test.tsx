import { type ComponentChild, h, type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { applyLocal, cache, ent } from '../../live.ts'
import { mount } from '../mount.ts'
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

// A dependency row paints a PEER: what an edge rider projected
// (`.edges.peers=task.status,doc.title` — subserve.ts peerPayload), which is
// the derived status and none of the marks it came from. The pip and the strike
// must read that, or a card lists its own done children as open.
Deno.test('a projected peer paints its settled status', () => {
  cache.value = {}
  // Landed the way the rider delivers it, so the test holds the peer's real
  // partial shape rather than a hand-built row that happens to agree.
  applyLocal([
    { eid: 'peer', name: 'entity', comp: { num: 3 } },
    { eid: 'peer', name: 'doc', comp: { title: 'A done child' } },
    { eid: 'peer', name: 'task', comp: { status: 'done' } },
  ])
  let { root, free } = mount(h(TaskInline, { e: ent('peer') }))
  try {
    assertEquals(root.querySelector('.Dot')?.getAttribute('title'), 'done')
    assertEquals(!!root.querySelector('.Inline_Title-settled'), true)
  } finally {
    free()
    cache.value = {}
  }
})

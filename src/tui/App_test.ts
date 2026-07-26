// TUI-only renderers keep the shared scalar language in their visible labels.
import { assertEquals } from '@std/assert'
import { type Ent } from '../types.ts'
import { overrides } from './App.tsx'

// deno-lint-ignore no-explicit-any
let find = (node: any, cls: string): any => {
  if (Array.isArray(node)) {
    for (let child of node) {
      let hit = find(child, cls)
      if (hit) return hit
    }
  }
  if (!node?.props) return
  if (node.props.class == cls) return node
  return find(node.props.children, cls)
}

Deno.test('the TUI task heading formats priority through its type', () => {
  let e: Ent = {
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    num: 1,
    kind: 'task',
    doc: {
      eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'One',
      body: '',
    },
    task: {
      eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'open',
      priority: 1.5,
    },
    refs: [],
    kids: [],
  }
  let render = overrides.find((r) => r.view == 'Full' && r.match(e))!.Render
  let heading = render({ e })
  assertEquals(find(heading, 'Task_Prio').props.children, 'P1.5')
})

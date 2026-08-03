// TUI-only renderers keep the shared scalar language in their visible labels.
import { assertEquals } from '@std/assert'
import { type Ent } from '../types.ts'
import { fit, key, overrides, spot, spots, trail } from './App.tsx'

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

Deno.test('j/k move the pane cursor, keyed by the entity we are in', () => {
  trail.value = []
  assertEquals(spot(), -1) // the board's cursor is over the query, not lines
  key('j')
  assertEquals(spots.value, {})

  trail.value = ['one']
  key('j')
  key('j')
  assertEquals(spot(), 2)
  key('k')
  assertEquals(spot(), 1)

  trail.value = ['one', 'two'] // a pane deeper starts at its own top
  assertEquals(spot(), 0)
  key('k')
  assertEquals(spot(), 0) // and k at the top stays there
  trail.value = ['one']
  assertEquals(spot(), 1) // stepping back returns to the line we left
})

Deno.test('a cursor the content shrank past comes back to the last line', () => {
  trail.value = ['one']
  spots.value = { one: 40 }
  fit(12)
  assertEquals(spot(), 11)
  fit(0)
  assertEquals(spot(), 0)
  trail.value = []
  fit(3) // nothing to fit at the board
  assertEquals(spot(), -1)
})

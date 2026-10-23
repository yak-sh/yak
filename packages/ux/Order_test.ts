// Rows put in order by dragging, on a page: a row dragged over the list marks
// where it would land, and dropped there it is put there; a list that puts
// nothing in order is a plain one.
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { DRAGGED } from './drag.ts'
import { landed, Order, orderAt } from './Order.ts'

let { document } = parseHTML('<html><body><main></main></body></html>')
let root = document.querySelector('main')!
let g = globalThis as { document?: unknown }
g.document = document

let sent: Bundle[] = []
let placed: [string, number][] = []
let state: Bundle = { entity: { eid: orderAt('test') } }
let draw = (ordered = true, open?: string) =>
  render(
    h(Order, {
      e: state,
      onChange: (b) => sent.push(b),
      ids: ['a', 'b', 'c'],
      row: (id) => h('p', {}, id),
      onPlace: ordered ? (id, at) => placed.push([id, at]) : undefined,
      open: (id) => id == open,
    }),
    root,
  )
let fire = (type: string, eid: string) => {
  let ev = new document.defaultView!.Event(type, { bubbles: true })
  Object.assign(ev, {
    dataTransfer: { types: [DRAGGED], getData: () => eid },
    clientY: -1,
  })
  root.querySelector('[role=list]')!.dispatchEvent(ev)
}

draw()
fire('dragover', '')
let over = sent.splice(0)
state = landed(state, 0)
draw()
let marked = [...root.querySelectorAll('.Rows_Item-before')].map((n) =>
  n.textContent
)
fire('drop', 'c')
let dropped = sent.splice(0)
draw(false)
let plain = root.querySelectorAll('[draggable]').length
draw(true, 'b')
let handles = [...root.querySelectorAll('[draggable]')].map((n) =>
  n.textContent
)
render(null, root)
delete g.document

test('a row dragged over the list marks where it would land', () => {
  equal(over, [landed(state, 0)])
  equal(marked, ['a'])
})

test('a row dropped between others is put there, and the mark goes', () => {
  equal(placed, [['c', 0]])
  equal(dropped, [landed(state, null)])
})

test('a list that puts nothing in order picks up no row', () => {
  equal(plain, 0)
})

test('a row open for reading and typing is no drag handle', () => {
  equal(handles, ['a', 'c'])
})

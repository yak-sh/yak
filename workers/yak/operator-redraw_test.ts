// The chat page's live updates (public/redraw.js), over linkedom: an
// entry a person opened stays open through every redraw, a row's own and the
// whole conversation's, nested ones too, and what they left closed stays closed.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { redraw } from './public/redraw.js'

let entry = (title: string, inside = '') =>
  `<details><summary>${title}</summary>${inside}</details>`
let row = (id: string, html: string) => `<div id="row-${id}">${html}</div>`
let told = entry(
  'What the Operator was told',
  entry('The 2 tools', entry('graph_query') + entry('app_files')),
)
let conversation = row('a', told) +
  row('b', entry('Details') + entry('Details'))

let page = () => {
  let { document } = parseHTML(`<main>${conversation}</main>`)
  let box = document.querySelector('main')!
  let opened = () =>
    [...box.querySelectorAll('details[open]')].map((d) =>
      `${d.closest('[id]')!.id} ${d.querySelector('summary')!.textContent}`
    )
  let open = (...at: [string, number][]) => {
    for (let [id, i] of at) {
      box.querySelector(`#row-${id}`)!.querySelectorAll('details')[i]
        .setAttribute('open', '')
    }
  }
  return { box, opened, open }
}

test('a redraw keeps open what the person opened, and only that', () => {
  let { box, opened, open } = page()
  open(['a', 0], ['a', 1], ['a', 3], ['b', 1])
  let want = [
    'row-a What the Operator was told',
    'row-a The 2 tools',
    'row-a app_files',
    'row-b Details',
  ]
  redraw(box.querySelector('#row-a')!, told)
  assertEquals(opened(), want)
  redraw(box, conversation + row('c', told))
  assertEquals(opened(), want)
  assertEquals(
    [...box.querySelectorAll('#row-b details')].map((d) =>
      d.hasAttribute('open')
    ),
    [false, true],
  )
})

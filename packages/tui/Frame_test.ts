import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { Frame } from './Frame.ts'
import { Scroll } from './Scroll.ts'
import { mount } from './harness.ts'

let panels = [
  { title: 'One', Render: () => h('div', null, 'first') },
  { title: 'Two', Render: () => h('div', null, 'second') },
]
let App = () =>
  h(
    Frame,
    { sidebar: panels, width: 10, min: 30 },
    h(Scroll, { id: 'log', grow: '1' }, h('div', null, 'body')),
  )

Deno.test('the sidebar sits beside the main column, panel by panel', async () => {
  let ui = await mount(App, 30, 6)
  assertEquals(ui.text().split('\n'), [
    'body                  One', // the sidebar keeps a 2-column gutter
    '                      first',
    '',
    '                      Two',
    '                      second',
    '',
  ])
  ui.free()
})

Deno.test('a narrow terminal folds the sidebar away', async () => {
  let ui = await mount(App, 20, 3)
  assertEquals(ui.text().split('\n'), ['body', '', ''])
  ui.free()
})

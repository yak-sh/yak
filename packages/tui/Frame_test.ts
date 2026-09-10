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

Deno.test('bounded panels share height rather than pushing sibling headings offscreen', async () => {
  let ui = await mount(
    () =>
      h(Frame, {
        min: 20,
        width: 12,
        sidebar: [
          {
            title: 'Many',
            bounded: true,
            Render: () =>
              h(
                'div',
                null,
                ...Array.from(
                  { length: 100 },
                  (_, i) => h('div', null, 'row ' + i),
                ),
              ),
          },
          {
            title: 'Other',
            bounded: true,
            Render: () => h('div', null, 'visible'),
          },
        ],
      }),
    40,
    12,
  )
  try {
    assertEquals(ui.text().includes('Other'), true)
    assertEquals(ui.text().includes('visible'), true)
    await ui.resize(40, 6)
    assertEquals(ui.text().includes('Other'), true)
  } finally {
    ui.free()
  }
})

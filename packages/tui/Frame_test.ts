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
    'body                One', // no blanket sidebar gutter
    '                    first',
    '',
    '                    Two',
    '                    second',
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

Deno.test('fit panels shrink and return their unused height to the expanding tree', async () => {
  let ui = await mount(
    () =>
      h(Frame, {
        min: 10,
        width: 20,
        sidebar: [
          {
            title: 'Sessions',
            bounded: true,
            Render: () =>
              h(
                'div',
                null,
                ...Array.from(
                  { length: 50 },
                  (_, i) => h('div', null, 'session ' + i),
                ),
              ),
          },
          {
            title: 'Tasks',
            bounded: true,
            fit: true,
            Render: () => h('div', null, 'one task'),
          },
          {
            title: 'Context',
            bounded: true,
            fit: true,
            Render: () => h('div', null, '100 tokens'),
          },
        ],
      }),
    40,
    20,
  )
  try {
    let lines = ui.text().split('\n')
    assertEquals(lines.findIndex((l) => l.includes('Tasks')) > 10, true)
    assertEquals(lines.findIndex((l) => l.includes('Context')), 17)
    await ui.resize(40, 9)
    assertEquals(ui.text().includes('Sessions'), true)
    assertEquals(ui.text().includes('Tasks'), true)
    assertEquals(ui.text().includes('Context'), true)
  } finally {
    ui.free()
  }
})

Deno.test('proportional terminal sidebar keeps its minimum and reflows on resize', async () => {
  let ui = await mount(
    () =>
      h(Frame, {
        ratio: 0.2,
        sidebar: [{ title: 'Side', Render: () => h('div', null, 'content') }],
      }, h('div', null, 'main')),
    90,
    5,
  )
  try {
    for (let [columns, width] of [[90, 30], [150, 30], [200, 40], [203, 40]]) {
      await ui.resize(columns, 5)
      assertEquals(ui.text().split('\n')[0].indexOf('Side'), columns - width)
    }
    await ui.resize(89, 5)
    assertEquals(ui.text().includes('Side'), false)
    assertEquals(ui.text().includes('main'), true)
  } finally {
    ui.free()
  }
})

Deno.test('fixed sidebar width remains the default on wide terminals', async () => {
  let ui = await mount(
    () => h(Frame, { sidebar: panels }, h('div', null, 'main')),
    200,
    6,
  )
  try {
    assertEquals(ui.text().split('\n')[0].indexOf('One'), 170)
  } finally {
    ui.free()
  }
})

Deno.test('proportional sidebar leaves room for the main column at small custom thresholds', async () => {
  let ui = await mount(
    () => h(Frame, { ratio: 1, min: 1, sidebar: panels }, h('div', null, 'M')),
    8,
    6,
  )
  try {
    assertEquals(ui.text().split('\n')[0], 'MOne')
  } finally {
    ui.free()
  }
})

// The app beside the chat as the server draws it, from the side's row of it,
// before what it is made of is in, and with it.
import { equal, test } from '@yaks/testing'
import { made, page, released, view } from './app-canvas_fixture_test.ts'

let drawn = (root: HTMLElement) => ({
  name: root.querySelector('.Identity_Text b')?.textContent,
  where: root.querySelector('.Identity_Text small, .Identity_Note')
    ?.textContent,
  open: root.querySelector('[data-open]')?.getAttribute('href') ?? null,
  stage: root.querySelector('[name=made][checked]')?.getAttribute('value'),
  busy: root.querySelector('.Talk_Stage')?.getAttribute('aria-busy') ?? null,
  frames: [...root.querySelectorAll('iframe')].map((f) =>
    f.getAttribute('src')
  ),
  keeps: [...root.querySelectorAll('[data-part=keeps] .Rows_Name')].map((e) =>
    e.textContent
  ),
})

test('a released app draws its head and live preview from its row at once, what it is made of busy until in', () => {
  equal(drawn(page(view(released()))), {
    name: 'Recipe box',
    where: 'plum.yaks.app/recipes',
    open: 'https://plum.yaks.app/recipes/',
    stage: 'preview',
    busy: 'true',
    frames: ['https://plum.yaks.app/recipes/'],
    keeps: [],
  })
})

test('an app not yet released opens what it keeps, and its draft once one holds a page', () => {
  let draft = 'https://plum.yaks.app/recipes/~abcdefabcdef/'
  equal(drawn(page(view(), made(['Recipe']))), {
    name: 'Recipe box',
    where: 'plum.yaks.app/recipes',
    open: null,
    stage: 'keeps',
    busy: null,
    frames: [],
    keeps: ['Recipe'],
  })
  let drafted = drawn(page(view(), made(['Recipe'], draft)))
  equal([drafted.stage, drafted.frames, drafted.open], [
    'preview',
    [draft],
    draft,
  ])
})

test('beside the live app, its draft is named for when it was last written, and nothing but the switch stands over the frames', () => {
  let draft = 'https://plum.yaks.app/recipes/~abcdefabcdef/'
  let at = new Date(Date.now() - 2 * 3600_000).toISOString()
  let root = page(view(released()), made(['Recipe'], draft, at))
  let part = root.querySelector('[data-part=preview]')!
  equal(
    [...part.querySelectorAll('.Check')].map((c) => c.textContent),
    ['Edited 2 hours ago', 'Live'],
  )
  equal(part.querySelectorAll('a, p').length, 0)
  equal(
    [...part.querySelectorAll('iframe')].map((f) => f.dataset.at),
    [draft, 'https://plum.yaks.app/recipes/'],
  )
})

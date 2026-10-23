/** Vim's keys walk a page: where a move lands, read from boxes, and the walk
 * over a document, here the terminal's, painted and measured. */
import { equal, ok, test } from '@yaks/testing'
import { h, render } from 'preact'
import { doc, install, place, screenful } from '@yaks/tui'
import { type Box, land, walk } from './keys.ts'

let at = (left: number, top: number, width = 10, height = 10): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})

test('a move lands on the nearest item that way, the beam first', () => {
  let cases: [
    string,
    (Box | undefined)[],
    number,
    Parameters<typeof land>[2],
    number | undefined,
  ][] = [
    // A wide title over a row of two: down lands on the row's first.
    ['title down', [at(0, 0, 100), at(0, 20), at(50, 20)], 0, 'down', 1],
    // The next row's item, though off to the side, beats one far below.
    ['next row first', [at(80, 0), at(0, 20), at(0, 300, 200)], 0, 'down', 1],
    // Aligned and near beats near and aside.
    ['beam', [at(0, 0), at(30, 15), at(0, 20)], 0, 'down', 2],
    // An item inside another, or beside it, is neither below nor above.
    ['inside', [at(0, 0, 100, 40), at(10, 10)], 0, 'down', undefined],
    ['beside', [at(0, 0), at(20, 0)], 0, 'up', undefined],
    // Left and right keep to the row.
    ['right', [at(0, 0), at(20, 30), at(40, 0)], 0, 'right', 2],
    ['left edge', [at(0, 0), at(20, 0)], 0, 'left', undefined],
    // Out of sight below or above is reached in reading order; never sideways.
    ['out of sight down', [at(0, 0), undefined], 0, 'down', 1],
    ['out of sight up', [undefined, at(0, 0)], 1, 'up', 0],
    ['out of sight right', [at(0, 0), undefined], 0, 'right', undefined],
    ['from out of sight', [at(0, 0), undefined, undefined], 1, 'down', 2],
    // From nowhere: the first in sight, or the last walking up.
    ['start down', [undefined, at(0, 0), at(0, 20)], -1, 'down', 1],
    ['start up', [undefined, at(0, 0), at(0, 20)], -1, 'up', 2],
    ['first', [undefined, at(0, 0)], 1, 'first', 0],
    ['last', [at(0, 0), undefined], 0, 'last', 1],
  ]
  for (let [name, boxes, from, move, want] of cases) {
    equal(land(boxes, from, move), want, name)
  }
  let view = at(0, 100, 100, 100)
  equal(land([at(0, 0), at(0, 120), at(0, 150)], -1, 'down', view), 1)
  equal(land([at(0, 0), at(0, 120), at(0, 300)], -1, 'up', view), 1)
})

// A page in the terminal: two links on a line, a button and a checkbox under
// them, a pressable row, a text box, and a button the sheet hides.
let screen = install()
let root = screen.root
let pressed = 0, went: string[] = []
render(
  h(
    'div',
    {},
    h(
      'div',
      {},
      h('a', { href: '/1' }, 'One'),
      '          ',
      h('a', { href: '/2' }, 'Two'),
    ),
    h(
      'div',
      {},
      h('button', {}, 'Three'),
      '        ',
      h('input', { type: 'checkbox' }),
    ),
    h('div', { tabIndex: 0, onClick: () => pressed++ }, 'Four'),
    h('textarea', { value: 'notes' }),
    h('button', { class: 'Gone' }, 'Gone'),
  ),
  root as unknown as Parameters<typeof render>[1],
)
let { lines, hidden } = screenful(root, 40, 10, { Gone: { hidden: true } })
place(lines, hidden)
let keys = walk({
  scope: () => root as unknown as Element,
  back: () => went.push('back'),
  forward: () => went.push('forward'),
})
let press = (key: string, shiftKey = false) => {
  let e = Object.assign(new Event('keydown', { cancelable: true }), {
    key,
    shiftKey,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  })
  Object.defineProperty(e, 'target', { value: doc.activeElement ?? root })
  keys(e as unknown as KeyboardEvent)
  return e.defaultPrevented
}
let focused = () =>
  doc.activeElement?.textContent || doc.activeElement?.localName
screen.free()

let walked = (...keys: string[]) => keys.map((k) => (press(k), focused()))

test('hjkl walk the painted page by where each item sits', () => {
  doc.activeElement?.blur()
  equal(walked('j', 'l', 'j', 'h', 'k', 'j', 'j'), [
    'One',
    'Two',
    'input',
    'Three',
    'One',
    'Three',
    'Four',
  ])
})

test('gg and G go to the first and the last item; a hidden one never counts', () => {
  root.querySelector('a')!.focus()
  equal(walked('G', 'g', 'g'), ['textarea', 'textarea', 'textarea'])
  root.querySelector('[tabindex]')!.focus()
  equal(walked('g', 'g'), ['Four', 'One'])
})

test('a field being typed into keeps every key', () => {
  let field = root.querySelector('textarea')!
  field.focus()
  equal(press('j'), false)
  equal(press('G'), false)
  equal(doc.activeElement, field)
})

test('Enter presses an item the platform would not, and leaves a link to it', () => {
  root.querySelector('[tabindex]')!.focus()
  pressed = 0
  ok(press('Enter'))
  equal(pressed, 1)
  root.querySelector('a')!.focus()
  equal(press('Enter'), false)
})

test('H and L go back and forward; Esc lets go of the item', () => {
  went = []
  press('H', true)
  press('L', true)
  equal(went, ['back', 'forward'])
  root.querySelector('a')!.focus()
  press('Escape')
  equal(doc.activeElement, null)
})

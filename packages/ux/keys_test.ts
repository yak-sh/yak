/** Vim's keys walk a page: where a move lands, read from boxes, and the walk
 * over a document, here the terminal's, painted and measured. */
import { equal, ok, test } from '@yaks/testing'
import { h, render } from 'preact'
import {
  doc,
  install,
  onNavigate,
  place,
  screenful,
  TElement,
  TText,
} from '@yaks/tui'
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
let paint = () => {
  let { lines, hidden } = screenful(root, 40, 10, { Gone: { hidden: true } })
  place(lines, hidden)
}
paint()
let keys = walk({
  surface: () => root as unknown as Element,
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
  keys.key(e as unknown as KeyboardEvent)
  return e.defaultPrevented
}
// The cursor's item, by its text or its tag; pointing at one puts the cursor
// there, and pointing at none takes it away.
let cursor = () => root.querySelector('[data-cursor]')
let on = () => cursor()?.textContent || cursor()?.localName
let point = (at = 'none') =>
  keys.point({ target: root.querySelector(at) ?? root } as unknown as Event)
let walked = (...keys: string[]) => keys.map((k) => (press(k), on()))
screen.free()

test('j and l move the cursor down and right, by where each item sits', () => {
  point()
  equal(walked('j', 'l', 'j'), ['One', 'Two', 'input'])
})

test('h and k move the cursor left and up, and never the focus', () => {
  point('input')
  equal(walked('h', 'k', 'j', 'j'), ['Three', 'One', 'Three', 'Four'])
  equal(doc.activeElement, null)
})

test('gg and G go to the first and the last item; a hidden one never counts', () => {
  point('a')
  equal(walked('G', 'g', 'g', 'G'), ['textarea', 'textarea', 'One', 'textarea'])
})

test('the cursor stands on a field and walks past it, typing nothing', () => {
  point('textarea')
  ok(press('k'))
  equal([on(), doc.activeElement], ['Four', null])
})

test('i types into the field from the cursor on; Esc leaves it, the cursor on it', () => {
  point('a')
  ok(press('i'))
  let field = root.querySelector('textarea')!
  equal([doc.activeElement, on()], [field, 'textarea'])
  equal([press('j'), press('G')], [false, false])
  press('Escape')
  field.blur()
  equal([doc.activeElement, on()], [null, 'textarea'])
})

test('Enter and Space press the item; a link pressed is followed', () => {
  let followed: string[] = []
  onNavigate((href) => followed.push(href))
  point('[tabindex]')
  pressed = 0
  ok(press('Enter'))
  ok(press(' '))
  equal(pressed, 2)
  point('a')
  press('Enter')
  equal(followed, ['/1'])
})

test('the layer in front takes the keys; Esc closes it, the cursor back where it was', () => {
  let menu = new TElement('div')
  menu.setAttribute('role', 'menu')
  for (let label of ['Open', 'Copy']) {
    let row = menu.appendChild(new TElement('div'))
    row.appendChild(new TElement('button')).appendChild(new TText(label))
  }
  menu.addEventListener('cancel', () => menu.remove())
  point('a[href="/2"]')
  root.appendChild(menu)
  paint()
  equal(walked('j', 'j', 'k', 'G', 'h'), [
    'Open',
    'Copy',
    'Open',
    'Copy',
    'Copy',
  ])
  ok(press('Escape'))
  equal([on(), menu.parentNode], ['Two', null])
  paint()
})

test('Esc and q pass by with nothing in front; H and L go back and forward', () => {
  point('a')
  went = []
  equal([press('Escape'), press('q')], [false, false])
  press('H', true)
  press('L', true)
  equal(went, ['back', 'forward'])
})

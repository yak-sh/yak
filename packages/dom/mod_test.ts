import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { install, onPaint, TElement, touch, TText } from './mod.ts'

let tick = () => Promise.resolve()

test('form fields retain values, focus and selection for shared editors', () => {
  let el = new TElement('textarea')
  el.value = 'precious draft'
  assertEquals(el.attr('value'), 'precious draft')
  el.focus()
  el.setSelectionRange(2, 5)
  assertEquals(el.ownerDocument.activeElement, el)
  assertEquals([el.selectionStart, el.selectionEnd], [2, 5])
  el.blur()
  assertEquals(el.ownerDocument.activeElement, null)
})

test('a mutation dirties the tree and one paint answers many touches', async () => {
  let painted = 0
  onPaint(() => painted++)
  let el = new TElement('div')
  el.appendChild(new TText('one'))
  el.setAttribute('class', 'Title')
  touch()
  assertEquals(painted, 0) // nothing paints inside the turn that dirtied it
  await tick()
  assertEquals(painted, 1)
  onPaint(() => {})
})

test('elements hold children, attributes and class', () => {
  let el = new TElement('div')
  let a = new TText('a'), b = new TText('b')
  el.appendChild(a)
  el.insertBefore(b, a)
  assertEquals(el.childNodes, [b, a])
  assertEquals(b.nextSibling, a)
  assertEquals(a.nextSibling, null)
  a.remove()
  assertEquals(el.childNodes, [b])
  el.className = 'Title Dim'
  assertEquals(el.attr('class'), 'Title Dim')
  el.setAttribute('scroll', 3)
  assertEquals(el.attr('scroll'), '3')
  el.removeAttribute('scroll')
  assertEquals(el.attr('scroll'), undefined)
})

test('install swaps the document and free puts back what was there', () => {
  let prior = { marker: true }
  Object.defineProperty(globalThis, 'document', {
    value: prior,
    configurable: true,
  })
  let { root, free } = install()
  assert(root instanceof TElement)
  assert((globalThis as { document?: unknown }).document != prior)
  assertEquals(
    ((globalThis as { document: { createElement: (t: string) => TElement } })
      .document.createElement('span')).localName,
    'span',
  )
  free()
  assertEquals((globalThis as { document?: unknown }).document, prior)
  delete (globalThis as { document?: unknown }).document
})

// A form of controls, each listening as a page would: what reached it.
let form = () => {
  let heard: string[] = []
  let el = (tag: string, attrs: Record<string, string> = {}) => {
    let n = new TElement(tag)
    for (let [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    for (let type of ['click', 'input', 'change', 'submit']) {
      n.addEventListener(type, (e: Event) => {
        if (e.target == n) heard.push(`${type} ${attrs.id ?? tag}`)
      })
    }
    return n
  }
  let root = el('form')
  let kids = {
    box: el('input', { type: 'checkbox', id: 'box' }),
    a: el('input', { type: 'radio', name: 'r', id: 'a' }),
    b: el('input', { type: 'radio', name: 'r', id: 'b' }),
    go: el('button', { id: 'go' }),
    plain: el('button', { type: 'button', id: 'plain' }),
  }
  for (let k of Object.values(kids)) root.appendChild(k)
  return { ...kids, root, heard }
}

test('a click does what a browser does for a control by itself', () => {
  let f = form()
  f.box.click()
  assert(f.box.checked && f.box.hasAttribute('checked'))
  f.box.click()
  assert(!f.box.checked)
  f.a.click()
  f.b.click()
  assertEquals([f.a.checked, f.b.checked], [false, true])
  f.go.click()
  f.plain.click()
  assertEquals(f.heard, [
    'click box',
    'input box',
    'change box',
    'click box',
    'input box',
    'change box',
    'click a',
    'input a',
    'change a',
    'click b',
    'input b',
    'change b',
    'click go',
    'submit form',
    'click plain',
  ])
})

test('a cancelled click leaves a control as it was', () => {
  let f = form()
  f.b.checked = true
  for (let n of [f.box, f.a, f.go]) {
    n.addEventListener('click', (e: Event) => e.preventDefault())
    n.click()
  }
  assertEquals([f.box.checked, f.a.checked, f.b.checked], [false, false, true])
  assertEquals(f.heard, ['click box', 'click a', 'click go'])
})

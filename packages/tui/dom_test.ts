import { assert, assertEquals } from '@std/assert'
import { install, onPaint, TElement, touch, TText } from './dom.ts'

let tick = () => Promise.resolve()

Deno.test('a mutation dirties the tree and one paint answers many touches', async () => {
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

Deno.test('elements hold children, attributes and class', () => {
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

Deno.test('install swaps the document and free puts back what was there', () => {
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

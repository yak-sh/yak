import { clock, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { assertEquals } from '@std/assert'
import { place, tips } from './parts.ts'

// Overlay placement is viewport geometry. The tiny element double keeps that
// seam fast and leaves component lifecycle to the browser probe.
let el = (h: number) => ({
  offsetWidth: 340,
  offsetHeight: h,
  style: { left: '', top: '' },
})

let put = (side: 'above' | 'below', h: number) => {
  let node = el(h)
  place(
    node as unknown as HTMLElement,
    new DOMRect(492, 392, 16, 16),
    side,
  )
  return node.style
}

test('a growing overlay stays inside the viewport', () => {
  Object.defineProperties(globalThis, {
    innerWidth: { value: 1000, configurable: true },
    innerHeight: { value: 800, configurable: true },
  })

  assertEquals(put('above', 120), { left: '330px', top: '268px' })
  assertEquals(put('above', 480), { left: '330px', top: '6px' })
  assertEquals(put('below', 480), { left: '330px', top: '314px' })
})

let documentOf = (
  content =
    '<button data-tip="Hide" aria-describedby="help"><svg></svg></button>',
) => {
  let { document, Event } = parseHTML(
    `<html><body>${content}</body></html>`,
  )
  let button = document.querySelector('button')!
  button.getBoundingClientRect = () => new DOMRect(20, 30, 20, 20)
  return { document: document as unknown as Document, button, Event }
}

test('a kit tooltip follows keyboard focus, describes the control and dismisses on Escape', () => {
  let { document, button, Event } = documentOf()
  tips(document)
  tips(document)
  button.dispatchEvent(new Event('focusin', { bubbles: true }))
  let tip = document.querySelector('[role=tooltip]')!
  assertEquals(tip.textContent, 'Hide')
  assertEquals(tip.className, 'Overlay Tip')
  assertEquals(button.getAttribute('aria-describedby'), 'help yak-tip')
  document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
  assertEquals(document.querySelector('[role=tooltip]'), null)
  assertEquals(button.getAttribute('aria-describedby'), 'help')
  button.dispatchEvent(new Event('focusin', { bubbles: true }))
  button.dispatchEvent(new Event('focusout', { bubbles: true }))
  assertEquals(document.querySelector('[role=tooltip]'), null)
})

test('a kit tooltip enters the top layer above each newly opened modal', () => {
  let { document, button, Event } = documentOf(
    '<dialog open><button data-tip="Hide"></button></dialog>',
  )
  let shown: Element[] = []
  let create = document.createElement.bind(document)
  Object.defineProperty(document, 'createElement', {
    value: (name: string) => {
      let node = create(name)
      node.showPopover = () => {
        assertEquals(node.isConnected, true)
        assertEquals(node.getAttribute('popover'), 'manual')
        shown.push(node)
      }
      return node
    },
  })
  tips(document)
  button.dispatchEvent(new Event('focusin', { bubbles: true }))
  let tip = document.querySelector('[role=tooltip]')!
  assertEquals(shown.length, 1)
  assertEquals(shown[0] === tip, true)
  assertEquals(tip.parentElement === button.parentElement, true)

  let modal = create('dialog')
  modal.setAttribute('open', '')
  modal.innerHTML = '<button data-tip="Close the new modal"></button>'
  document.body.appendChild(modal)
  let next = modal.querySelector('button')!
  next.getBoundingClientRect = button.getBoundingClientRect
  next.dispatchEvent(new Event('focusin', { bubbles: true }))
  assertEquals(shown.length, 2)
  assertEquals(shown[1] === tip, true)
  assertEquals(tip.parentElement === modal, true)
  assertEquals(tip.textContent, 'Close the new modal')
  assertEquals(button.hasAttribute('aria-describedby'), false)
  next.dispatchEvent(new Event('focusout', { bubbles: true }))
  assertEquals(tip.isConnected, false)
})

test('without native popovers a kit tooltip stays inside the innermost open dialog', () => {
  let { document, button, Event } = documentOf(
    '<dialog open><dialog open><button data-tip="Hide"></button></dialog></dialog>',
  )
  tips(document)
  button.dispatchEvent(new Event('focusin', { bubbles: true }))
  let tip = document.querySelector('[role=tooltip]')!
  assertEquals(tip.parentElement === button.parentElement, true)
  assertEquals(tip.textContent, 'Hide')
})

test('a kit tooltip appears after pointer hover and cancels when the pointer leaves', async () => {
  let { document, button, Event } = documentOf()
  let time = clock()
  tips(document, time)
  let point = (type: string) =>
    button.querySelector('svg')!.dispatchEvent(
      new Event(type, { bubbles: true }),
    )
  point('pointerover')
  assertEquals(document.querySelector('[role=tooltip]'), null)
  await time.advance(300)
  assertEquals(document.querySelector('[role=tooltip]')?.textContent, 'Hide')
  point('pointerout')
  assertEquals(document.querySelector('[role=tooltip]'), null)
  point('pointerover')
  point('pointerout')
  await time.advance(300)
  assertEquals(document.querySelector('[role=tooltip]'), null)
})

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { menus } from './menus.ts'

let { document, Event } = parseHTML(`<html><body><div id="home">
  <button data-menu-trigger="actions" aria-expanded="false">a moment ago</button>
  <div id="actions" role="menu" hidden><button role="menuitem">Copy</button><button role="menuitem">Quote</button></div>
  </div><button id="outside">Elsewhere</button></body></html>`)
let trigger = document.querySelector<HTMLElement>('[data-menu-trigger]')!
let panel = document.getElementById('actions')!
Object.defineProperties(panel, {
  offsetWidth: { value: 180 },
  offsetHeight: { value: 160 },
})
let focused = ''
for (let node of document.querySelectorAll<HTMLElement>('button')) {
  node.focus = () => void (focused = node.textContent!)
}
trigger.getBoundingClientRect = () => new DOMRect(260, 520, 60, 20)
let click = (node: Element) =>
  node.dispatchEvent(new Event('click', { bubbles: true }))
let key = (node: Element, key: string) =>
  node.dispatchEvent(
    Object.assign(new Event('keydown', { bubbles: true }), { key }),
  )
menus(document as unknown as Document)

test('a timestamp menu escapes clipping, closes after an action and outside clicks, and returns focus on Escape', () => {
  let width = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth')
  let height = Object.getOwnPropertyDescriptor(globalThis, 'innerHeight')
  try {
    Object.defineProperties(globalThis, {
      innerWidth: { value: 320, configurable: true },
      innerHeight: { value: 600, configurable: true },
    })
    click(trigger)
    assertEquals(panel.parentElement, document.body)
    assertEquals([panel.style.left, panel.style.top], ['134px', '356px'])
    assertEquals(panel.hidden, false)
    assertEquals(trigger.getAttribute('aria-expanded'), 'true')
    assertEquals(focused, 'Copy')
    key(panel.firstElementChild!, 'ArrowDown')
    assertEquals(focused, 'Quote')
    key(panel.lastElementChild!, 'Escape')
    assertEquals(panel.hidden, true)
    assertEquals(panel.parentElement?.id, 'home')
    assertEquals(focused, 'a moment ago')
    key(trigger, 'ArrowDown')
    click(document.getElementById('outside')!)
    assertEquals(panel.hidden, true)
    click(trigger)
    click(panel.firstElementChild!)
    assertEquals(panel.hidden, true)
    assertEquals(trigger.getAttribute('aria-expanded'), 'false')
  } finally {
    if (width) Object.defineProperty(globalThis, 'innerWidth', width)
    else Reflect.deleteProperty(globalThis, 'innerWidth')
    if (height) Object.defineProperty(globalThis, 'innerHeight', height)
    else Reflect.deleteProperty(globalThis, 'innerHeight')
  }
})

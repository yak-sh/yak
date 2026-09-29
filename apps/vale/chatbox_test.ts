// Chat shortcuts belong to gameplay while text fields keep their own keys.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { chatbox } from './chatbox.ts'
import type { overlay } from './fx.ts'
import type { Net } from './net.ts'
import type { Village } from './village.ts'

test('chat shortcuts focus a line without taking another field’s keys', () => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let keys = ['document', 'HTMLElement', 'addEventListener'] as const
  let before = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key)
  )
  for (
    let [key, value] of Object.entries({
      document,
      HTMLElement: window.HTMLElement,
      addEventListener: window.addEventListener.bind(window),
    })
  ) Object.defineProperty(globalThis, key, { configurable: true, value })
  try {
    let glass = document.createElement('div')
    let opener = document.createElement('button')
    document.body.append(glass, opener)
    let chat = chatbox(
      glass,
      opener,
      { now: () => 1 } as Net,
      {} as ReturnType<typeof overlay>,
      {} as Village,
    )
    chat.me({
      person: 'player',
      name: 'Player',
      role: null,
      reads: true,
      writes: true,
      signIn: null,
    })
    let form = glass.querySelector('form')!
    let input = glass.querySelector('input')!
    let focused = false
    input.focus = () => focused = true
    input.blur = () => focused = false
    let press = (target: HTMLElement, key: string, mods = {}) => {
      let e = Object.assign(
        new window.Event('keydown', { bubbles: true, cancelable: true }),
        { key, ...mods },
      )
      target.dispatchEvent(e)
      return e
    }
    let click = () => opener.dispatchEvent(new window.Event('click'))

    input.value = 'old draft'
    let slash = press(document.body, '/')
    assertEquals(slash.defaultPrevented, true)
    assertEquals(form.hidden, false)
    assertEquals(focused, true)
    assertEquals(input.value, '/')

    input.value = '/help'
    assertEquals(press(input, '/').defaultPrevented, false)
    assertEquals(input.value, '/help')
    press(input, 'Escape')
    assertEquals(form.hidden, true)
    assertEquals(focused, false)

    for (let tag of ['input', 'textarea', 'select', 'div']) {
      let field = document.createElement(tag)
      if (tag == 'div') field.setAttribute('contenteditable', 'true')
      document.body.append(field)
      assertEquals(press(field, '/').defaultPrevented, false)
      assertEquals(form.hidden, true)
    }
    assertEquals(
      press(document.body, '/', { ctrlKey: true }).defaultPrevented,
      false,
    )
    assertEquals(form.hidden, true)
    glass.hidden = true
    assertEquals(press(document.body, '/').defaultPrevented, false)
    glass.hidden = false

    input.value = ''
    assertEquals(press(document.body, 'Enter').defaultPrevented, true)
    assertEquals(form.hidden, false)
    assertEquals(focused, true)
    assertEquals(input.value, '')
    click()
    assertEquals(form.hidden, true)
    click()
    assertEquals(form.hidden, false)
    press(input, 'Escape')
    assertEquals(form.hidden, true)
  } finally {
    keys.forEach((key, i) => {
      if (before[i]) Object.defineProperty(globalThis, key, before[i]!)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
})

// Journal selection keeps list identity; tracking updates the selected quest.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { journal, type Task } from './journal.ts'

let task: Task = {
  id: 'errand',
  title: 'A long quest & its reward',
  giver: 'someone',
  from: 'Someone',
  level: '',
  gives: '10 xp',
  says: 'Bring it back.',
  state: 'taken',
  pinned: true,
  steps: [{ text: 'Gather things', have: 1, need: 3, done: false, level: '' }],
}

test('journal selection and pin changes preserve list scroll and quest meaning', () => {
  let { document, window } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let body = document.querySelector<HTMLElement>('main')!
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  Object.defineProperty(globalThis, 'Element', {
    value: window.Element,
    configurable: true,
  })
  try {
    let pins: [string, boolean][] = []
    let book = journal({
      body,
      open: true,
      show: () => {},
      close: () => {},
      toggle: () => {},
    }, { pin: (id, on) => pins.push([id, on]) })
    book.show([task], '')
    let list = body.querySelector<HTMLElement>('.Split_List')!
    let row = list.querySelector<HTMLElement>('[data-select]')!
    let title = row.querySelector('b')!
    let icon = row.querySelector('svg')!
    assertEquals(title.textContent, task.title)
    assertEquals(title.parentNode, icon.parentNode)
    assertEquals(title.parentNode!.textContent, task.title)
    assertEquals(
      row.querySelector('small')!.textContent,
      'Gather things · 1 / 3',
    )
    list.scrollTop = 37
    icon.dispatchEvent(new window.Event('click', { bubbles: true }))
    assertEquals(list.querySelector('[data-select]'), row)
    assertEquals(list.scrollTop, 37)
    assertEquals(row.getAttribute('aria-pressed'), 'true')
    let pin = body.querySelector<HTMLElement>('[data-pin]')!
    pin.dispatchEvent(new window.Event('click', { bubbles: true }))
    assertEquals(pins, [[task.id, false]])
    book.show([{ ...task, pinned: false }], '')
    assertEquals(
      body.querySelector('[data-pin]')!.getAttribute('aria-pressed'),
      'false',
    )
    assertEquals(
      list.querySelector('[data-select]')!.getAttribute('aria-pressed'),
      'true',
    )
    assertEquals(list.scrollTop, 37)
    assertEquals(body.querySelector('.Journal_Says')!.textContent, task.says)
  } finally {
    if (prior) Object.defineProperty(globalThis, 'Element', prior)
    else Reflect.deleteProperty(globalThis, 'Element')
  }
})

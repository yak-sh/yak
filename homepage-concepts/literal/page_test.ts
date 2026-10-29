// Run the shipped walkthrough and equipment app on documents in this process.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { act, initial, reserve, summary } from './demo-state.js'

let read = (name: string) => Deno.readTextFile(new URL(name, import.meta.url))
let [demoHtml, demoCode, mainCode] = await Promise.all([
  read('demo.html'),
  read('demo.js'),
  read('main.js'),
])
let demo = new Function(
  'document',
  'globalThis',
  'parent',
  'location',
  'localStorage',
  'FormData',
  'act',
  'initial',
  'reserve',
  'summary',
  demoCode.replace(/^import[^\n]*\n/, ''),
)
let main = new Function(
  'document',
  'globalThis',
  'window',
  'location',
  mainCode,
)
let origin = 'https://example.test'
let pages = await Promise.all(
  ['publish', 'timeline', 'bring'].map(async (name) => {
    let { document, window } = parseHTML(await read(`${name}.html`))
    main(document, window, {}, { origin })
    return document
  }),
)
let storage = () => {
  let records = new Map<string, string>()
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
    value: () => [...records.values()][0],
  }
}
let equipment = (saved = storage()) => {
  let { document, window } = parseHTML(demoHtml)
  let parent = { postMessage: () => {} }
  // Deno's FormData accepts data, so serialize the document's named fields here.
  let form = function (node: HTMLElement) {
    let data = new FormData()
    for (let input of node.querySelectorAll('[name]')) {
      data.set(input.getAttribute('name')!, (input as HTMLInputElement).value)
    }
    return data
  }
  demo(
    document,
    window,
    parent,
    { origin },
    saved,
    form,
    act,
    initial,
    reserve,
    summary,
  )
  let $ = (selector: string) => document.querySelector<HTMLElement>(selector)!
  let send = (type: string, data: Record<string, unknown>) =>
    window.dispatchEvent(Object.assign(new window.Event(type), data))
  let book = (item: string, person: string) => {
    // linkedom has no selected-option behavior; expose the form control's value.
    Object.defineProperty($('[name=item]'), 'value', {
      value: item,
      configurable: true,
    })
    let input = $('[name=person]') as HTMLInputElement
    input.value = person
    $('#booking').dispatchEvent(
      new window.Event('submit', { cancelable: true }),
    )
  }
  let action = (action: string) =>
    send('message', {
      origin,
      source: parent,
      data: { type: 'yaks-demo-action', action },
    })
  return { $, action, book, send, saved }
}
let booking = equipment()
let checks = equipment()
let synced = equipment()
let walkthrough = pages[1]
let actions: string[] = []
let reloads = 0
let frame = {
  postMessage: (message: { action: string }) => actions.push(message.action),
  location: { reload: () => reloads++ },
}
Object.defineProperty(walkthrough.querySelector('iframe'), 'contentWindow', {
  value: frame,
})

test('all homepage directions render the walkthrough and connect links', () => {
  for (let document of pages) {
    equal(document.querySelectorAll('.step').length, 6)
    ok(
      document.querySelectorAll('a[href="https://yaks.app/connect"]').length >=
        2,
    )
  }
})

test('walkthrough buttons address the example and display its saved state', () => {
  for (let action of ['publish', 'neighbor', 'checklist', 'answer', 'reload']) {
    walkthrough.querySelector<HTMLElement>(`[data-action=${action}]`)!.click()
  }
  equal(actions, ['publish', 'neighbor', 'checklist', 'answer'])
  equal(reloads, 1)
  let window = walkthrough.defaultView!
  window.dispatchEvent(Object.assign(new window.Event('message'), {
    source: frame,
    origin,
    data: {
      type: 'yaks-demo-state',
      reservations: 2,
      published: true,
      checklist: true,
    },
  }))
  equal(walkthrough.querySelector<HTMLElement>('.example-link')!.hidden, false)
  equal(
    walkthrough.querySelector('#progress')!.textContent,
    '2 reservations saved · Projector checklist added',
  )
})

test('equipment reservations show safe text, reject duplicates, and survive reload', () => {
  booking.book('projector', '<img src=x onerror=alert(1)>')
  ok(booking.$('.reserved').textContent.includes('<img'))
  equal(booking.$('#items').querySelectorAll('img').length, 0)
  booking.book('projector', 'Other')
  equal(booking.$('#items').querySelectorAll('.reserved').length, 1)
  equal(
    equipment(booking.saved).$('.reserved').textContent,
    booking.$('.reserved').textContent,
  )
})

test('equipment actions preserve bookings, compute answers, and save checklist changes', () => {
  checks.book('projector', 'Lea')
  for (let action of ['publish', 'neighbor', 'checklist', 'answer']) {
    checks.action(action)
  }
  equal(checks.$('#items').querySelectorAll('.reserved').length, 2)
  equal(
    checks.$('#items').querySelectorAll('.return-checklist input').length,
    3,
  )
  equal(checks.$('#answer').hidden, false)
  ok(checks.$('#answer-text').textContent.includes('outdoor screen'))
  checks.book('screen', 'Mo')
  ok(checks.$('#answer-text').textContent.startsWith('All three'))
  let input = checks.$('.return-checklist input') as HTMLInputElement
  input.checked = true
  input.dispatchEvent(new input.ownerDocument.defaultView!.Event('change'))
  equal(
    (equipment(checks.saved).$('.return-checklist input') as HTMLInputElement)
      .checked,
    true,
  )
})

test('equipment applies another context storage updates and resets shared records', () => {
  let other = equipment()
  other.book('screen', 'Mo')
  synced.send('storage', {
    key: 'yaks-homepage-equipment-demo-v1',
    newValue: other.saved.value(),
  })
  equal(synced.$('#items').querySelectorAll('.reserved').length, 1)
  other.$('#reset').click()
  synced.send('storage', {
    key: 'yaks-homepage-equipment-demo-v1',
    newValue: other.saved.value(),
  })
  equal(synced.$('#items').querySelectorAll('.reserved').length, 0)
})

/** Signup draws Locust Grove's Kids Club and membership card forms from
 * their door's answer, as a person on a phone would fill them in. */
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import type { Answers, Question } from '@yaks/forms'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import { mount } from '../tui/testing.ts'
import {
  type Door,
  Signup,
  signupAt,
  signupOf,
  signupReturned,
  type Upload,
} from './Signup.ts'

let ask = (
  eid: string,
  kind: Question['question']['kind'],
  label: string,
  more: Partial<Question['question']> = {},
): Question => ({
  entity: { eid },
  question: { form: 'kids', label, kind, ...more },
})

let kids: Door = {
  doc: { title: 'Kids Club', body: 'Wednesdays at 6:30.\n\nAges 4 to 12.' },
  form: { thanks: 'See you Wednesday!' },
  open: true,
  questions: [
    ask('parent', 'line', 'Your name', { required: true }),
    ask('phone', 'phone', 'Your phone', { required: true, order: 1 }),
    ask('children', 'repeat', 'Child', { required: true, order: 2 }),
    ask('name', 'line', 'Name', { within: 'children', required: true }),
    ask('born', 'date', 'Birthday', { within: 'children', order: 1 }),
    ask('allergic', 'choose', 'Any allergies?', {
      within: 'children',
      order: 2,
      choices: ['Yes', 'No'],
      required: true,
    }),
    ask('allergies', 'lines', 'Which?', {
      within: 'children',
      order: 3,
      required: true,
      when: { question: 'allergic', is: 'Yes' },
    }),
    ask('pickup', 'repeat', 'Pickup person', {
      order: 3,
      hint: 'Anyone else who may take your children home.',
    }),
    ask('who', 'line', 'Name', { within: 'pickup', required: true }),
  ],
}

let card: Door = {
  doc: { title: 'Membership card' },
  form: { closed: 'Cards are back in January.' },
  open: true,
  questions: [
    ask('name', 'line', 'Name', { required: true }),
    ask('email', 'email', 'Email', { order: 1 }),
    ask('address', 'address', 'Address', { order: 2 }),
    ask('next', 'choices', 'Next steps', {
      order: 3,
      choices: ['Baptism', 'Membership class', 'Serving', 'Church directory'],
    }),
    ask('texts', 'check', 'Announcements by text', { order: 4 }),
  ],
}

// What a page says, each text a word apart, as a reader sees it.
let words = (el: Node): string =>
  [...el.childNodes].map((n) =>
    n.nodeType == 3 ? n.textContent!.trim() : words(n)
  ).filter(Boolean).join(' ')

let { document, Event } = parseHTML('<html><body><main></main></body></html>')

// A page holding one Signup: its state kept as the page graph would keep it,
// its door answered by the given rows, and every send remembered.
let page = async (
  door: Door | string,
  refuse?: string,
  feedback?: object,
  upload?: Upload,
) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let location = Object.getOwnPropertyDescriptor(globalThis, 'location')
  let history = Object.getOwnPropertyDescriptor(globalThis, 'history')
  let url = new URL('https://church.example/join?sent=unrelated#card')
  if (feedback) url.searchParams.set('yak-form', JSON.stringify(feedback))
  Object.defineProperty(globalThis, 'location', {
    value: {
      get href() {
        return url.href
      },
    },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'history', {
    value: {
      replaceState: (_state: unknown, _unused: string, href: string) => {
        url = new URL(href)
      },
    },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let at = '/directory/api/form/kids-club'
  let e: Bundle = { entity: { eid: signupAt(at) } }
  let sent: Answers[] = [], reads: string[] = []
  let draw = () =>
    render(
      h(Signup, {
        at,
        e,
        onChange: (b) => {
          equal(b.entity.eid, signupAt(at))
          e = b
          queueMicrotask(draw)
        },
        upload,
        read: (to) => (reads.push(to), Promise.resolve(door)),
        send: (
          to,
          answers,
        ) => (equal(to, at), sent.push(answers), Promise.resolve(refuse)),
      }),
      root,
    )
  let settle = () => act(() => new Promise((r) => setTimeout(r, 0)))
  await act(draw)
  await settle()
  let $ = (css: string) => root.querySelector(css) as HTMLInputElement
  let $$ = (css: string) =>
    [...root.querySelectorAll(css)] as HTMLInputElement[]
  let fire = async (el: Element, type: string) => {
    el.dispatchEvent(new Event(type, { bubbles: true }))
    await settle()
  }
  return {
    root,
    sent,
    reads,
    $,
    $$,
    state: () => signupOf(e),
    url: () => url,
    text: () => words(root),
    names: () => $$('[name]').map((el) => el.getAttribute('name')),
    type: async (name: string, value: string) => {
      let el = $(`[name="${name}"]`)
      el.value = value
      await fire(el, 'input')
    },
    pick: async (name: string, value: string) =>
      await fire($(`[name="${name}"][value="${value}"]`), 'change'),
    press: async (said: string, within = 'form') =>
      await fire(
        [...root.querySelector(within)!.querySelectorAll('button')]
          .find((b) => b.textContent == said)!,
        'click',
      ),
    file: async (name: string, chosen: File) => {
      let el = $(`[name="${name}"]`)
      Object.defineProperty(el, 'files', {
        value: [chosen],
        configurable: true,
      })
      await fire(el, 'change')
    },
    settle,
    submit: async () => await fire($('form'), 'submit'),
    [Symbol.asyncDispose]: async () => {
      await act(() => render(null, root))
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else Reflect.deleteProperty(globalThis, 'document')
      if (location) Object.defineProperty(globalThis, 'location', location)
      else Reflect.deleteProperty(globalThis, 'location')
      if (history) Object.defineProperty(globalThis, 'history', history)
      else Reflect.deleteProperty(globalThis, 'history')
    },
  }
}

test('native return feedback shows thanks once, and preserves unrelated page state', async () => {
  await using p = await page({ ...card, open: false }, undefined, {
    at: 'https://church.example/directory/api/form/kids-club',
    sent: true,
  })
  equal(
    p.text(),
    'Membership card Thank you. Your answers are in. Fill it in again',
  )
  equal(p.url().href, 'https://church.example/join?sent=unrelated#card')
  await p.press('Fill it in again', 'section')
  equal(p.state().sent, false)
  equal(p.text(), 'Membership card Cards are back in January.')
})

test('native refusals remain visible when the form is now closed', async () => {
  await using p = await page({ ...card, open: false }, undefined, {
    at: 'https://church.example/directory/api/form/kids-club',
    said: 'This form is closed or full.',
  })
  equal(p.$('[role=alert]').textContent, 'This form is closed or full.')
})

test('native feedback belongs only to the posted door', () => {
  let url = new URL('https://church.example/join')
  url.searchParams.set(
    'yak-form',
    JSON.stringify({
      at: 'https://elsewhere.example/api/form/kids-club',
      sent: true,
    }),
  )
  equal(signupReturned('/api/form/kids-club', url.href), undefined)
  url.searchParams.set(
    'yak-form',
    JSON.stringify({
      at: 'https://church.example/directory/api/form/kids-club',
      sent: true,
    }),
  )
  equal(
    signupReturned(
      './api/form/kids-club',
      url.href,
      'https://church.example/directory/',
    ),
    { sent: true },
  )
  url.searchParams.set('yak-form', 'invalid')
  equal(signupReturned('/api/form/kids-club', url.href), undefined)
})

test('Kids Club asks for each child, shows a question only for its answer, and sends what shows', async () => {
  await using p = await page(kids)
  equal(p.reads, ['/directory/api/form/kids-club'])
  equal(p.$('h2').textContent, 'Kids Club')
  equal(p.$$('.Body p').map((el) => el.textContent), [
    'Wednesdays at 6:30.',
    'Ages 4 to 12.',
  ])
  equal(p.$('form').getAttribute('action'), '/directory/api/form/kids-club')
  equal(p.$('form').getAttribute('method'), 'post')
  // A required repeat starts with one child; an optional one with none.
  equal(p.names(), [
    'parent',
    'phone',
    'children.0.name',
    'children.0.born',
    'children.0.allergic',
    'children.0.allergic',
  ])
  equal(p.$('[name=phone]').getAttribute('type'), 'tel')
  equal(p.$('[name="children.0.born"]').getAttribute('type'), 'date')
  equal(p.$('[name=parent]').hasAttribute('required'), true)
  equal(p.text().includes('Pickup person (optional)'), true)
  equal(p.text().includes('Anyone else who may take your children home.'), true)

  await p.submit()
  equal(p.sent, [], 'nothing is sent while a required answer is owed')
  equal(p.$$('.Notice-negative').length > 1, true)

  await p.type('parent', 'Ruth')
  await p.type('phone', '555-0100')
  await p.type('children.0.name', 'Ada')
  await p.pick('children.0.allergic', 'Yes')
  equal(p.names().includes('children.0.allergies'), true)
  await p.type('children.0.allergies', 'peanuts')
  await p.press('Add another')
  await p.type('children.1.name', 'Sam')
  await p.pick('children.1.allergic', 'No')
  equal(p.names().includes('children.1.allergies'), false)
  await p.press('Add')
  await p.type('pickup.0.who', 'Grandma Jo')
  let pickup = '[aria-labelledby$="-pickup-label"]'
  await p.press('Add another', pickup)
  equal(p.$$('[name^=pickup]').length, 2)
  await p.press('Remove', '[aria-label="Pickup person 2"]')
  equal(p.names().filter((n) => n?.startsWith('pickup')), ['pickup.0.who'])
  // Changing the first child's answer hides its follow-up, and the hidden
  // answer is not sent.
  await p.pick('children.0.allergic', 'No')
  await p.pick('children.0.allergic', 'Yes')
  await p.type('children.0.allergies', 'peanuts')
  await p.pick('children.1.allergic', 'Yes')
  await p.type('children.1.allergies', 'cats')
  await p.pick('children.1.allergic', 'No')

  await p.submit()
  equal(p.sent, [{
    parent: 'Ruth',
    phone: '555-0100',
    children: [
      { name: 'Ada', allergic: 'Yes', allergies: 'peanuts' },
      { name: 'Sam', allergic: 'No' },
    ],
    pickup: [{ who: 'Grandma Jo' }],
  }])
  equal(p.text(), 'Kids Club See you Wednesday! Fill it in again')
  await p.press('Fill it in again', 'section')
  equal(p.$('[name=parent]').value, '')
  equal(p.names().includes('children.0.name'), true)
})

test('a membership card: boxes to tick, a postal address, and a refusal in the door’s words', async () => {
  await using p = await page(card, 'This form is closed or full.')
  equal(p.$('[name=email]').getAttribute('type'), 'email')
  equal(p.$('[name=address]').tagName, 'TEXTAREA')
  equal(p.$('[name=address]').getAttribute('autocomplete'), 'street-address')
  equal(p.$$('[name=next]').map((el) => el.getAttribute('type')), [
    'checkbox',
    'checkbox',
    'checkbox',
    'checkbox',
  ])
  await p.type('name', 'Ruth')
  await p.pick('next', 'Serving')
  await p.pick('next', 'Baptism')
  await p.pick('next', 'Church directory')
  await p.pick('next', 'Church directory')
  await p.pick('texts', 'true')
  await p.type('email', 'ruth@example.com')
  await p.type('email', '')
  await p.submit()
  equal(p.sent, [{ name: 'Ruth', next: ['Baptism', 'Serving'], texts: true }])
  equal(p.$('[role=alert]').textContent, 'This form is closed or full.')
  equal(p.state().sent, undefined)
  equal(p.$('[name=name]').value, 'Ruth', 'a refusal keeps what was typed')
})

test('a closed form says its own words, and an unread one offers to try again', async () => {
  {
    await using p = await page({ ...card, open: false })
    equal(p.text(), 'Membership card Cards are back in January.')
    equal(p.$('form'), null)
  }
  {
    await using p = await page({ ...kids, form: {}, open: false })
    equal(p.text(), 'Kids Club This form is closed.')
  }
  {
    await using p = await page('There is no such form.')
    equal(p.$('[role=alert]').textContent, 'There is no such form.')
    await p.press('Try again', 'section')
    equal(p.reads.length, 2)
  }
})

test('a terminal draws the same form from the same state', async () => {
  let e: Bundle = {
    entity: { eid: signupAt('./api/form/card') },
    Signup: { door: card },
  }
  let App = () =>
    h(Signup, { at: './api/form/card', e, onChange: (b) => e = b })
  let ui = await mount(App, 40, 30)
  try {
    let text = ui.text()
    for (let words of ['Membership card', 'Name', 'Next steps', 'Send']) {
      equal(text.includes(words), true, words)
    }
  } finally {
    ui.free()
  }
})

let files: Door = {
  form: {},
  open: true,
  questions: [
    ask('people', 'repeat', 'Person', { required: true }),
    ask('resume', 'file', 'Resume', { required: true, within: 'people' }),
  ],
}

test('a chosen file becomes its repeat answer, while pending uploads hold editing and sending', async () => {
  let pending = Promise.withResolvers<{ eid: string } | string>()
  let calls: unknown[] = []
  await using p = await page(
    files,
    undefined,
    undefined,
    (at, question, file) => {
      calls.push([at, question, file.name])
      return pending.promise
    },
  )
  await p.submit()
  equal(p.sent, [])
  await p.press('Add another')
  let chosen = new File(['resume'], 'résumé.pdf', { type: 'application/pdf' })
  await p.file('people.1.resume', chosen)
  equal(calls, [['/directory/api/form/kids-club', 'resume', 'résumé.pdf']])
  equal(p.state().sending, true)
  equal(p.$$('input, button').every((el) => el.hasAttribute('disabled')), true)
  await p.press('Remove', '[aria-label="Person 1"]')
  await p.submit()
  equal(p.sent, [])
  pending.resolve({ eid: 'file-reference' })
  await p.settle()
  equal(p.state().answers, { people: [{}, { resume: 'file-reference' }] })
  equal(p.$('[name="people.1.resume"]').hasAttribute('required'), false)
  await p.file('people.0.resume', chosen)
  await p.submit()
  equal(p.sent, [{
    people: [{ resume: 'file-reference' }, { resume: 'file-reference' }],
  }])
})

test('a refused file upload keeps the form and lets the same file be tried again', async () => {
  let calls = 0
  await using p = await page(
    files,
    undefined,
    undefined,
    () =>
      Promise.resolve(
        ++calls == 1 ? 'This file is too large.' : { eid: 'retry' },
      ),
  )
  let chosen = new File(['file'], 'photo.png')
  await p.file('people.0.resume', chosen)
  equal(p.$('[role=alert]').textContent, 'This file is too large.')
  equal(p.state().sending, false)
  await p.submit()
  equal(p.sent, [])
  await p.file('people.0.resume', chosen)
  await p.submit()
  equal(p.sent, [{ people: [{ resume: 'retry' }] }])
})

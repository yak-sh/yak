import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { gather } from './model.js'
import { screen } from './views.js'

let rows = [
  { entity: { eid: 'church' }, congregation: { name: 'Locust Grove Church' } },
  { entity: { eid: 'prayer' }, group: {}, doc: { title: 'Prayer' } },
  {
    entity: { eid: 'ana' },
    individual: { first: 'Ana', last: 'Yoder', phone: '(269) 555-0142' },
  },
  {
    entity: { eid: 'bo' },
    individual: { first: 'Bo', last: 'Hertzler', phone: '269-555-0143' },
  },
  { entity: { eid: 'm1' }, membership: { group: 'prayer', person: 'ana' } },
  { entity: { eid: 'm2' }, membership: { group: 'prayer', person: 'bo' } },
  {
    entity: { eid: 'c1' },
    sms_consent: { person: 'ana', consent: 'yes', at: '2026-11-01T00:00:00Z' },
  },
  { entity: { eid: 'ana' }, phone: { number: '+12695550142' } },
  {
    entity: { eid: 'b1' },
    broadcast: { group: 'prayer' },
    doc: { body: 'Locust Grove Church: Pray for Ruth.' },
    created: { at: '2026-11-02T10:00:00Z', by: { eid: 'jeff', name: 'Jeff' } },
  },
  {
    entity: { eid: 's1' },
    text: { to: '+12695550142' },
    doc: { body: 'Locust Grove Church: Pray for Ruth.' },
    deliver: { to: 'ana' },
    copy: { broadcast: 'b1' },
    delivered: { at: '2026-11-02T10:01:00Z' },
  },
  {
    entity: { eid: 't1' },
    text: {
      from: '+12695550142',
      to: '+12695550100',
      at: '2026-11-02T11:00:00Z',
    },
    doc: { body: 'Amen <3' },
  },
]
let m = gather(rows)
let now = new Date('2026-11-04T12:00:00Z')
let office = { writes: true, person: 'jeff' },
  member = { writes: false, person: 'ana' }
let at = (path: string, who = office, ui = {}) =>
  parseHTML(`<main>${screen(m, path, who, { now, ...ui }).body}</main>`)
    .document
let text = (d: Document, sel: string) =>
  [...d.querySelectorAll(sel)].map((e) =>
    e.textContent!.replace(/\s+/g, ' ').trim()
  )

test('the inbox lists who wrote, waiting first, their words escaped', () => {
  let d = at('')
  assertEquals(text(d, '.row.new b'), ['Ana Yoder'])
  assertEquals(text(d, '.row .snip'), ['Amen <3'])
})

test('a conversation shows the broadcast they answered and a reply box for the office', () => {
  let d = at('inbox/+12695550142')
  assertEquals(text(d, '.bubble small'), [
    'Mon · To the Prayer list · Delivered',
    'Mon',
  ])
  assertEquals(
    d.querySelector('form[data-form=reply]')?.getAttribute('data-id'),
    '+12695550142',
  )
  assertEquals(at('inbox/+12695550142', member).querySelector('form'), null)
})

test('sending reviews who it reaches and who it skips before anything goes', () => {
  let d = at('send', office, {
    group: 'prayer',
    confirm: 'prayer',
    body: 'Pray for Ruth.',
  })
  assertEquals(text(d, '.choice small'), ['1 person'])
  assertEquals(text(d, '.confirm h3'), ['Send to 1 person on the Prayer list?'])
  assertStringIncludes(
    text(d, '.confirm p')[0],
    "1 person won't get it: 1 has not agreed to texts",
  )
  assertEquals(text(d, '.confirm blockquote'), [
    'Locust Grove Church: Pray for Ruth.',
  ])
})

test('a sent message says who it reached', () => {
  let d = at('sent/b1')
  assertEquals(text(d, '.tally'), ['1 delivered'])
  assertEquals(text(d, '.people li'), ['Ana Yoder'])
})

test('a list shows each person and why one will not get texts', () => {
  let d = at('lists/prayer', office, { words: 'yod' })
  assertEquals(text(d, 'main > .people li b'), ['Bo Hertzler', 'Ana Yoder'])
  assertStringIncludes(
    text(d, 'main > .people li')[0],
    'has not agreed to texts',
  )
  assertEquals(text(d, '.add .people li b'), [])
})

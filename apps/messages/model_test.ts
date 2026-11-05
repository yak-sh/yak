import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  broadcastBundles,
  conversations,
  e164,
  gather,
  joinBundles,
  reach,
  recipients,
  replyBundles,
  segments,
  stopped,
} from './model.js'

// A store's rows: directory people, a church, a list, and texts.
let person = (eid: string, first: string, phone = '', more = {}) => ({
  entity: { eid },
  individual: { first, last: 'Yoder', phone, ...more },
})
let arrived = (
  eid: string,
  from: string,
  body: string,
  at: string,
  more = {},
) => ({
  entity: { eid },
  text: { from, to: '+12695550100', at },
  doc: { body },
  ...more,
})
let sent = (eid: string, to: string, more = {}) => ({
  entity: { eid },
  text: {},
  doc: { body: 'Locust Grove Church: Pray for Ruth.' },
  deliver: { to },
  created: { at: '2026-11-02T10:00:00Z' },
  ...more,
})
let agreed = (person: string) => ({
  entity: { eid: `c-${person}` },
  sms_consent: { person, consent: 'yes', at: '2026-11-01T00:00:00Z' },
})
let on = (person: string) => ({
  entity: { eid: `m-${person}` },
  membership: { group: 'prayer', person },
})
let church = {
  entity: { eid: 'church' },
  congregation: { name: 'Locust Grove Church' },
}
let prayer = { entity: { eid: 'prayer' }, group: {}, doc: { title: 'Prayer' } }

let store = (...more: unknown[]) =>
  gather([
    church,
    prayer,
    person('ana', 'Ana', '(269) 555-0142'),
    person('bo', 'Bo', '269.555.0143'),
    person('cy', 'Cy', ''),
    person('di', 'Di', '269-555-0144', { deceased: true }),
    person('ed', 'Ed', '269-555-0145'),
    ...['ana', 'bo', 'cy', 'di', 'ed'].map(on),
    ...['ana', 'bo', 'di'].map(agreed),
    ...more,
  ])

test('a directory phone reads as E.164 or not at all', () => {
  assertEquals(
    [
      '(269) 555-0142',
      '1-269-555-0142 ext. 4',
      '555-0142',
      '+44 20 7946 0000',
      '',
    ].map(e164),
    ['+12695550142', '+12695550142', null, null, null],
  )
})

test('a list reaches who agreed and has a mobile, and says why it skips the rest', () => {
  let m = store(arrived('t1', '+12695550143', 'Stop', '2026-11-03T00:00:00Z'))
  let { to, left } = recipients(m, 'prayer')
  assertEquals(to.map((p: { eid: string }) => p.eid), ['ana'])
  assertEquals(
    left.map((
      l: { person: { eid: string }; why: string },
    ) => [l.person.eid, l.why]),
    [
      ['bo', 'texted STOP'],
      ['cy', 'no mobile number in the directory'],
      ['di', 'has passed away'],
      ['ed', 'has not agreed to texts'],
    ],
  )
})

test('STOP opts a number out until START', () => {
  let t = (body: string, at: string) => ({ out: false, number: '+1', body, at })
  assertEquals([...stopped([t('STOP', '1'), t('thanks', '2')]).keys()], ['+1'])
  assertEquals(stopped([t('stop', '1'), t('Start', '2')]).size, 0)
  assertEquals(stopped([t('stop the music', '1')]).size, 0)
})

test('a broadcast is one signed text a person, with the number the directory has now', () => {
  let m = store(
    { entity: { eid: 'ana' }, phone: { number: '+12695550100' } },
    arrived('t1', '+12695550143', 'STOP', '2026-11-03T00:00:00Z'),
  )
  let b = broadcastBundles(m, 'prayer', 'Pray for Ruth.', 'b1')
  assertEquals(b, [
    {
      entity: { eid: 'b1' },
      broadcast: { group: 'prayer' },
      doc: { body: 'Locust Grove Church: Pray for Ruth.' },
    },
    { entity: { eid: 'ana' }, phone: { number: '+12695550142' } },
    {
      entity: { eid: '$text-ana' },
      text: {},
      doc: { body: 'Locust Grove Church: Pray for Ruth.' },
      deliver: { to: 'ana' },
      copy: { broadcast: 'b1' },
    },
  ])
})

test('what a broadcast reached comes from each copy’s outcome', () => {
  let m = store(
    {
      entity: { eid: 'b1' },
      broadcast: { group: 'prayer' },
      doc: { body: 'x' },
    },
    sent('s1', 'ana', {
      copy: { broadcast: 'b1' },
      delivered: { at: '2026-11-02T10:01:00Z' },
    }),
    sent('s2', 'bo', {
      copy: { broadcast: 'b1' },
      bounced: { at: '2026-11-02T10:01:00Z', reason: 'not registered' },
    }),
    sent('s3', 'di', { copy: { broadcast: 'b1' } }),
  )
  let r = reach(m, 'b1')
  let names = (xs: { person?: { eid: string } }[]) =>
    xs.map((x) => x.person?.eid)
  assertEquals([names(r.delivered), names(r.bounced), names(r.sending)], [
    ['ana'],
    ['bo'],
    ['di'],
  ])
  assertEquals(r.bounced[0].text.reason, 'not registered')
})

test('a conversation is every text with one number, once they have written', () => {
  let m = store(
    { entity: { eid: 'ana' }, phone: { number: '+12695550142' } },
    sent('s1', 'ana', {
      text: { to: '+12695550142' },
      delivered: { at: '2026-11-02T10:01:00Z' },
    }),
    sent('s2', 'bo', { delivered: { at: '2026-11-02T10:01:00Z' } }),
    arrived('t1', '+12695550142', 'Amen, thank you', '2026-11-02T11:00:00Z'),
    arrived('t2', '+12695559999', 'Who is this?', '2026-11-03T09:00:00Z', {
      archived: { at: 'x' },
    }),
  )
  let cs = conversations(m)
  assertEquals(
    cs.map((
      c: { name: string; waiting: number; texts: unknown[] },
    ) => [c.name, c.waiting, c.texts.length]),
    [
      ['(269) 555-9999', 0, 1],
      ['Ana Yoder', 1, 2],
    ],
  )
})

test('a reply goes to the person, records that they wrote first, and answers their texts', () => {
  let m = store(
    arrived(
      't1',
      '+12695550145',
      'Can you pray for my mom?',
      '2026-11-03T09:00:00Z',
    ),
  )
  let [c] = conversations(m)
  assertEquals(replyBundles(m, c, ' We will. ', '2026-11-03T10:00:00Z'), [
    { entity: { eid: 'ed' }, phone: { number: '+12695550145' } },
    {
      entity: { eid: '$consent' },
      sms_consent: {
        person: 'ed',
        consent: 'Texted Locust Grove Church first: Can you pray for my mom?',
        at: '2026-11-03T09:00:00Z',
      },
    },
    {
      entity: { eid: '$reply' },
      text: {},
      doc: { body: 'We will.' },
      deliver: { to: 'ed' },
    },
    { entity: { eid: 't1' }, archived: {} },
  ])
})

test('a stranger’s number gets a contact of its own to reply to', () => {
  let m = store(arrived('t1', '+12695559999', 'hi', '2026-11-03T09:00:00Z'))
  let [phone] = replyBundles(m, conversations(m)[0], 'Hello!')
  assertEquals(phone, {
    entity: { eid: '$contact' },
    phone: { number: '+12695559999' },
  })
})

test('joining a list records the church’s words once, and never someone who said STOP', () => {
  let m = store(arrived('t1', '+12695550143', 'STOP', '2026-11-03T00:00:00Z'))
  let b = joinBundles(m, 'general', ['ana', 'bo', 'ed'], '2026-11-04T00:00:00Z')
  assertEquals(
    b.map((x: Record<string, unknown>) =>
      Object.keys(x).filter((k) => k != 'entity')
    ),
    [
      ['membership'],
      ['phone'],
      ['membership'],
      ['phone'],
      ['sms_consent'],
    ],
  )
  assertEquals(
    b[4].sms_consent.consent.startsWith(
      'Asked to receive texts from Locust Grove Church:',
    ),
    true,
  )
})

test('a text is counted in the parts a phone receives', () => {
  assertEquals(segments('a'.repeat(160)), { chars: 160, texts: 1, plain: true })
  assertEquals(segments('a'.repeat(161)).texts, 2)
  assertEquals(segments('Praying 🙏').plain, false)
  assertEquals(segments('x'.repeat(71) + '🙏').texts, 2)
})

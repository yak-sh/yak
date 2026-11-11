import { type Bundle, type Comp, graph } from '@yaks/graph'
import { formsDoc } from '@yaks/forms/vocab'
import { eventsDoc } from '@yaks/events/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import { consentEid, phoneDoc } from '@yaks/phone'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { memberKeywords, personal } from '@yaks/member'
import { equal, ok, test } from '@yaks/testing'
import { signupIn } from './signup.ts'
import { formRules } from '@yaks/forms/graph'
import { plugins as people } from '@yaks/people/graph'
import type { Stored } from './graph.ts'

let vocab = loadVocab([kernelDoc, formsDoc, eventsDoc, docDoc, phoneDoc, {
  $defs: {
    individual: {
      component: true,
      properties: Object.fromEntries(
        ['first', 'phone', 'email', 'status'].map((
          key,
        ) => [key, { type: 'string' }]),
      ),
    },
  },
}], [memberKeywords])
let fixture = async (questions: Bundle[], extras: Bundle[] = []) => {
  let storage = ram(vocab)
  let reopen = () =>
    graph({
      vocab,
      storage,
      plugins: [formRules(() => 1000), ...people({ vocab }), personal(vocab)],
    })
  let g = reopen()
  await g.apply([
    ...['app', 'sender', 'someone-else', 'church', 'private'].map((eid) => ({
      entity: { eid },
      doc: { title: eid },
    })),
    {
      entity: { eid: 'form' },
      form: { thanks: 'See you Sunday.', notify: ['private'] },
      doc: { title: 'Kids' },
    },
    ...questions,
    ...extras,
  ])
  let run = async (
    op: string,
    args: Record<string, unknown> = {},
    person = 'sender',
  ) => {
    let r = await signupIn(
      new Request('https://store/signup', {
        method: 'POST',
        body: JSON.stringify({
          op,
          person,
          phone: '+12695550142',
          form: 'form',
          ...args,
        }),
      }),
      { graph: reopen(), app: 'app', env: {}, now: () => 1000 } as Stored,
    )
    return { status: r.status, value: await r.json() }
  }
  return { g, run }
}
let question = (id: string, props = {}): Bundle => ({
  entity: { eid: id },
  question: { form: 'form', kind: 'line', label: id, ...props },
})
let start = await fixture([
  question('optional', { order: 0 }),
  question('required', { required: true, order: 1 }),
  question('phone', {
    kind: 'phone',
    fills: 'individual.phone',
    required: true,
  }),
  question('emergency', { kind: 'phone', required: true, order: 2 }),
], [{
  entity: { eid: 'known' },
  individual: { first: 'Ann', phone: '+12695550142' },
  phone: { number: '+12695550142' },
}])
let begun = await start.run('start')
let registration = begun.value.registration
let refused = await start.run('answer', {
  registration,
  path: ['required'],
  value: null,
})
let required = await start.run('answer', {
  registration,
  path: ['required'],
  value: 'Ann',
})
let duplicate = await start.run('answer', {
  registration,
  path: ['required'],
  value: 'Ann',
})
let emergency = await start.run('answer', {
  registration,
  path: ['emergency'],
  value: '+12695550143',
})
let resumed = await start.run('start')
let skipped = await start.run('answer', {
  registration,
  path: ['optional'],
  value: null,
})

test('sign-ups resume from their rows, ask required questions first and persist optional skips', () => {
  equal(begun.value.next.path, ['required'])
  equal(begun.value.answers, { phone: '+12695550142' })
  equal(refused.status, 400)
  equal(required.value.next.path, ['emergency'])
  equal(duplicate.status, 400)
  equal(emergency.value.completed, true)
  equal(resumed.value.registration, registration)
  equal(resumed.value.next.path, ['optional'])
  equal(skipped.value.next, null)
  equal(skipped.value.answers.optional, null)
})

test('a matched directory person does not confer ownership on another submitter', async () => {
  let [row] = await start.g.get([registration])
  equal((row.registration as Comp).person, 'known')
  equal((row.registration as Comp).submitter, 'sender')
  equal((await start.run('mine', {}, 'someone-else')).value, [])
  equal(
    (await start.run('answer', {
      registration,
      path: ['optional'],
      value: 'stolen',
    }, 'someone-else')).status,
    400,
  )
  equal((await start.run('mine')).value[0].registration, registration)
})

test('form discovery omits closed forms, notification targets and private directory details', async () => {
  await start.g.apply([{ entity: { eid: 'closed' }, form: { capacity: 0 } }])
  let shown = await start.run('forms')
  equal(shown.value, [{ entity: { eid: 'form' }, doc: { title: 'Kids' } }])
})

let repeat = await fixture([
  question('children', { kind: 'repeat', required: true }),
  question('name', { within: 'children', required: true }),
  question('note', { within: 'children' }),
])
let repeated = await repeat.run('start')
let rid = repeated.value.registration
let two = await repeat.run('answer', {
  registration: rid,
  path: ['children'],
  value: [{}, {}],
})
let first = await repeat.run('answer', {
  registration: rid,
  path: ['children', 0, 'name'],
  value: 'A',
})
let second = await repeat.run('answer', {
  registration: rid,
  path: ['children', 1, 'name'],
  value: 'B',
})
let note = await repeat.run('answer', {
  registration: rid,
  path: ['children', 0, 'note'],
  value: null,
})
test('repeated questions advance by their full path, with required entries before optional ones', () => {
  equal(two.value.next.path, ['children', 0, 'name'])
  equal(first.value.next.path, ['children', 1, 'name'])
  equal(second.value.next.path, ['children', 0, 'note'])
  equal(note.value.next.path, ['children', 1, 'note'])
})

let consent = await fixture([
  question('texts', {
    kind: 'check',
    fills: 'sms_consent.consent',
    label: 'Church announcements by text',
    hint: 'Reply STOP to opt out.',
  }),
])
let begunConsent = await consent.run('start')
let cs = begunConsent.value.registration
let before = await consent.g.read('.sms_consent')
let yes = await consent.run('answer', {
  registration: cs,
  path: ['texts'],
  value: true,
  space: 'church',
})
let [consentPhone] = await consent.g.read('.phone')
let [consentRow] = await consent.g.get([consentEid(consentPhone.entity.eid)])
test('only an explicit answer to the mapped consent question agrees in the church’s words', async () => {
  equal(before, [])
  equal(yes.status, 200)
  let [texter] = await consent.g.read('.phone.number="+12695550142"')
  let person = texter.entity.eid
  equal(consentRow.sms_consent, {
    person,
    consent: 'Church announcements by text\nReply STOP to opt out.',
    at: '1970-01-01T00:00:01.000Z',
    space: 'church',
  })
  ok((await consent.g.get([person]))[0].phone)
})

let no = await fixture([
  question('texts', { kind: 'check', fills: 'sms_consent.consent' }),
])
let ns = (await no.run('start')).value.registration
await no.run('answer', { registration: ns, path: ['texts'], value: false })
test('declining a consent question does not agree to texts', async () => {
  equal(await no.g.read('.sms_consent'), [])
})

let visible = async (person: string | null, level?: string) =>
  (await consent.g.read('.phone', { person, level })).length
let firstReaders = await Promise.all([
  visible(null),
  visible('reader', 'viewer'),
  visible('reader', 'editor'),
])
await consent.g.apply([
  { entity: { eid: 'second-form' }, form: {} },
  {
    entity: { eid: 'second-consent' },
    question: {
      form: 'second-form',
      kind: 'check',
      fills: 'sms_consent.consent',
    },
  },
])
let again =
  (await consent.run('start', { form: 'second-form' })).value.registration
await consent.run('answer', {
  registration: again,
  path: ['second-consent'],
  value: 'yes',
})

test("a text sign-up's phone is kept to editors, including after the texter signs up again", async () => {
  equal(firstReaders, [0, 0, 1])
  equal(
    await Promise.all([
      visible(null),
      visible('reader', 'viewer'),
      visible('reader', 'editor'),
    ]),
    [0, 0, 1],
  )
})

let known = await fixture([
  question('texts', { kind: 'check', fills: 'sms_consent.consent' }),
], [{
  entity: { eid: 'staff' },
  phone: { number: '+12695550142' },
  doc: { title: 'Staff' },
}])
let original = await known.g.get(['staff'])
let ks = (await known.run('start')).value.registration
await known.run('answer', { registration: ks, path: ['texts'], value: true })
test('agreeing to texts keeps an existing app-owned phone row as the app wrote it', async () => {
  equal(await known.g.get(['staff']), original)
  equal((await known.g.read('.phone', { person: null })).length, 1)
  equal(
    ((await known.g.read('.sms_consent'))[0].sms_consent as Comp).person,
    'staff',
  )
})

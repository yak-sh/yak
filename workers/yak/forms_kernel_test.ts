import type { Comp } from '@yaks/graph'
import { equal, ok, test } from '@yaks/testing'
import { connector, kernel, letters, signIn } from './probe.ts'

let k = await kernel(), owner = await signIn(k)
let agent = connector(k, owner.cookie)
let host = `${owner.email.split('@')[0]}.${k.host}`
let app = `forms${crypto.randomUUID().slice(0, 6)}`
let made = await agent.answer('app_new', {
  slug: app,
  title: 'Forms',
  access: 'private',
})
await agent.tool('app_files', {
  app,
  op: 'write',
  path: 'vocab.json',
  content: JSON.stringify({
    $defs: {
      individual: {
        properties: Object.fromEntries(
          ['first', 'email', 'phone', 'status'].map((
            key,
          ) => [key, { type: 'string' }]),
        ),
      },
    },
  }),
})
await agent.tool('app_files', {
  app,
  op: 'write',
  path: 'index.html',
  content: '<h1>Ordinary page</h1>',
})
await agent.tool('app_deploy', { app })
let form = crypto.randomUUID(), question = crypto.randomUUID()
let notify = crypto.randomUUID(), member = crypto.randomUUID()
await agent.tool('graph_apply', {
  app,
  entities: [
    {
      entity: { eid: form },
      alias: { name: 'tea' },
      form: { capacity: 1, thanks: 'See you at tea.', notify: [notify] },
      doc: { title: 'Tea' },
    },
    {
      entity: { eid: question },
      question: {
        form,
        kind: 'email',
        label: 'Email',
        required: true,
        fills: 'individual.email',
      },
    },
    { entity: { eid: notify }, email: { address: 'organizer@example.com' } },
    {
      entity: { eid: member },
      individual: {
        first: 'Ann',
        email: 'ann@example.com',
        phone: '+12695550142',
        status: 'member',
      },
    },
  ],
})
let submit = (answers: object, extra = {}) =>
  k.at(host, `/${app}/api/form/tea`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers, ...extra }),
  })
let invalid = await submit({})
let accepted = await submit({ [question]: 'ann@example.com' }, {
  person: notify,
})
let full = await submit({ [question]: 'next@example.com' })
await k.settled()

let race = crypto.randomUUID(), closed = crypto.randomUUID()
let contact = crypto.randomUUID(), phone = crypto.randomUUID()
await agent.tool('graph_apply', {
  app,
  entities: [
    { entity: { eid: race }, form: { capacity: 1 } },
    { entity: { eid: closed }, form: { closes: '2000-01-01T00:00:00.000Z' } },
    { entity: { eid: contact }, form: {}, doc: { title: 'Contact' } },
    {
      entity: { eid: phone },
      question: {
        form: contact,
        kind: 'phone',
        label: 'Phone',
        fills: 'individual.phone',
      },
    },
  ],
})
let post = (id: string, answers = {}) =>
  k.at(host, `/${app}/api/form/${id}`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  })
let raced = await Promise.all([post(race), post(race)])
let shut = await post(closed)
let phoned = await post(contact, { [phone]: '+12695550142' })
await k.settled()
let rows = (await agent.answer('graph_query', {
  app,
  query: `.registration.form=${form}&*`,
})).rows
let mails =
  (await agent.answer('graph_query', { app, query: '.mail&?doc' })).rows

test('a private form accepts a visitor without handing back data or read access', async () => {
  equal(invalid.status, 400)
  equal([accepted.status, await accepted.clone().text()], [204, ''])
  equal(await accepted.text(), '')
  equal((await k.at(host, `/${app}/api/form/tea`)).status, 405)
  ok((await k.at(host, `/${app}/api/query?q=.registration`)).status >= 400)
  equal(rows.length, 1)
  equal((rows[0].registration as Comp)?.person, member)
  ok(rows[0].completed)
  equal((rows[0].completed as Comp)?.by, made.value?.eid)
})

test('completed sign-ups fill capacity and queue notifications and a confirmation', () => {
  equal(full.status, 400)
  equal(letters(k, 'ann@example.com').length, 2)
  ok(
    letters(k, 'ann@example.com')[0].body.includes('See you at tea.'),
    JSON.stringify({ mails, letter: letters(k, 'ann@example.com')[0] }),
  )
  equal(letters(k, 'organizer@example.com').length, 1)
})

test('a permanent alias keeps an ordinary page and rejects a missing form', async () => {
  let page = await k.at(host, `/${app}/form/tea`, {
    headers: { cookie: owner.cookie },
  })
  equal(page.status, 200)
  ok((await page.text()).includes('Ordinary page'))
  equal(
    (await k.at(host, `/${app}/form/missing`, {
      headers: { cookie: owner.cookie },
    })).status,
    404,
  )
})

test('simultaneous visitors share one capacity and closed forms refuse', () => {
  equal(raced.map((r) => r.status).sort(), [204, 400])
  equal(shut.status, 400)
})

test('a phone match sends the confirmation to the directory email', () => {
  equal(phoned.status, 204)
  equal(letters(k, 'ann@example.com')[1].subject, 'Contact')
})

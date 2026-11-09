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
      doc: { title: 'Tea', body: 'Bring a cup.' },
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
let show = (name: string) => k.at(host, `/${app}/api/form/${name}`)
let unfilled = await show('tea')
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
let filled = await show('tea')
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
  ok((await k.at(host, `/${app}/api/query?q=.registration`)).status >= 400)
  equal(rows.length, 1)
  equal((rows[0].registration as Comp)?.person, member)
  ok(rows[0].completed)
  equal((rows[0].completed as Comp)?.by, made.value?.eid)
})

test('a private form shows a visitor its definition and nothing else', async () => {
  equal(unfilled.headers.get('cache-control'), 'no-store')
  equal(await unfilled.json(), {
    entity: { eid: form },
    doc: { title: 'Tea', body: 'Bring a cup.' },
    form: { capacity: 1, thanks: 'See you at tea.' },
    open: true,
    questions: [{
      entity: { eid: question },
      question: {
        form,
        kind: 'email',
        label: 'Email',
        required: true,
        fills: 'individual.email',
      },
    }],
  })
  equal((await filled.json()).open, false)
  equal((await show('missing')).status, 404)
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

// A public app reads to anyone, and a sign-up is still the app's own: only a
// principal holding a level on it reads one, through every read door.
let shown = `formspub${crypto.randomUUID().slice(0, 6)}`
await agent.answer('app_new', {
  slug: shown,
  title: 'Prayer',
  access: 'public',
})
await agent.tool('app_files', {
  app: shown,
  op: 'write',
  path: 'index.html',
  content: '<h1>Prayer</h1>',
})
await agent.tool('app_deploy', { app: shown })
let prayer = crypto.randomUUID(), request = crypto.randomUUID()
await agent.tool('graph_apply', {
  app: shown,
  entities: [
    { entity: { eid: prayer }, alias: { name: 'pray' }, form: {} },
    {
      entity: { eid: request },
      question: { form: prayer, kind: 'lines', label: 'Your request' },
    },
  ],
})
let prayed = await k.at(host, `/${shown}/api/form/pray`, {
  method: 'POST',
  body: JSON.stringify({ answers: { [request]: 'Heal my daughter Ruth' } }),
})
await k.settled()
let stranger = await signIn(k)
let asked = async (q: string, cookie?: string, live = false) => {
  let search = new URLSearchParams({ q, ...live ? { live: '1' } : {} })
  let r = await k.at(host, `/${shown}/api/query?${search}`, {
    headers: cookie ? { cookie } : {},
  })
  return [r.status, await r.text()] as const
}

test('a public app keeps its sign-ups from visitors holding no level', async () => {
  equal(prayed.status, 204)
  for (let cookie of [undefined, stranger.cookie]) {
    for (let live of [false, true]) {
      for (let q of ['.registration', '.completed', `.refs=${prayer}`]) {
        let [status, text] = await asked(q, cookie, live)
        equal(status, 200)
        ok(!text.includes('registration'), `${q}: ${text}`)
      }
    }
    equal(await asked('.registration .count', cookie), [200, '{"count":0}'])
  }
})

test('the app owner reads the sign-ups of a public app', async () => {
  for (let live of [false, true]) {
    let [status, text] = await asked('.registration', owner.cookie, live)
    equal(status, 200)
    ok(text.includes('Heal my daughter Ruth'), text)
  }
  equal(
    await asked('.registration .count', owner.cookie),
    [200, '{"count":1}'],
  )
  let rows = (await agent.answer('graph_query', {
    app: shown,
    query: '.registration',
  })).rows
  equal(rows.length, 1)
})

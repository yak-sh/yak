import type { Comp } from '@yaks/graph'
import { equal, ok, test } from '@yaks/testing'
import { connector, kernel, letters, meta, signIn } from './probe.ts'

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

let native = crypto.randomUUID(), children = crypto.randomUUID()
let born = crypto.randomUUID(), choices = crypto.randomUUID()
let tick = crypto.randomUUID(), text = crypto.randomUUID()
await agent.tool('graph_apply', {
  app,
  entities: [
    {
      entity: { eid: native },
      alias: { name: 'native' },
      form: { capacity: 1 },
    },
    {
      entity: { eid: children },
      question: {
        form: native,
        kind: 'repeat',
        label: 'Children',
        required: true,
      },
    },
    {
      entity: { eid: born },
      question: {
        form: native,
        kind: 'date',
        label: 'Born',
        within: children,
        required: true,
      },
    },
    {
      entity: { eid: choices },
      question: {
        form: native,
        kind: 'choices',
        label: 'Choices',
        choices: ['true'],
      },
    },
    {
      entity: { eid: tick },
      question: { form: native, kind: 'check', label: 'Tick' },
    },
    {
      entity: { eid: text },
      question: { form: native, kind: 'line', label: 'Text' },
    },
  ],
})
let nativePost = (fields: URLSearchParams, referer?: string) =>
  k.at(host, `/${app}/api/form/native`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      ...referer ? { referer } : {},
    },
    body: fields.toString(),
  })
let referring = `https://${host}/${app}/join?sent=old&said=old#kids`
let unfilledNative = await nativePost(new URLSearchParams(), referring)
let fields = new URLSearchParams([
  [`${children}.1.${born}`, '2020-03-04'],
  [`${children}.0.${born}`, '2018-01-02'],
  [choices, 'true'],
  [tick, 'true'],
  [text, 'true'],
])
let takenNative = await nativePost(fields, referring)
let closedNative = await nativePost(fields, referring)
let awayNative = await nativePost(fields, 'https://elsewhere.example/away')
let bareNative = await nativePost(fields)
let invalidReferer = await nativePost(fields, 'invalid URL')
let missingNative = await k.at(host, `/${app}/api/form/missing`, {
  method: 'POST',
  body: '',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    referer: referring,
  },
})
let nativeRows = (await agent.answer('graph_query', {
  app,
  query: `.registration.form=${native}&*`,
})).rows
let domain = `forms-${crypto.randomUUID()}.example.com`
await meta(k).apply([{
  hostname: { name: domain, serves: made.value?.eid, stage: 'active' },
}])
let domainPost = (referer?: string) =>
  k.at(domain, '/api/form/native', {
    method: 'POST',
    body: fields.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...referer ? { referer } : {},
    },
  })
let domainNative = await domainPost(`https://${domain}/join?keep=yes#kids`)
let domainBare = await domainPost()

test('a native form post decodes controls and redirects back with scoped feedback', () => {
  let door = `https://${host}/${app}/api/form/native`
  for (
    let [r, result] of [
      [unfilledNative, { at: door, said: 'Answer every required question.' }],
      [takenNative, { at: door, sent: true }],
      [closedNative, { at: door, said: 'This form is closed or full.' }],
    ] as const
  ) {
    equal(r.status, 303)
    equal(r.headers.get('cache-control'), 'no-store')
    let to = new URL(r.headers.get('location')!)
    equal(JSON.parse(to.searchParams.get('yak-form')!), result)
    to.searchParams.delete('yak-form')
    equal(to.href, referring)
  }
  equal(nativeRows.length, 1)
  equal((nativeRows[0].registration as Comp).answers, {
    [children]: [{ [born]: '2018-01-02' }, { [born]: '2020-03-04' }],
    [choices]: ['true'],
    [tick]: true,
    [text]: 'true',
  })
})

test('native refusals return to the app root without a valid same-origin referrer', () => {
  for (let r of [awayNative, bareNative, invalidReferer]) {
    equal(r.status, 303)
    let to = new URL(r.headers.get('location')!)
    equal(to.origin + to.pathname, `https://${host}/${app}/`)
    equal(
      JSON.parse(to.searchParams.get('yak-form')!).said,
      'This form is closed or full.',
    )
  }
  equal(missingNative.status, 303)
  equal(
    JSON.parse(
      new URL(missingNative.headers.get('location')!)
        .searchParams.get('yak-form')!,
    ).said,
    'No such form.',
  )
})

test('native return addresses stay on the browser’s custom domain', () => {
  for (
    let [r, page] of [
      [domainNative, `https://${domain}/join?keep=yes#kids`],
      [domainBare, `https://${domain}/`],
    ] as const
  ) {
    equal(r.status, 303)
    let to = new URL(r.headers.get('location')!)
    equal(JSON.parse(to.searchParams.get('yak-form')!), {
      at: `https://${domain}/api/form/native`,
      said: 'This form is closed or full.',
    })
    to.searchParams.delete('yak-form')
    equal(to.href, page)
  }
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
        equal(status, 200, `${q} live=${live}: ${text}`)
        ok(!text.includes('registration'), `${q}: ${text}`)
      }
    }
    equal(await asked('.registration .count', cookie), [200, '{"count":0}'])
  }
})

// A stranger at a private published app is served its sample (visit.ts), and
// still meets the app's own forms at its form door.
let gallery = `formsdemo${crypto.randomUUID().slice(0, 6)}`
await agent.answer('app_new', {
  slug: gallery,
  title: 'Directory',
  access: 'private',
})
await agent.tool('app_files', {
  app: gallery,
  files: [
    { path: 'index.html', content: '<h1>Directory</h1>' },
    {
      path: 'seed.json',
      content: JSON.stringify([{
        entity: { eid: '$a' },
        doc: { title: 'Sample' },
      }]),
    },
  ],
})
await agent.tool('app_deploy', { app: gallery })
let welcome = crypto.randomUUID(), named = crypto.randomUUID()
await agent.tool('graph_apply', {
  app: gallery,
  entities: [
    { entity: { eid: welcome }, alias: { name: 'contact' }, form: {} },
    {
      entity: { eid: named },
      question: { form: welcome, kind: 'line', label: 'Name' },
    },
  ],
})
await agent.tool('app_publish', { app: gallery, name: gallery })
let visitor = await signIn(k)
let visits = await Promise.all(
  [undefined, visitor.cookie].flatMap((cookie) =>
    ['contact', welcome].map(async (name) => {
      let r = await k.at(host, `/${gallery}/api/form/${name}`, {
        headers: cookie ? { cookie } : {},
      })
      return [r.status, r.ok ? (await r.json()).entity.eid : await r.text()]
    })
  ),
)
let signed = await k.at(host, `/${gallery}/api/form/contact`, {
  method: 'POST',
  headers: { cookie: visitor.cookie },
  body: JSON.stringify({ answers: { [named]: 'Ruth' } }),
})
let page = await k.at(host, `/${gallery}/form/contact`, {
  headers: { cookie: visitor.cookie },
})
await k.settled()

test("a stranger at a published app's sample meets the app's own forms", async () => {
  equal(visits, Array(4).fill([200, welcome]))
  equal(page.status, 200)
  ok((await page.text()).includes('Directory'))
  equal(signed.status, 204)
  let rows = (await agent.answer('graph_query', {
    app: gallery,
    query: `.registration.form=${welcome}`,
  })).rows
  equal(rows.map((r) => (r.registration as Comp).answers), [{
    [named]: 'Ruth',
  }])
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

let portfolio = crypto.randomUUID(), resumes = crypto.randomUUID()
let resume = crypto.randomUUID(), elsewhere = crypto.randomUUID()
let filesClosed = crypto.randomUUID()
await agent.tool('graph_apply', {
  app: gallery,
  entities: [
    { entity: { eid: portfolio }, alias: { name: 'portfolio' }, form: {} },
    { entity: { eid: elsewhere }, form: {} },
    { entity: { eid: filesClosed }, form: { closes: '2000-01-01T00:00:00Z' } },
    {
      entity: { eid: resumes },
      question: {
        form: portfolio,
        kind: 'repeat',
        label: 'Person',
        required: true,
      },
    },
    {
      entity: { eid: resume },
      question: {
        form: portfolio,
        within: resumes,
        kind: 'file',
        label: 'Resume',
        required: true,
      },
    },
  ],
})
let uploadFile = (name = 'portfolio', q = resume) =>
  k.at(
    host,
    `/${gallery}/api/blob?${new URLSearchParams({ form: name, question: q })}`,
    {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-yak-name': 'resume.txt' },
      body: 'Resume contents',
    },
  )
let fileSent = await uploadFile()
let fileAnswer = fileSent.ok ? await fileSent.json() : await fileSent.text()
let submitFile = (ref: unknown) =>
  k.at(host, `/${gallery}/api/form/portfolio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answers: { [resumes]: [{ [resume]: ref }, { [resume]: ref }] },
    }),
  })
let fileTaken = await submitFile(fileAnswer.eid)
let nonexistentFile = await submitFile('0'.repeat(64))
let malformedFile = await submitFile({ name: 'not uploaded' })
let foreignQuestion = await uploadFile(elsewhere)
let wrongQuestion = await uploadFile('portfolio', named)
let closedUpload = await uploadFile(filesClosed)
await k.settled()

let fileStatus = [fileTaken.status, await fileTaken.text()]
let fileRows = (await agent.answer('graph_query', {
  app: gallery,
  query: `.registration.form=${portfolio}`,
})).rows
let fileBlobs = (await agent.answer('graph_query', {
  app: gallery,
  query: `.entity.eid=${fileAnswer.eid}&.blob`,
})).rows
let fileRead = await k.at(host, `/${gallery}/api/blob/${fileAnswer.eid}`)
let fileGraph = await k.at(host, `/${gallery}/api/query?q=.registration`)
let fileGraphText = await fileGraph.text()

test('a signed-out visitor uploads to a private published form and submits the same file twice', () => {
  equal(fileSent.status, 200, JSON.stringify(fileAnswer))
  equal(fileStatus, [204, ''])
  equal(fileRows.map((r) => (r.registration as Comp).answers), [{
    [resumes]: [{ [resume]: fileAnswer.eid }, { [resume]: fileAnswer.eid }],
  }])
  equal(fileBlobs.length, 1)
  ok(fileRead.status >= 400)
  ok(!fileGraphText.includes(fileAnswer.eid))
})

test('file submissions require uploaded references and uploads require the form’s file question', () => {
  equal(nonexistentFile.status, 400)
  equal(malformedFile.status, 400)
  equal(foreignQuestion.status, 400)
  equal(wrongQuestion.status, 400)
  equal(closedUpload.status, 400)
})

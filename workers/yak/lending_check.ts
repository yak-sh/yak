// Published copies use a lent sentinel through the kernel's install, update,
// connection and egress doors, over stores held in this process.
// Run this end-to-end check explicitly:
// deno test -A --no-check workers/yak/lending_check.ts
import { cleanup, test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import {
  connect,
  envOf,
  integrationEid,
  need,
  registration,
  using,
} from '@yaks/connections'
import type { Bundle, Comp } from '@yaks/graph'
import { d1 } from '../../packages/d1/testing.ts'
import type { D1Like } from '@yaks/d1'
import {
  CALLBACK,
  callback,
  connecting,
  connectionsOf,
  ctxOf,
} from './connections.ts'
import { appStore, directory, over } from './directory.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import { outbound } from './outbound.ts'
import { PUBLISHED } from './published.ts'
import { lasting } from './testing.ts'
import { call } from './tools.ts'
import { minted } from './session.ts'
import { reaching } from './agent.ts'
import { connector, fresh, type Person, signIn, unique } from './probe.ts'
import { parseHTML } from 'linkedom'

let comp = (b: Bundle | undefined, key: string) => (b?.[key] ?? {}) as Comp
let key = 'lender-private-key'

let setup = async (words = false) => {
  let p = lasting('lending-test', {
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  })
  let at = meta(p.env)
  let dir = directory({ fetch: over(at) }, true)
  let people = [crypto.randomUUID(), crypto.randomUUID()]
  await at.apply(
    people.flatMap((person, n) => [
      { entity: { eid: person }, person: {} },
      {
        entity: { eid: `$space${n}` },
        doc: { title: n ? 'Borrower' : 'Lender' },
        space: {
          slug: n ? 'borrower' : 'lender',
          store: n ? 'borrower' : 'lender',
        },
      },
      {
        entity: { eid: `$seat${n}` },
        member: { space: `$space${n}`, person, role: 'owner' },
      },
    ]) as Bundle[],
    KERNEL,
  )
  let [home, away] = await Promise.all(
    ['lender', 'borrower'].map(async (name, n) => {
      let space = (await dir.space(name))!
      let ctx = { env: p.env, dir, person: people[n] }
      let run = (name: string, args: Record<string, unknown> = {}) =>
        call(ctx, name, { space: space.slug, app: 'notes', ...args })
      return { space, ctx, run }
    }),
  )
  await home.run('app_new', { slug: 'notes', title: 'Notes' })
  await home.run('app_files', {
    files: [
      { path: 'index.html', content: '<h1>Notes</h1>' },
      ...words
        ? [{
          path: 'vocab.json',
          content: JSON.stringify({
            $defs: {
              lendingnote: {
                component: true,
                type: 'object',
                properties: { body: { type: 'string' } },
              },
            },
          }),
        }]
        : [],
    ],
  })
  await home.run('app_deploy')
  let app = (await dir.app(home.space, 'notes'))!
  let c = ctxOf(p.env)
  let add = async (integration: string, binding: string) => {
    let made = await c.graph.apply(
      await need(c.graph.read, {
        owner: home.space.eid,
        app: app.eid,
        integration,
        hosts: ['api.weather.test'],
        binding,
      }),
    )
    let connection = made.find((b) => b.connection)!.entity.eid
    await connect(c, connection, { key })
    await home.run('connection_lend', { integration, cap: 2 })
    return connection
  }
  let connection = await add('Weather', 'SKY')
  await home.run('app_publish', { name: 'lent-notes' })
  let install = await away.run('app_install', { name: 'lent-notes' })
  let copy = (await dir.app(away.space, 'notes'))!
  let links = () => c.graph.read(`.edge.from=${copy.eid}&.uses&*`)
  let post = (fields: Record<string, string>) => {
    let form = new FormData()
    for (let [name, value] of Object.entries(fields)) form.set(name, value)
    return connecting(
      new Request('https://yaks.app/manage/connections?space=borrower'),
      p.env,
      away.space,
      { person: people[1], role: 'owner' },
      form,
    )
  }
  return {
    p,
    at,
    dir,
    home,
    away,
    app,
    copy,
    c,
    add,
    connection,
    install,
    links,
    post,
  }
}

let installed = await setup()
let sourceData = metaOf(
  appStore(installed.p.env.STORE, installed.home.space, installed.app),
)
await sourceData.apply([{
  entity: { eid: '$note' },
  doc: { title: 'The lender’s private note' },
}], KERNEL)
test('an installed copy borrows a host-capped sentinel and egress alone swaps its key', async () => {
  let s = installed
  cleanup(s.p[Symbol.asyncDispose])
  let [loan] = await s.links()
  assertEquals(comp(loan, 'uses'), {
    binding: 'SKY',
    cap: 2,
    lender: s.app.eid,
  })
  assertEquals(comp(loan, 'edge').to, s.connection)
  let ownData = metaOf(appStore(s.p.env.STORE, s.away.space, s.copy))
  assertEquals(
    (await sourceData.query('.doc.title="The lender’s private note"')).length,
    1,
  )
  assertEquals(
    await ownData.query('.doc.title="The lender’s private note"'),
    [],
  )
  assertStringIncludes(s.install.text, 'Weather')
  let env = await envOf(s.c, s.copy.eid)
  assert(env.SKY.startsWith('yak_sentinel_'))
  assert(!JSON.stringify(env).includes(key))
  let listed = await PUBLISHED.find((t) => t.name == 'connection_list')!.run(
    s.away.ctx,
    { space: 'borrower' },
  )
  assertStringIncludes(listed.text, 'Weather')
  assertStringIncludes(listed.text, 'Lender')
  assert(!listed.text.includes(key))
  let shown = await connectionsOf(s.p.env, [s.away.space], s.away.ctx.person)
  assertEquals(shown.list.length, 0)
  assertEquals(shown.borrowed.map((b) => [b.integration, b.app.cap]), [[
    'Weather',
    2,
  ]])
  let sent: Request[] = []
  let was = globalThis.fetch
  globalThis.fetch = (input, init) => {
    sent.push(new Request(input, init))
    return Promise.resolve(new Response('ok'))
  }
  try {
    let out = () =>
      outbound(
        new Request('https://api.weather.test/', {
          headers: { authorization: `Bearer ${env.SKY}` },
        }),
        s.p.env,
        { app: s.copy.eid, level: 'owner', person: s.away.ctx.person },
      )
    assertEquals((await out()).status, 200)
    await s.p.settled()
    assertEquals((await out()).status, 200)
    await s.p.settled()
    let refused = await out()
    assertEquals(refused.status, 403)
    assertStringIncludes(await refused.text(), 'Lender')
    assertEquals(sent.map((r) => r.headers.get('authorization')), [
      `Bearer ${key}`,
      `Bearer ${key}`,
    ])
  } finally {
    globalThis.fetch = was
  }
  await assertRejects(() =>
    s.at.apply([{
      entity: { eid: loan.entity.eid },
      uses: { cap: 100 },
    }], { 'x-yak-person': s.away.ctx.person, 'x-yak-role': 'owner' })
  )
})

let updated = await setup()
await updated.post({
  do: 'own',
  app: updated.copy.eid,
  connection: updated.connection,
  key: 'own-weather-key',
})
let ownBeforeUpdate = (await envOf(updated.c, updated.copy.eid)).SKY
test('an update carries a new loan as host while keeping the copy’s existing connection', async () => {
  let s = updated
  cleanup(s.p[Symbol.asyncDispose])
  let second = await s.add('Forecast', 'FORECAST')
  await s.home.run('app_files', {
    files: [{ path: 'index.html', content: '<h1>Notes v2</h1>' }],
  })
  await s.home.run('app_deploy')
  await s.home.run('app_publish', { name: 'lent-notes' })
  await s.away.run('app_update')
  let links = await s.links()
  assertEquals(links.length, 2)
  let loan = links.find((b) => comp(b, 'edge').to == second)!
  assertEquals(comp(loan, 'uses'), {
    binding: 'FORECAST',
    cap: 2,
    lender: s.app.eid,
  })
  assertEquals((await envOf(s.c, s.copy.eid)).SKY, ownBeforeUpdate)
  assert(ownBeforeUpdate != (await envOf(s.c, s.app.eid)).SKY)
})

let replaced = await setup()
test('the borrower replaces a loan with its own key without changing the lender’s', async () => {
  let s = replaced
  cleanup(s.p[Symbol.asyncDispose])
  let said = await s.post({
    do: 'own',
    app: s.copy.eid,
    connection: s.connection,
    key: 'borrower-key',
  })
  assert(!(said instanceof Response))
  assertEquals(said.no, false)
  let held = await using(s.c.graph.read, {
    app: s.copy.eid,
    integration: 'Weather',
  })
  assertEquals(comp(held, 'connection').owner, s.away.space.eid)
  assertEquals(comp(held, 'connection').status, 'connected')
  assertEquals(comp((await s.links())[0], 'uses'), { binding: 'SKY' })
  assert(
    (await envOf(s.c, s.copy.eid)).SKY != (await envOf(s.c, s.app.eid)).SKY,
  )
  assertEquals(
    (await using(s.c.graph.read, { app: s.app.eid, integration: 'Weather' }))!
      .entity.eid,
    s.connection,
  )
})

let renamed = await setup()
test('a borrower names its own borrowed link through the connector and changes nothing of the lender’s connection', async () => {
  let s = renamed
  cleanup(s.p[Symbol.asyncDispose])
  // What the lender's connection is; `updated` and `used` are stamped by the
  // answer naming it (T-132938).
  let lender = async () =>
    (await s.at.query(`.entity.eid=${s.connection}&*`))
      .map((b) => [b.connection, b.secret])
  let was = await lender()
  let run = (name: string, args: Record<string, unknown>) =>
    PUBLISHED.find((t) => t.name == name)!.run(s.away.ctx, {
      space: 'borrower',
      app: 'notes',
      ...args,
    })
  await run('connection_need', { integration: 'Weather', binding: 'RAIN' })
  assertEquals(comp((await s.links())[0], 'uses').binding, 'RAIN')
  assertEquals(await lender(), was)
  await assertRejects(() =>
    run('connection_need', { integration: 'Weather', direct: true })
  )
  await assertRejects(() =>
    run('app_secret_set', { name: 'Weather', value: 'theirs' })
  )
  assertEquals(await lender(), was)
})

let recalled = await setup()
test('recalling a lend restores an ask in the borrower’s space', async () => {
  let s = recalled
  cleanup(s.p[Symbol.asyncDispose])
  await s.home.run('connection_lend', { integration: 'Weather', cap: null })
  let asked = await using(s.c.graph.read, {
    app: s.copy.eid,
    integration: 'Weather',
  })
  assertEquals(comp(asked, 'connection').owner, s.away.space.eid)
  assertEquals(comp(asked, 'connection').status, 'needed')
  assertEquals(comp((await s.links())[0], 'uses'), { binding: 'SKY' })
  assertEquals(await envOf(s.c, s.copy.eid), {})
  assert((await envOf(s.c, s.app.eid)).SKY)
})

let signed = await setup()
await signed.c.graph.apply([
  registration('weather', { id: 'weather-client' }),
  {
    entity: { eid: integrationEid('Weather') },
    integration: {
      authorize: 'https://auth.weather.test/authorize',
      token: 'https://auth.weather.test/token',
      client: 'weather',
    },
  },
])
let ownAsk = await signed.c.graph.apply(
  await need(signed.c.graph.read, {
    owner: signed.away.space.eid,
    integration: 'Weather',
  }),
)
let ownConnection = ownAsk.find((b) => b.connection)!
await signed.c.graph.apply([{
  ...ownConnection,
  connection: {
    ...comp(ownConnection, 'connection'),
    status: 'connected',
    account: 'borrower@weather.test',
  },
  secret: {
    ...comp(ownConnection, 'secret'),
    value: JSON.stringify({ access_token: 'old-token' }),
  },
}])
test('an OAuth replacement attaches the existing account that the callback renewed', async () => {
  let s = signed
  cleanup(s.p[Symbol.asyncDispose])
  let went = await s.post({
    do: 'own',
    app: s.copy.eid,
    connection: s.connection,
  })
  assert(went instanceof Response)
  let state = new URL(went.headers.get('location')!).searchParams.get('state')
  let attempt = went.headers.get('set-cookie')!.split(';')[0]
  let session = (await minted(
    new Request('https://yaks.app/'),
    s.p.env,
    'lending-test',
    s.away.ctx.person,
  )).split(';')[0]
  let was = globalThis.fetch
  globalThis.fetch = () =>
    Promise.resolve(Response.json({
      access_token: 'renewed-token',
      id_token: `e30.${
        btoa(JSON.stringify({ email: 'borrower@weather.test' }))
      }.signature`,
    }))
  try {
    let back = await callback({
      env: s.p.env,
      req: new Request(`https://yaks.app${CALLBACK}?code=C&state=${state}`, {
        headers: { cookie: `${attempt}; ${session}` },
      }),
      path: CALLBACK,
      space: null,
    })
    assertEquals(back!.status, 303)
    assertStringIncludes(back!.headers.get('location')!, 'connected=1')
  } finally {
    globalThis.fetch = was
  }
  let connected = await using(s.c.graph.read, {
    app: s.copy.eid,
    integration: 'Weather',
  })
  assertEquals(connected!.entity.eid, ownConnection.entity.eid)
  assertEquals(comp((await s.links())[0], 'uses'), { binding: 'SKY' })
})

let shared = await setup(true)
await shared.away.run('app_install', { name: 'lent-notes', as: 'own' })
let sibling = (await shared.dir.app(shared.away.space, 'own'))!
let friendData = metaOf(
  appStore(shared.p.env.STORE, shared.away.space, shared.copy),
)
await friendData.apply([{
  entity: { eid: '$friend' },
  lendingnote: { body: 'The friend’s note' },
}], KERNEL)
await metaOf(appStore(shared.p.env.STORE, shared.home.space, shared.app)).apply(
  [{
    entity: { eid: '$source' },
    lendingnote: { body: 'The lender’s note' },
  }],
  KERNEL,
)
let graph = await reaching(
  shared.away.ctx,
  [shared.copy, sibling].map((app) => ({
    space: shared.away.space,
    app,
    who: { person: shared.away.ctx.person, role: 'owner' },
  })),
)
test('a named connector read from a second installed copy follows its component home', async () => {
  cleanup(shared.p[Symbol.asyncDispose])
  let rows = await graph.read('.in=borrower/own&.lendingnote')
  assertEquals(rows.map((b) => comp(b, 'lendingnote').body), [
    'The friend’s note',
  ])
})

// The connections page, as each side's browser opens it and presses its
// buttons: the kernel's own doors, over HTTP, the page read on a document.
test('the connections page lends, shows the loan on both sides, and replaces and recalls it', async () => {
  let k = await fresh({
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  })
  try {
    let jeff = await signIn(k), friend = await signIn(k)
    let [his, hers] = [jeff, friend].map((p) => p.email.split('@')[0])
    let open = async (who: Person, space: string) =>
      parseHTML(
        await (await k.at(k.host, `/manage/connections?space=${space}`, {
          headers: { cookie: who.cookie },
        })).text(),
      ).document
    // A button pressed with what its form holds, and any field typed first.
    let press = async (
      who: Person,
      doc: Document,
      button: Element,
      typed: Record<string, string> = {},
    ) => {
      let at = button.getAttribute('form')
      let form = (at ? doc.getElementById(at) : button.closest('form'))!
      let body = new URLSearchParams()
      for (let f of form.querySelectorAll('input[name]')) {
        if (f.getAttribute('form') && f.getAttribute('form') != at) continue
        body.set(f.getAttribute('name')!, f.getAttribute('value') ?? '')
      }
      for (let [name, value] of Object.entries(typed)) body.set(name, value)
      body.set(button.getAttribute('name')!, button.getAttribute('value')!)
      let r = await k.at(k.host, form.getAttribute('action')!, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie: who.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })
      return parseHTML(await r.text()).document.querySelector('.Say')
        ?.textContent ?? ''
    }
    let card = (doc: Document, title: string) =>
      [...doc.querySelectorAll('[data-connection]')].find((c) =>
        c.querySelector('.Card_Title')?.textContent == title
      )!
    let button = (within: Element, label: string) =>
      [...within.querySelectorAll('button')].find((b) =>
        b.textContent == label
      )!
    let text = (e?: Element | null) =>
      e?.textContent?.replace(/\s+/g, ' ') ?? ''

    let agent = connector(k, jeff.cookie)
    await agent.tool('app_new', { slug: 'study', title: 'Bible Study' })
    await agent.tool('app_files', {
      app: 'study',
      op: 'write',
      path: 'index.html',
      content: '<h1>Study</h1>',
    })
    await agent.tool('app_deploy', { app: 'study' })
    await agent.tool('connection_need', {
      app: 'study',
      integration: 'ESV',
      hosts: ['api.esv.org'],
    })
    let doc = await open(jeff, his)
    assertStringIncludes(
      await press(jeff, doc, button(card(doc, 'ESV'), 'Save key'), {
        key: 'jeffs-esv-key',
      }),
      'Saved',
    )
    doc = await open(jeff, his)
    assertStringIncludes(
      await press(jeff, doc, button(card(doc, 'ESV'), 'Lend'), { cap: '2' }),
      '2 calls a month',
    )
    let name = unique('study')
    await agent.tool('app_publish', { app: 'study', name })
    let theirs = connector(k, friend.cookie)
    for (let as of ['study', 'again', 'third']) {
      await theirs.tool('app_install', { name, as })
    }

    // The borrower: whose it is, the cap, and a key of their own to paste.
    let away = await open(friend, hers)
    let lent = [...away.querySelectorAll('[data-borrowed]')]
    assertEquals(lent.length, 3)
    assertStringIncludes(text(lent[0]), `Borrowed from ${his}`)
    assertStringIncludes(text(lent[0]), '0 of 2 calls this month')
    assertStringIncludes(text(lent[0]), 'Use your own key')
    assertEquals(away.querySelector('[data-connection]'), null)

    // The lender: each copy by its space, its calls against the cap.
    doc = await open(jeff, his)
    let esv = card(doc, 'ESV')
    let rows = [...esv.querySelectorAll('.Rows_Item')].map(text)
    assertEquals(rows.length, 4)
    assertStringIncludes(
      rows[0],
      'Lent to installed copies, 2 calls a month each',
    )
    assertStringIncludes(
      rows[1],
      `${hers}Their copy of Bible Study · 0 of 2 calls this month`,
    )
    assertStringIncludes(
      await press(jeff, doc, button(esv, 'Save'), { cap: '5' }),
      '5 calls a month',
    )
    away = await open(friend, hers)
    assertStringIncludes(
      text(away.querySelector('[data-borrowed]')),
      '0 of 5 calls this month',
    )

    // Each side posts every act at the other's part of the loan, with every
    // field any act reads: none goes through, and neither page changes.
    let hidden = (row: Element) =>
      Object.fromEntries(
        [...row.querySelectorAll('form input[type=hidden]')].map((i) => [
          i.getAttribute('name')!,
          i.getAttribute('value')!,
        ]),
      )
    let sent = async (who: Person, space: string, fields: object) => {
      let r = await k.at(k.host, `/manage/connections?space=${space}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie: who.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields as Record<string, string>).toString(),
      })
      let said = parseHTML(await r.text()).document.querySelector('.Say')
      return {
        say: text(said),
        no: !!said?.getAttribute('class')?.includes('Say-no'),
      }
    }
    let went = async (
      who: Person,
      space: string,
      acts: string[],
      at: object,
    ) => {
      let out = []
      for (let act of acts) {
        let fields = {
          cap: '9',
          key: 'their-key',
          binding: 'MINE',
          title: 'Mine',
        }
        let s = await sent(who, space, { ...fields, ...at, do: act })
        if (!s.no) out.push(`${act}: ${s.say}`)
      }
      return out
    }
    let pages = async () => [
      text(card(await open(jeff, his), 'ESV')),
      text((await open(friend, hers)).querySelector('body')),
    ]
    let [source, copy] = [...esv.querySelectorAll('.Rows_Item')].map(hidden)
    let before = await pages()
    let acts = ['open', 'close', 'lend', 'recall', 'attach', 'own', 'key']
      .concat(['signin', 'disconnect', 'about', 'list', 'unlist'])
    // The lender's own connection is his to key and end, whichever app the
    // post names, and the borrower's link is hers to open and replace.
    let notHis = ['open', 'close', 'lend', 'attach', 'own']
    assertEquals(await went(jeff, his, notHis, copy), [])
    assertEquals(await went(friend, hers, acts, source), [])
    let notHers = acts.filter((a) => !['open', 'close', 'own'].includes(a))
    assertEquals(await went(friend, hers, notHers, copy), [])
    // The same through the connector: his connection is not hers to lend
    // on or to attach, nor her copy his to reach.
    let lend = { app: 'study', integration: 'ESV', cap: 50 }
    await assertRejects(
      () => theirs.tool('connection_lend', lend),
      Error,
      'only the space lending it lends it on',
    )
    await assertRejects(
      () =>
        theirs.tool('connection_attach', {
          app: 'study',
          connection: copy.connection,
        }),
      Error,
      'That connection is not here any more.',
    )
    await assertRejects(() =>
      agent.tool('connection_lend', { ...lend, space: hers })
    )
    assertEquals(await pages(), before)
    // What is each's: she opens her copy's link, and he is told it is hers.
    let loan = away.querySelector('[data-borrowed]')!
    assertStringIncludes(
      await press(friend, away, button(loan, 'Open to anyone')),
      'Anyone using the app may call out through it now.',
    )
    away = await open(friend, hers)
    assertStringIncludes(
      text(away.querySelector('[data-borrowed]')),
      'Anyone may call out',
    )
    assertEquals(
      await sent(jeff, his, { ...hidden(loan), do: 'close' }),
      {
        say: 'Who may call out through a copy borrowing it is that copy’s ' +
          'space’s to say; you can change its cap or recall it.',
        no: true,
      },
    )

    // The borrower's own key replaces one copy's loan, the connection that
    // made replaces a second's, and the lender recalls the third.
    let first = away.querySelector('[data-borrowed]')!
    assertStringIncludes(
      await press(friend, away, button(first, 'Save key'), {
        key: 'friends-key',
      }),
      'your own connection',
    )
    away = await open(friend, hers)
    let second = away.querySelector('[data-borrowed]')!
    assertEquals(text(second).includes('Use your own key'), false)
    assertStringIncludes(
      await press(friend, away, button(second, 'Use your own')),
      'can now use ESV',
    )
    doc = await open(jeff, his)
    esv = card(doc, 'ESV')
    let borrowers = [...esv.querySelectorAll('.Rows_Item')].filter((r) =>
      r.textContent!.includes('Their copy')
    )
    assertEquals(borrowers.length, 1)
    assertStringIncludes(
      await press(jeff, doc, button(borrowers[0], 'Recall')),
      'Stopped lending to that copy',
    )
    away = await open(friend, hers)
    assertEquals(away.querySelectorAll('[data-borrowed]').length, 0)
    let held = [...away.querySelectorAll('[data-connection]')].map(text)
    assertEquals(held.length, 2)
    let mine = held.find((c) => c.includes('Connected'))!
    assertEquals(mine.match(/Bible Studyenv\.ESV/g)?.length, 2, mine)
    assert(held.some((c) => c.includes('Needs connecting')), held.join('\n'))

    // Stopping lends to nobody more, and the lender's own app keeps its key.
    doc = await open(jeff, his)
    assertStringIncludes(
      await press(jeff, doc, button(card(doc, 'ESV'), 'Stop lending')),
      'Stopped lending',
    )
    doc = await open(jeff, his)
    let after = text(card(doc, 'ESV'))
    assert(!after.includes('Lent to installed copies'), after)
    assertStringIncludes(after, 'Connected')
    assertStringIncludes(after, 'Lend to copies of Bible Study')
  } finally {
    await k.stop()
  }
})

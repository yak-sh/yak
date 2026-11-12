// The Operator's chat app, drawn in process for a conversation whose session
// called tools: what a person meets on the page, the side beside it, the
// address from before the chat app, Stop reaching the Operator, and a
// conversation the provider refused, which reads as ended. Each Operator has a
// name: a new one is given one, and a renamed one goes by its new name on the
// page and in its instructions.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { type Item, ModelError } from '@yaks/model'
import { directoryOf } from './directory.ts'
import type { Env } from './env.ts'
import { platform } from './testing.ts'
import { operatorModel, operatorService, released } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { CONVERSATION } from './operator-host.ts'
import { notification } from './operator-updates.ts'
import { toolEid } from '@yaks/tools/result'
import {
  aboutPath,
  chatPage,
  installing,
  operatorAnswer,
  operatorBody,
  updatesPage,
} from './operator-page.ts'
import { NAMES, pick } from './operator-name.ts'
import { chatPath, managed, managePath, manifestPath } from './route.ts'

let p = platform('operator-chat')
let person = crypto.randomUUID(), eid = crypto.randomUUID()
await directoryOf(p.env.STORE).apply({
  entities: [
    {
      entity: { eid: person },
      person: {},
      doc: { title: 'Jeff' },
      email: { address: 'jeff@example.com' },
    },
    {
      entity: { eid },
      space: { slug: 'clerk', store: 'clerk' },
      doc: { title: 'Township' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let space = (await directoryOf(p.env.STORE).at(eid))!
let who = { person, role: 'owner' as const, space: eid }
// The one of their apps the person opens beside the chat.
await released(
  { env: p.env, dir: directoryOf(p.env.STORE), person },
  'app1',
  'Holdfast',
)

let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let script = [
  call('graph_schema', {}),
  call('app_files', { op: 'list', app: 'notices' }),
  call('text_send', { text: 'Posted.' }),
  [{
    kind: 'assistant',
    text: 'The notice is **posted**.\n\n- Thursday at 7',
  } as Item],
]
// What Anthropic answered the first Operator request on Claude in Jeff's space.
let BREAKS = 'Any app errors recently?'
let REFUSED = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message:
      'tools.26.custom.input_schema: input_schema does not support oneOf',
  },
})
let told = ''
let service = operatorService(
  p.env,
  who,
  operatorModel((req) =>
    (told = String(req.instructions ?? '')) &&
      JSON.stringify(req.items).includes(BREAKS)
      ? Promise.reject(
        new ModelError('request', `400 ${REFUSED}`, undefined, {
          body: REFUSED,
        }),
      )
      : Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: script.shift() ?? [{ kind: 'assistant', text: 'Done.' }],
        cost: 0.001,
      })
  ),
)
p.env.BUILDER = service.binding
// Every message goes to the person's one conversation with the Operator.
let task = rootOf(eid, person)

let at = managePath('operator', 'clerk')
let drawn = async (open: string) => {
  let response = await chatPage(p.env, space, who, open)
  let { document } = parseHTML(await response.text())
  return { code: response.status, document }
}

// The side as a person with six apps meets it, as the space's owner or a
// member who may change it: each line it shows, in order, and where each goes.
let six = [
  'Recipe box',
  'Holdfast',
  'Book club',
  'Chores',
  'Garden log',
  'RSVP',
]
  .map((title, i) => ({ eid: `app${i}`, slug: `app${i}`, title }))
let beside = { name: '  Ada Lovelace ', apps: six }
let sided = async (
  role: 'owner' | 'editor',
  open = task,
  app?: string,
  admin = false,
) => {
  let { document } = parseHTML(
    await (await chatPage(
      p.env,
      space,
      { ...who, role },
      open,
      { ...beside, admin },
      app,
    )).text(),
  )
  let lines = [
    ...document.querySelectorAll(
      '.Sidebar :is(.Sidebar_Brand, .Identity b, .SideNav_Link, .Sidebar_Group)',
    ),
  ]
  return {
    document,
    said: lines.map((e) => e.textContent!.trim()),
    to: Object.fromEntries(
      lines.map((e) => [e.textContent!.trim(), e.getAttribute('href')]),
    ),
  }
}
let spaces = [
  {
    slug: 'clerk',
    title: 'Township',
    owner: true,
    own: false,
    operator: space.operator,
  },
  { slug: 'jeff', title: 'Jeff', owner: true, own: true, operator: 'Wren' },
]
// The test's Operator serves one store, so the other space shares it.
let mill = { ...space, slug: 'mill', title: 'Mill Pond', operator: 'Fern' }
// Until the person writes, the space's address is a new chat.
let fresh = await drawn('new')
let greeted = await sided('owner', 'new')
let chosen = await sided('owner', 'new', 'app1')
let unchosen = await Promise.all(
  ['nope', undefined].map((other) => sided('owner', 'new', other)),
)
let whose = await Promise.all(
  [space, mill].map(async (at) =>
    parseHTML(
      await (await chatPage(p.env, at, who, 'new', { spaces })).text(),
    ).document
  ),
)
let request = await receive(service.store, {
  space: eid,
  person,
  channel: 'chat',
}, 'Post a special meeting Thursday at 7 about the road millage.')
await service.drain()
let page = await drawn(task)
let byRequest = await drawn(request)
let home = await drawn('new')
let gone = await drawn(crypto.randomUUID())
let text = (s: string) =>
  [...page.document.querySelectorAll(s)].map((e) => e.textContent?.trim())

test('a conversation opens in the chat app: its words, each step in plain words, and the reply', () => {
  assertEquals(page.code, 200)
  assertEquals(text('[data-title]'), [CONVERSATION])
  // the yak sits beside the box
  assert(page.document.querySelector('#ask .Composer > img[data-idle]'))
  assertEquals(text('.Transcript_Bubble'), [
    'Post a special meeting Thursday at 7 about the road millage.',
  ])
  // Each step said from the person's side, as what it did for them, or
  // tried to: the step names the app and the person it acted on.
  assertEquals(text('.More_Inline > summary'), [
    'Read the schema',
    'Tried listing the files of notices',
    'Tried texting Jeff',
  ])
  assertEquals(
    page.document.querySelector('.Transcript_Reply strong')?.textContent,
    'posted',
  )
  assertEquals(text('.Transcript_Reply li'), ['Thursday at 7'])
  // Every entry keeps its action beside its own time, including steps.
  assertEquals(
    text('.Transcript_Lines .Transcript_When'),
    Array(6).fill('just now'),
  )
  // A step opens on what it asked for in words; what its error said shows
  // only inside its closed Details, and what the model was told only in its
  // own frame.
  let said = page.document.querySelector('[data-conversation]')!.cloneNode(
    true,
  ) as Element
  said.querySelectorAll('.Transcript_Error details, .More_Framed').forEach((
    d,
  ) => d.remove())
  assertEquals(said.innerHTML.includes('<pre'), false)
  assertEquals(said.innerHTML.includes('&quot;'), false)
  assertEquals(text('.Transcript_Error > p'), [
    'This step did not work, so the Operator went on without it.',
    'This step did not work, so the Operator went on without it.',
  ])
  assertEquals(text('.More_Inline-no .Pairs-nested dt'), ['Op', 'App', 'Text'])
  // Done: nothing is said to be under way, and Stop is not offered.
  assertEquals(page.document.querySelector('[data-pending]'), null)
  assertEquals(
    page.document.querySelector('[data-stop]')?.textContent,
    'Stop',
  )
})

test("the space's address opens the person's one conversation, and a new chat until they have one", () => {
  assertEquals(
    home.document.querySelector('[data-task]')?.getAttribute('data-task'),
    task,
  )
  assertEquals(home.document.querySelector('.Talk_Hello'), null)
  assertEquals(fresh.document.querySelector('[data-task]'), null)
  assertEquals(
    byRequest.document.querySelector('[data-task]')?.getAttribute('data-task'),
    task,
  )
  assertEquals(byRequest.document.querySelector('[name=task]'), null)
})

let manifest = await installing(space).json()
test("the chat app installs to a home screen as its Operator's web app", () => {
  let { document } = fresh
  let attr = (selector: string, name: string) =>
    document.querySelector(selector)?.getAttribute(name)
  assertEquals(attr('link[rel=manifest]', 'href'), manifestPath('clerk'))
  assertEquals(managed(manifestPath('clerk')), {
    space: 'clerk',
    view: 'operator',
    manifest: true,
  })
  assertEquals(attr('link[rel=manifest]', 'crossorigin'), 'use-credentials')
  assertEquals(
    attr('link[rel=apple-touch-icon]', 'href'),
    '/connector-512.png',
  )
  assertEquals(
    [...document.querySelectorAll('meta[name=theme-color]')]
      .map((m) => [m.getAttribute('media'), m.getAttribute('content')]),
    [
      ['(prefers-color-scheme: light)', '#fdf7ee'],
      ['(prefers-color-scheme: dark)', '#2b231f'],
    ],
  )
  assertEquals(
    attr('meta[name=apple-mobile-web-app-capable]', 'content'),
    'yes',
  )
  assertEquals(
    attr('meta[name=apple-mobile-web-app-title]', 'content'),
    space.operator,
  )
  assertEquals(
    installing(space).headers.get('content-type'),
    'application/manifest+json',
  )
  assertEquals(manifest, {
    id: chatPath('clerk'),
    name: `${space.operator}, Township’s Operator`,
    short_name: space.operator,
    start_url: chatPath('clerk'),
    scope: '/',
    display: 'standalone',
    background_color: '#fdf7ee',
    theme_color: '#fdf7ee',
    icons: [{ src: '/connector-512.png', type: 'image/png', sizes: '512x512' }],
  })
})

let owner = await sided('owner')
let member = await sided('editor')
let admin = await sided('owner', task, undefined, true)
test('the side holds the space, the Operator, Updates, a few apps and Manage', () => {
  let op = space.operator
  assertEquals(owner.said, [
    'yaks.app',
    'Township',
    op,
    `Updates from ${op}`,
    'Your apps',
    'Recipe box',
    'Holdfast',
    'Book club',
    'Chores',
    'All 6 apps',
    'Manage',
  ])
  // Each app opens beside the conversation on screen.
  assertEquals(owner.to, {
    'yaks.app': chatPath('clerk'),
    Township: null,
    [op]: chatPath('clerk'),
    [`Updates from ${op}`]: managePath('updates', 'clerk'),
    'Your apps': null,
    'Recipe box': aboutPath('clerk', 'app0', task),
    Holdfast: aboutPath('clerk', 'app1', task),
    'Book club': aboutPath('clerk', 'app2', task),
    Chores: aboutPath('clerk', 'app3', task),
    'All 6 apps': managePath('apps', 'clerk'),
    Manage: managePath('operator', 'clerk'),
  })
  // The conversation on screen is the side's current tab.
  assertEquals(
    owner.document.querySelector('.SideNav [aria-current="page"]')?.textContent,
    op,
  )
  // A member may open none of the settings but the Operator's.
  assertEquals(member.said.includes('All 6 apps'), false)
  assertEquals(member.to.Manage, managePath('operator', 'clerk'))
  // The platform's admin alone has Admin, after Manage.
  assertEquals(admin.said, [...owner.said, 'Admin'])
  assertEquals(admin.to.Admin, '/admin')
})

test('a new chat greets the person by name, with ways to start that fill the box', () => {
  let { document } = greeted
  assertEquals(
    document.querySelector('.Talk_Hello h2')?.textContent,
    'What can I do for you, Ada?',
  )
  assertEquals(
    [...document.querySelectorAll('.Talk_Starts [data-say]')].map((b) => [
      b.textContent,
      b.getAttribute('data-say'),
    ]),
    [
      ['Make a new app', 'Make me an app for '],
      ['Change Recipe box', 'In Recipe box, '],
      ['Something isn’t working', 'Something isn’t working: '],
      [`What can ${space.operator} do?`, 'What can you do for me?'],
    ],
  )
  // Beside it, what needs the person, which is nothing yet; the bar's way
  // to it on a phone wears no count.
  assertEquals(
    document.querySelector('#needs .Talk_Lists')?.textContent,
    'Nothing needs you.',
  )
  assertEquals(document.querySelector('.Talk_Waits .Badge'), null)
  assertEquals(fresh.code, 200)
  assertStringIncludes(
    fresh.document.querySelector('.Talk_Hello')!.textContent!,
    'What can I do for you?',
  )
  assertEquals(fresh.document.querySelector('[name=say]') != null, true)
  assertEquals(
    fresh.document.querySelector('.Talk_Starts button')?.textContent,
    'Make a new app',
  )
})

test('a chat that is gone says so, with no box', () => {
  assertEquals(gone.code, 404)
  assertEquals(gone.document.querySelector('[name=say]'), null)
})

test('an app chosen in the side opens a chat about it, with the app live beside it', () => {
  let { document, said } = chosen
  let app = document.querySelector('.Talk_App')!
  assertEquals(
    app.querySelector('iframe')?.getAttribute('src'),
    'https://clerk.yaks.app/app1/',
  )
  assertEquals(app.querySelector('.Identity_Text b')?.textContent, 'Holdfast')
  assertEquals(
    document.querySelector('.SideNav [aria-current="page"]')?.textContent,
    'Holdfast',
  )
  assertEquals(
    document.querySelector('.Talk_Hello h2')?.textContent,
    'What should change in Holdfast?',
  )
  // The words sent say which page and app are open; a chat about an app is
  // not where the person lands, so it holds no ways to start, and what
  // needs them is still beside it.
  assertEquals(
    document.querySelector('#ask [name=app]')?.getAttribute('value'),
    'app1',
  )
  assertEquals(
    document.querySelector('#ask [name=page]')?.getAttribute('value'),
    aboutPath('clerk', 'app1'),
  )
  assertEquals(document.querySelector('.Talk_Starts'), null)
  assert(document.querySelector('#needs[data-needs]'))
  // On a phone, the bar switches to the app, and the app back to the chat.
  assertEquals(
    document.querySelector('.Talk_Show')?.getAttribute('href'),
    '#app',
  )
  assertEquals(app.id, 'app')
  assertEquals(app.querySelector('.Talk_Back')?.getAttribute('href'), '#')
  assertEquals(said.includes('Holdfast'), true)
  // An app the person may not open, or none, opens nothing beside the chat.
  for (let { document } of unchosen) {
    assertEquals(document.querySelector('.Talk_App, #ask [name=app]'), null)
    assertEquals(
      document.querySelector('#ask [name=page]')?.getAttribute('value'),
      chatPath('clerk'),
    )
  }
})

test("an app opens beside the person's one conversation, its words on screen from the first frame", async () => {
  let words = 'Post a special meeting Thursday at 7 about the road millage.'
  let { document } = await sided('owner', task, 'app1')
  assertEquals(
    document.querySelector('.Talk_App')?.getAttribute('data-app'),
    'app1',
  )
  assertEquals(
    document.querySelector('.Transcript_Bubble')?.textContent?.trim(),
    words,
  )
  assertEquals(document.querySelector('.Talk_Hello'), null)
  assertEquals(
    document.querySelector('#ask [name=app]')?.getAttribute('value'),
    'app1',
  )
  // From the space's address, or Updates, an app opens beside that
  // conversation too.
  let fresh = await sided('owner', 'new', 'app1')
  assertEquals(fresh.to.Holdfast, aboutPath('clerk', 'app1', task))
  assertEquals(
    fresh.document.querySelector('.Transcript_Bubble')?.textContent?.trim(),
    words,
  )
  let updates = parseHTML(
    await (await updatesPage(p.env, space, who, beside)).text(),
  ).document
  // Updates shows no conversation, so its apps open at the space's address,
  // which is that conversation.
  assertEquals(
    [...updates.querySelectorAll('.SideNav_Link')]
      .find((a) => a.textContent == 'Holdfast')?.getAttribute('href'),
    aboutPath('clerk', 'app1'),
  )
})

test('the box asks for a message to the Operator by name', async () => {
  let { document } = await sided('owner')
  assertEquals(
    document.querySelector('#ask textarea')?.getAttribute('placeholder'),
    `Message ${space.operator}`,
  )
})

test('Updates from the Operator opens beside the same side', async () => {
  let { document } = parseHTML(
    await (await updatesPage(p.env, space, who, beside)).text(),
  )
  assertEquals(
    document.querySelector('[data-title]')?.textContent,
    `Updates from ${space.operator}`,
  )
  assertEquals(
    document.querySelector('.SideNav [aria-current="page"]')
      ?.getAttribute('href'),
    managePath('updates', 'clerk'),
  )
  assertEquals(managed(managePath('updates', 'clerk')), {
    space: 'clerk',
    view: 'updates',
  })
})

test("the chat app says whose Operator it is, and opens another space's", () => {
  for (
    let [at, name, document] of [
      [space, 'Township', whose[0]],
      [mill, 'Mill Pond', whose[1]],
    ] as const
  ) {
    let said = (s: string) => document.querySelector(s)?.textContent?.trim()
    assertEquals(
      said('title'),
      `Message ${at.operator} · ${at.operator} · yaks.app`,
    )
    assertEquals(said('.Sidebar_Whose .Identity b'), name)
    assertEquals(said('.Toolbar_Sub'), `${at.operator}, ${name}’s Operator`)
    assertStringIncludes(said('.Talk_Hello')!, `Ask ${at.operator}`)
    // the yak waits beside the box, played by its script (mascot.ts `idle`)
    assert(document.querySelector('#ask .Composer > img[data-idle]'))
    assert(document.querySelector('script[src$="/idle.js"]'))
    assertEquals(
      [...document.querySelectorAll('.Sidebar_Whose .Menu_Item small')].map((
        a,
      ) => a.textContent),
      [
        ...(at == mill ? ['Fern'] : []),
        space.operator,
        'Wren',
      ],
    )
    assertEquals(
      [...document.querySelectorAll('.Sidebar_Whose .Menu_Item')].map((a) =>
        a.getAttribute('href')
      ),
      [
        ...(at == mill ? [chatPath('mill')] : []),
        chatPath('clerk'),
        chatPath('jeff'),
      ],
    )
  }
})

let settings = parseHTML(await operatorBody(p.env, space, who)).document
test("the settings page lists no conversations, only one link to the Operator's chat", () => {
  assertEquals(settings.body.textContent?.includes(CONVERSATION), false)
  let hrefs = [...settings.querySelectorAll('a')].map((a) =>
    a.getAttribute('href')
  )
  assertEquals(hrefs.filter((h) => h == chatPath('clerk')).length, 1)
  assertEquals(hrefs.includes(chatPath('clerk', task)), false)
  assertEquals(settings.querySelector('.Rows_Name'), null)
  assertEquals(settings.querySelector('[data-task]'), null)
  assertEquals(settings.querySelector('[name=say]'), null)
})

let answer = (path: string, init?: RequestInit) =>
  operatorAnswer(
    new Request(new URL(path, 'https://yaks.app'), init),
    p.env,
    space,
    who,
  )
let moved = (await answer(`${at}?open=${task}`))!
let stopped = await (await answer(`${at}?stop=1`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ task }),
}))!.json()
let talk = await (await answer(`${at}?talk=${task}`))!.json()
test('an address from before the chat app is sent to its conversation there', () => {
  assertEquals(moved.status, 301)
  assertEquals(
    new URL(moved.headers.get('location')!).pathname,
    chatPath('clerk', task),
  )
  assertEquals(managed(chatPath('clerk', task)), {
    space: 'clerk',
    view: 'operator',
    open: task,
  })
  assertEquals(managed(chatPath('clerk')), {
    space: 'clerk',
    view: 'operator',
    open: 'new',
  })
  assertEquals(managed(`${at}/x`), null)
})

test('Stop from the page reaches the Operator', () => {
  assertEquals(stopped.task, task)
  assertEquals(stopped.stopped, false)
})

test('a conversation read again carries its title and its lines', () => {
  assertEquals(talk.task, task)
  assertStringIncludes(talk.html, 'Transcript_Reply')
})

let broke = await receive(service.store, {
  space: eid,
  person,
  channel: 'chat',
}, BREAKS)
await service.drain()
// The second message reaches the same conversation, opened by its request.
let crashed = (await drawn(broke)).document
let reread = await (await answer(`${at}?talk=${broke}`))!.json()
test('a conversation the provider refused reads as ended: no Stop, nothing under way, plain words', () => {
  let thread = crashed.querySelector('[data-task]')!
  assertEquals(thread.getAttribute('data-task'), task)
  assertEquals(thread.hasAttribute('data-pending'), false)
  assertEquals(crashed.querySelector('[data-now]')?.textContent, '')
  let last = (s: string) => [...crashed.querySelectorAll(s)].at(-1)
  assertEquals(
    last('.Transcript_Error > p')?.textContent,
    'The Operator could not get an answer from its model, so it stopped before replying. Send your message again to try once more.',
  )
  // Its error shows only inside the closed Details.
  let details = last('.Transcript_Error > details')!
  assertEquals(details.hasAttribute('open'), false)
  assertStringIncludes(details.textContent!, 'invalid_request_error')
  details.remove()
  assertEquals(thread.innerHTML.includes('invalid_request_error'), false)
  assertEquals(reread.html.includes('data-pending'), false)
})

let dir = directoryOf(p.env.STORE)
let headers = { 'x-yak-person': person, 'x-yak-role': 'owner' }
let orchard =
  (await dir.at(await dir.mint(person, 'orchard', 'Orchard', headers)))!
let pond = (await dir.at(await dir.mint(person, 'pond', 'Pond', headers)))!
test('a new Operator is given a name, clear of the Operators its person already reaches', () => {
  assertEquals(space.operator, pick(eid))
  for (let s of [orchard, pond]) assertEquals(NAMES.includes(s.operator), true)
  assertEquals(new Set([space, orchard, pond].map((s) => s.operator)).size, 3)
})

let rename = (name: string) =>
  answer(`${at}?name=1`, {
    method: 'POST',
    body: new URLSearchParams({ name }),
  }).then((r) => r!.json().then((json) => ({ status: r!.status, json })))
let empty = await rename('  ')
let renamed = await rename('  Marlowe   Quince ')
let after = (await dir.at(eid))!
let again = parseHTML(
  await (await chatPage(p.env, after, who, 'new')).text(),
).document
let named = parseHTML(await operatorBody(p.env, after, who)).document
await receive(service.store, {
  space: eid,
  person,
  channel: 'chat',
}, 'Who are you?')
await service.drain()
test('a renamed Operator goes by its new name in its chat app, its settings and its instructions', () => {
  assertEquals(empty.status, 400)
  assertEquals(renamed.json, { name: 'Marlowe Quince' })
  assertEquals(after.operator, 'Marlowe Quince')
  assertEquals(
    again.querySelector('.Toolbar_Sub')?.textContent,
    'Marlowe Quince, Township’s Operator',
  )
  assertEquals(
    named.querySelector('#name [name=name]')?.getAttribute('value'),
    'Marlowe Quince',
  )
  assertStringIncludes(told, 'You are Marlowe Quince, the Operator of clerk')
})

// A Voice card saved through its door, then the settings drawn again.
let voiced = async (voice: string, voice_model: string, speed = 'brisk') => {
  let saved = await answer(`${at}?voice=1`, {
    method: 'POST',
    body: new URLSearchParams({ voice, voice_model, voice_speed: speed }),
  })
  let { document } = parseHTML(
    await operatorBody(
      { ...p.env, DEEPGRAM_API_KEY: 'a', OPENAI_VOICE_KEY: 'b' } as never,
      (await dir.at(eid))!,
      who,
    ),
  )
  return {
    status: saved!.status,
    voice: document.querySelector('#voice [name=voice]:checked')
      ?.getAttribute('value'),
    model: document.querySelector('#voice [name=voice_model]:checked')
      ?.getAttribute('value'),
    speed: document.querySelector('#voice [name=voice_speed]:checked')
      ?.getAttribute('value'),
  }
}
test('the Voice card shows back the voice, speed and model each save picked', async () => {
  for (
    let [voice, model, speed] of [
      ['aura-2-pandora-en', 'claude-haiku-5-5', 'relaxed'],
      ['fable', 'claude-sonnet-5-5', 'normal'],
      ['cedar', 'claude-haiku-5-5', 'brisk'],
      ['marin', 'gpt-realtime-2.1-mini', 'normal'],
    ]
  ) {
    assertEquals(await voiced(voice, model, speed), {
      status: 200,
      voice,
      model,
      speed,
    })
  }
  // A voice the talking model cannot speak is refused, and the last save stays.
  let kept = {
    voice: 'marin',
    model: 'gpt-realtime-2.1-mini',
    speed: 'normal',
  }
  assertEquals(await voiced('fable', 'gpt-realtime-2.1'), {
    status: 400,
    ...kept,
  })
  assertEquals(await voiced('marin', 'gpt-realtime-2.1-mini', 'zippy'), {
    status: 400,
    ...kept,
  })
})

test('a helper’s page says it is a helper, whose, where words go, and offers Stop while it works', async () => {
  let helper = crypto.randomUUID()
  await service.store.g.apply([
    {
      entity: { eid: helper },
      session: { id: helper },
      spawned: { parent: task },
      operator_session: { space: eid, person },
    },
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session: helper },
      content: { body: 'Import the CSV' },
    },
  ], { trusted: true })
  let { document } = await sided('owner', helper)
  let card = document.querySelector('[data-helper]')!
  assertEquals(card.getAttribute('data-helper'), helper)
  assertStringIncludes(
    card.querySelector('.Card_Head')!.textContent!,
    'HelperImport the CSV',
  )
  assertEquals(
    card.querySelector('a')!.getAttribute('href'),
    `${managePath('operator', space.slug)}/${task}`,
  )
  assertStringIncludes(card.textContent!, 'goes to your conversation with')
  assertEquals(
    card.querySelector('[data-stop-helper]')?.textContent,
    'Stop this helper',
  )
  assertStringIncludes(
    document.querySelector('#ask [name=say]')!.getAttribute('placeholder')!,
    'in your conversation',
  )
  // Their conversation draws no such card.
  assertEquals(
    (await sided('owner')).document.querySelector('[data-helper]'),
    null,
  )
})

// Last, since it adds to the conversation every test above reads.
test('a chat in which the Operator changed an app opens with no app beside it', async () => {
  let call = crypto.randomUUID()
  await service.store.g.apply([{
    entity: { eid: call },
    entry: { session: task },
    call: { to: toolEid('app_deploy'), args: { app: 'app2' } },
  }, {
    entity: { eid: crypto.randomUUID() },
    entry: { session: task },
    result: { call },
    content: { body: '{"version":2}' },
  }], { trusted: true })
  let { document } = await sided('owner')
  assertEquals(document.querySelector('.Talk_App'), null)
  assertEquals(document.querySelector('#ask [name=app]'), null)
})

// Whichever conversation is open, what needs the person stays beside it,
// each answered where it is, and its count is on the bar's way to it; the
// spaces, apps and settings are behind the bar's menu (D-153799, The chair).
test('what needs the person is beside every conversation, counted, with the menu behind the bar', async () => {
  let needs = {
    eid: crypto.randomUUID(),
    needs: true,
    unread: true,
    at: new Date().toISOString(),
    words: 'Send the *notice* tonight?',
    choices: [
      { label: 'Tonight', description: 'Before the meeting.' },
      { label: 'Tomorrow', description: 'With the minutes.' },
    ],
    recommended: 'Tomorrow',
  }
  let told = {
    eid: crypto.randomUUID(),
    needs: false,
    unread: true,
    at: needs.at,
    words: 'Posted.',
  }
  let BUILDER: Env['BUILDER'] = {
    idFromName: (name) => name,
    get: (name) => ({
      fetch: async (req: Request) => {
        let answer = await service.binding.get(name).fetch(req)
        if (new URL(req.url).pathname != '/operator/conversation') return answer
        let said = await answer.json()
        return Response.json({
          ...said,
          updates: { updates: [needs, told], waiting: 2 },
        })
      },
    }),
  }
  for (let [open, app] of [['new'], [task], ['new', 'app1']]) {
    let page = await chatPage(
      { ...p.env, BUILDER },
      space,
      who,
      open!,
      beside,
      app,
    )
    let { document } = parseHTML(await page.text())
    let aside = document.querySelector('aside#needs')!
    assertEquals(aside.getAttribute('aria-label'), 'What needs you')
    assertEquals(aside.querySelector('h2'), null)
    assertEquals(
      document.querySelector('.Talk_Waits .Badge')?.textContent,
      '1',
    )
    let card = aside.querySelector(`#u-${needs.eid}`)!
    assertEquals(card.querySelector('.Update_Words em')?.textContent, 'notice')
    assertEquals(
      [...card.querySelectorAll('button[name=choice]')].map((b) =>
        b.textContent
      ),
      ['Tomorrow', 'Tonight'],
    )
    assert(
      card.querySelector('details.Update_Reply [name=say]'),
      'asked about in place',
    )
    assertEquals(aside.querySelector(`#u-${told.eid}`), null)
    let waits = document.querySelector('.Talk_Bar .Talk_Waits')!
    assertEquals([waits.getAttribute('href'), waits.textContent], [
      '#needs',
      '1',
    ])
    assertEquals(
      document.querySelector('.Talk_Bar .Talk_Menu')?.getAttribute('href'),
      '#menu',
    )
    assert(
      document.querySelector('#menu.Sidebar .Sidebar_Close'),
      'the menu closes',
    )
    assertEquals(document.querySelector('#menu .Sidebar_Fold'), null)
    // The Updates count in the menu is what needs them and what is unread.
    assertEquals(
      document.querySelector('#menu .Sidebar_Count')?.textContent,
      '2',
    )
  }
})

// The page's Operator, recording what it is asked; `old` is a Builder on the
// code from before a conversation answered Updates beside it, as one is for
// a deploy's window.
let asked = async (old: boolean) => {
  let paths: string[] = []
  let BUILDER: Env['BUILDER'] = {
    idFromName: (name) => name,
    get: (name) => ({
      fetch: async (req: Request) => {
        let path = new URL(req.url).pathname
        paths.push(path)
        let answer = await service.binding.get(name).fetch(req)
        if (!old || path != '/operator/conversation') return answer
        let { updates: _, ...before } = await answer.json()
        return Response.json(before)
      },
    }),
  }
  let page = await chatPage({ ...p.env, BUILDER }, space, who, 'new', beside)
  let { document } = parseHTML(await page.text())
  return {
    paths,
    count: document.querySelector('.Sidebar_Count')?.textContent,
  }
}

test('a chat page asks its Operator once, and a Builder on older code for its Updates apart', async () => {
  await service.store.g.apply([
    notification({ to: person, words: 'The notices app is live.' }),
  ], { trusted: true })
  let [now, before] = [await asked(false), await asked(true)]
  assertEquals(now.paths, ['/operator/conversation'])
  assertEquals(before.paths, ['/operator/conversation', '/operator/updates'])
  assertEquals([now.count, before.count], ['1', '1'])
})

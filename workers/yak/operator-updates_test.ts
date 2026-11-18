// A person's Updates from their space's Operator (operator-updates.ts): what
// it asks them, what it tells the space, a choice or words sent back into
// their conversation, and what each has read.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { Item } from '@yaks/model'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { line } from '@yaks/query'
import { notification, type Update, updating } from './operator-updates.ts'
import { parseHTML } from 'linkedom'
import { chatPage, updatesPage } from './operator-page.ts'
import { chatAt, shownAnswer, updatesAnswer } from './updates.ts'
import { attachmentKey } from './attachments.ts'
import { chatPath, managePath } from '@yaks/platform/routes'

let p = platform('operator-updates')
let [ada, bo, eid] = [0, 1, 2].map(() => crypto.randomUUID())
await directoryOf(p.env.STORE).apply({
  entities: [
    ...[[ada, 'Ada'], [bo, 'Bo']].flatMap(([person, title]) => [
      { entity: { eid: person }, person: {}, doc: { title } },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person, space: eid, role: 'owner' },
      },
    ]),
    { entity: { eid }, space: { slug: 'club', store: 'club' } },
  ],
}, { 'x-yak-person': ada, 'x-yak-role': 'owner' })

let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let said = (text: string): Item[] => [{ kind: 'assistant', text }]
let script: Item[][] = [
  call('decision_new', {
    question: 'Text reminders for Book club?',
    choices: [
      { label: 'Allow', description: 'About $2 a month' },
      { label: 'Not now', description: 'No texts' },
    ],
    recommended: 'Allow',
  }),
  said('I asked you in your Updates.'),
]
let asked: string[] = []
// The tools each ask was offered, those deferred named in tool_load's list.
let tooled: string[][] = []
// Set, the next ask fails as a provider's outage does.
let failing = false
let service = operatorService(
  p.env,
  { person: ada, role: 'owner', space: eid },
  operatorModel((req) => {
    asked.push(JSON.stringify(req.items))
    tooled.push((req.tools ?? []).flatMap((t) => [
      t.name,
      ...[...t.description.matchAll(/^- (\w+):/gm)].map((m) => m[1]),
    ]))
    if (failing) {
      failing = false
      return Promise.reject(new Error('provider: 529 overloaded'))
    }
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: script.shift() ?? said('Done.'),
      cost: 0.001,
    })
  }),
)
p.env.BUILDER = service.binding
let { store } = service
let as = (person: string) => ({ person, space: eid })
let read = async (person: string) =>
  await updating(store, as(person), {}) as {
    updates: Update[]
    waiting: number
  }
let words = async (person: string) =>
  (await read(person)).updates.map((u) => [u.needs, u.words, u.unread])

await receive(
  store,
  { space: eid, person: ada, channel: 'chat' },
  'Remind people',
)
await service.drain()

test('what the Operator asks reaches only the person it works for, with its choices', async () => {
  let [question] = (await read(ada)).updates
  assertEquals(question.needs, true)
  assertEquals(question.words, 'Text reminders for Book club?')
  assertEquals(question.choices?.map((c) => c.label), ['Allow', 'Not now'])
  assertEquals(question.recommended, 'Allow')
  assertEquals(await words(bo), [])
})

test('what the space is told reaches everyone in it but whoever did it', async () => {
  // Each as it happens: a batch is written by one hand.
  for (
    let told of [
      { to: eid, words: 'Bo joined Book club.', by: bo, id: 'j' },
      { to: eid, words: 'Bo joined Book club.', by: bo, id: 'j' },
      { to: bo, words: 'Just for Bo.' },
    ]
  ) await store.g.apply([notification(told)], { trusted: true })
  assertEquals((await words(ada)).slice(1), [
    [false, 'Bo joined Book club.', true],
  ])
  assertEquals(await words(bo), [[false, 'Just for Bo.', true]])
})

test('reading one counts it read, and nobody reads another’s', async () => {
  let [, joined] = (await read(ada)).updates
  let before = (await read(ada)).waiting
  await updating(store, as(ada), { open: joined.eid })
  assertEquals((await read(ada)).waiting, before - 1)
  let [question] = (await read(ada)).updates
  await assertRejects(
    () => updating(store, as(bo), { open: question.eid }),
    'not in your Updates',
  )
})

test('a choice answers the question and goes on in the conversation', async () => {
  let [question] = (await read(ada)).updates
  let { request } = await updating(store, as(ada), {
    choose: question.eid,
    choice: 'Allow',
  }) as { request: string }
  await service.drain()
  let [row] = await store.g.get([question.eid])
  assertEquals((row.decided as { choice: string }).choice, 'Allow')
  assertEquals((await words(ada)).map(([needs]) => needs), [false])
  assertStringIncludes(
    asked.at(-1)!,
    'In their Updates, choosing on your question “Text reminders for Book club?”',
  )
  let [kept] = await store.g.get([request])
  assertEquals((kept.operator_request as { about: string }).about, question.eid)
})

test('words sent about an update reach the Operator with it', async () => {
  let [joined] = (await read(ada)).updates
  await updating(store, as(ada), { reply: joined.eid, say: 'Welcome Bo!' })
  await service.drain()
  assertStringIncludes(
    asked.at(-1)!,
    'replying to your update “Bo joined Book club.”',
  )
  assertStringIncludes(asked.at(-1)!, 'Welcome Bo!')
  await assertRejects(
    () => updating(store, as(ada), { reply: joined.eid, say: ' ' }),
    'Say something',
  )
})

let FIXING = {
  app_files: true,
  app_deploy: true,
  notification_send: true,
  mail_send: false,
  graph_apply: false,
  code_mode: false,
  memory_save: false,
}

test('a fixed break tells its person only what the Operator wrote them, linked to its chat', async () => {
  script.push(
    call('notification_send', {
      subject: 'Recipes: printing works again',
      text: 'The print button stopped working. I fixed it; nothing to do.',
    }),
    said('Fixed print.ts; app_deploy answered 200.'),
  )
  await receive(store, {
    space: eid,
    person: ada,
    channel: 'error',
    app: 'recipes',
  }, 'Fix this error in recipes')
  await service.drain()
  // Its words may be a visitor's: it changes and releases the app that
  // broke, and nothing that takes the space's data past its person.
  let offered = tooled[asked.findLastIndex((a) => a.includes('Fix this'))]
  for (let [tool, held] of Object.entries(FIXING)) {
    assertEquals(offered.includes(tool), held, tool)
  }
  let all = (await read(ada)).updates
  let fixed = all.find((u) => u.subject == 'Recipes: printing works again')!
  // It opens its run's chat at the call that wrote it, and that call is a
  // line there the address scrolls to.
  let [ran, wrote] = await store.g.get([fixed.from!.chat, fixed.from!.entry!])
  assertEquals(!!ran.session, true)
  assertEquals((wrote.call as { name: string }).name, 'notification_send')
  assertEquals(await lands(fixed), true)
  assertEquals(all.some((u) => u.words.includes('print.ts')), false)
  assertEquals(await words(bo), [[false, 'Just for Bo.', true]])
})

test('the Updates page shows what needs the person, a new chat counts it in the side, and a button opens the chat', async () => {
  await store.g.apply([{
    entity: { eid: 'ask' },
    task: {},
    doc: { title: 'Send the invitations?' },
    decision: {
      question: 'Send the invitations?',
      choices: [
        { label: 'Not yet', description: 'Keep them' },
        { label: 'Send', description: 'To all twelve' },
      ],
      recommended: 'Send',
    },
    filed: { project: eid, assignee: ada },
  }], { trusted: true })
  let space = (await directoryOf(p.env.STORE).at(eid))!
  let who = { person: ada, role: 'owner' as const, space: eid }
  let page = async (r: Promise<Response>) =>
    parseHTML(await (await r).text()).document
  let fresh = await page(chatPage(p.env, space, who, 'new'))
  let buttons = (d: Document) =>
    [...d.querySelectorAll('.Update-needs button[name=choice]')]
      .map((b) => b.textContent)
  // A chat counts what needs them in the side, and answers it in Updates.
  assertEquals(buttons(fresh), [])
  let count = (d: Document) => d.querySelector('.Sidebar_Count')?.textContent
  assertEquals(Number(count(fresh)) > 1, true)
  let updates = await page(updatesPage(p.env, space, who))
  assertEquals(buttons(updates), ['Send', 'Not yet'])
  // with no visits to tell of, there is no day to say
  assertEquals(updates.querySelector('.Update-day'), null)
  assertStringIncludes(
    updates.querySelector('.Updates')!.textContent!,
    'Bo joined Book club.',
  )
  // Reading them reads them: only what needs Ada is counted now.
  assertEquals(count(await page(updatesPage(p.env, space, who))), '1')
  let sent = await updatesAnswer(
    new Request('https://yaks.app' + managePath('updates', 'club'), {
      method: 'POST',
      body: new URLSearchParams({ choose: 'ask', choice: 'Send', id: 'r1' }),
    }),
    p.env,
    space,
    who,
  )
  assertEquals(sent.status, 303)
  assertEquals(sent.headers.get('location'), chatPath('club', 'r1'))
  assertEquals(buttons(await page(updatesPage(p.env, space, who))), [])
})

test('a choice shows a picture, prose or a draft, and only its asker reads the picture', async () => {
  let png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
  let sha = 'ab'.repeat(32)
  let app = crypto.randomUUID()
  await p.env.BLOBS.put(attachmentKey({ store: 'club' }, sha), png)
  await store.g.apply([{
    entity: { eid: 'plan' },
    doc: { title: 'The plan', body: 'Meet *monthly*' },
  }], { trusted: true })
  script.push(
    ...[
      call('decision_new', {
        question: 'Which cover?',
        choices: [
          { label: 'Warm', description: 'Orange', shows: sha },
          { label: 'Plain', description: 'In words', shows: 'plan' },
          { label: 'Live', description: 'The app', shows: app },
        ],
        recommended: 'Warm',
      }),
      said('Asked.'),
    ],
  )
  await receive(store, { space: eid, person: ada, channel: 'chat' }, 'Cover')
  await service.drain()
  let cover = (await read(ada)).updates.find((u) => u.words == 'Which cover?')!
  assertEquals(cover.shown, [
    {
      choice: 'Warm',
      eid: sha,
      artifact: { address: sha, media_type: 'image/png' },
    },
    {
      choice: 'Plain',
      eid: 'plan',
      doc: { title: 'The plan', body: 'Meet *monthly*' },
    },
    { choice: 'Live', eid: app },
  ])
  let space = (await directoryOf(p.env.STORE).at(eid))!
  let who = { person: ada, role: 'owner' as const, space: eid }
  let page = parseHTML(await (await updatesPage(p.env, space, who)).text())
    .document
  let card = page.querySelector(`#u-${cover.eid}`)!
  let src = card.querySelector('.Update_Picture')!.getAttribute('src')!
  assertStringIncludes(src, `?shown=${cover.eid}&eid=${sha}`)
  assertEquals(card.querySelector('.Update_Prose em')?.textContent, 'monthly')
  assertStringIncludes(
    card.querySelector('.Update_Draft iframe')!.getAttribute('src')!,
    `?draft=${app}`,
  )
  assertEquals(
    [...card.querySelectorAll('button[name=choice]')].map((b) => b.textContent),
    ['Warm', 'Plain', 'Live'],
  )
  let get = (query: string) =>
    shownAnswer(
      new Request(`https://yaks.app${managePath('updates', 'club')}?${query}`),
      p.env,
      space,
      who,
    )
  let picture = (await get(`shown=${cover.eid}&eid=${sha}`))!
  assertEquals(picture.headers.get('content-type'), 'image/png')
  assertEquals(new Uint8Array(await picture.arrayBuffer()), png)
  await assertRejects(
    () => updating(store, as(bo), { shown: cover.eid, eid: sha }),
    'not in your Updates',
  )
  assertEquals((await get(`shown=${cover.eid}&eid=plan`))!.status, 404)
  assertEquals((await get(`draft=${app}`))!.status, 404)
  assertEquals(await get('other=1'), undefined)
})

// Whether an update's "See the chat" opens a page holding the line its
// address names.
let lands = async (u: Update) => {
  let space = (await directoryOf(p.env.STORE).at(eid))!
  let who = { person: ada, role: 'owner' as const, space: eid }
  let href = new URL(chatAt(space, u), 'https://yaks.app')
  let open = href.pathname.split('/').at(-1)!
  let from = href.searchParams.get('from')
  let d = parseHTML(
    await (await chatPage(
      p.env,
      space,
      who,
      open,
      {},
      null,
      from == null ? undefined : Number(from),
    )).text(),
  ).document
  return !!d.getElementById(href.hash.slice(1))
}

// The page's notices, as each card draws them.
let cards = async (dismissed = false) => {
  let space = (await directoryOf(p.env.STORE).at(eid))!
  let who = { person: ada, role: 'owner' as const, space: eid }
  let d = parseHTML(
    await (await updatesPage(p.env, space, who, {}, dismissed)).text(),
  ).document
  return [...d.querySelectorAll('.Update:not(.Update-needs)')].map((c) => ({
    subject: c.querySelector('.Update_Subject')?.textContent,
    words: c.querySelector('.Update_Words')?.textContent?.trim(),
    links: [...c.querySelectorAll('.Update_Meta a')].map((a) => a.textContent),
    dismiss: !!c.querySelector('input[name=dismiss]'),
  }))
}

test('Updates hold only what was written to the person: no task state and no run report', async () => {
  let report = await receive(
    store,
    { space: eid, person: ada, channel: 'wake' },
    'Check the club',
  )
  await service.drain()
  await store.g.apply([
    {
      entity: { eid: crypto.randomUUID() },
      task: {},
      doc: { title: 'Rename the club' },
      filed: { project: eid },
      completed: { at: new Date().toISOString() },
    },
    // A run's last words, as they were once written into Updates.
    notification({ to: ada, words: 'Ran graph_query; 3 rows.', id: report }),
  ], { trusted: true })
  // A scheduled run's outcome, as it was once written into Updates.
  let ran = crypto.randomUUID()
  await store.g.apply([
    { entity: { eid: ran }, occurrence: { at: new Date().toISOString() } },
    notification({ to: ada, words: 'graph_query: 3 rows', about: ran }),
  ], { trusted: true })
  let all = (await read(ada)).updates.map((u) => u.words)
  assertEquals(all.some((w) => /Rename|graph_query|Done/.test(w)), false)
})

test('an old notice with only its run opens that run at the entry written last before it', async () => {
  let fixed = (await read(ada)).updates
    .find((u) => u.subject == 'Recipes: printing works again')!
  let [row] = await store.g.get([fixed.eid])
  let old = crypto.randomUUID()
  await store.g.apply([{
    entity: { eid: old },
    notification: { to: ada },
    doc: { body: 'Recipes prints again.' },
    $actor: { by: eid, via: fixed.from!.chat },
  }], { trusted: true })
  let [kept] = await store.g.get([old])
  assertEquals(
    (kept.created as { at: string }).at >= (row.created as { at: string }).at,
    true,
  )
  let told = (await read(ada)).updates.find((u) => u.eid == old)!
  assertEquals(told.from?.chat, fixed.from!.chat)
  assertEquals(typeof told.from?.entry, 'string')
  assertEquals(await lands(told), true)
})

test("an old app's word, which names no run, opens the person's conversation at the line written beside it", async () => {
  let root = rootOf(eid, ada)
  let [last] = await store.g.read(
    line`.entry.session=${root}&.order=-entry.seq&.limit=1&*`,
  )
  let seq = Number((last.entry as { seq: number }).seq) + 1
  let words = 'The app club says: dues are due.'
  // As app-operator.ts once wrote one: the notice and its line in one write.
  await store.g.apply([
    notification({ to: ada, words, by: eid, id: crypto.randomUUID() }),
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session: root, seq },
      content: { body: `An app's code reported this: ${words}` },
      notice: {},
      system: {},
      $actor: { by: eid, via: root },
    },
  ], { trusted: true })
  let word = (await read(ada)).updates.find((u) => u.words == words)!
  assertEquals(word.from?.chat, root)
  assertEquals(await lands(word), true)
})

test('a run whose entries start far along is searched to the entry before its notice', async () => {
  let run = crypto.randomUUID()
  let tick = () => new Promise((r) => setTimeout(r, 2))
  let line = (seq: number) => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session: run, seq },
    content: { body: `line ${seq}` },
    notice: {},
    $actor: { by: eid, via: run },
  })
  let lines = [line(250), line(251), line(252)]
  let words = 'Line 251 done.'
  for (
    let rows of [
      [{ entity: { eid: run }, session: {} }, lines[0]],
      [lines[1]],
      [notification({ to: ada, words, by: eid, via: run })],
      [lines[2]],
    ]
  ) {
    await store.g.apply(rows, { trusted: true })
    await tick()
  }
  let told = (await read(ada)).updates.find((u) => u.words == words)!
  assertEquals(told.from?.entry, lines[1].entity.eid)
})

test("every notice links to the conversation it came from, the person's own where it names none", async () => {
  let all = await cards()
  assertEquals(all.length > 0, true)
  for (let card of all) {
    assertEquals(card.links.includes('See the chat'), true, card.words)
  }
})

test('a dismissed notice leaves the page and its count, shows under what was dismissed, and a question cannot be', async () => {
  let notice = (await read(ada)).updates
    .find((u) => u.subject == 'Recipes: printing works again')!
  let before = (await read(ada)).waiting
  await updating(store, as(ada), { dismiss: notice.eid })
  let after = await read(ada)
  assertEquals(after.updates.some((u) => u.eid == notice.eid), false)
  assertEquals(after.waiting, before - +notice.unread)
  let put = await updating(store, as(ada), { dismissed: true }) as {
    updates: Update[]
  }
  assertEquals(put.updates.map((u) => [u.eid, u.dismissed]), [
    [notice.eid, true],
  ])
  assertEquals((await cards(true)).map((c) => [c.subject, c.dismiss]), [
    ['Recipes: printing works again', false],
  ])
  assertEquals((await cards()).every((c) => c.dismiss), true)
  await store.g.apply([{
    entity: { eid: 'ask-later' },
    task: {},
    decision: { question: 'Keep it?', choices: [] },
    filed: { project: eid, assignee: ada },
  }], { trusted: true })
  await assertRejects(
    () => updating(store, as(ada), { dismiss: 'ask-later' }),
    'leaves once you answer',
  )
  await assertRejects(
    () => updating(store, as(bo), { dismiss: notice.eid }),
    'not in your Updates',
  )
})

test('a run nobody watches that fails on yaks.app tells its person so, plainly, once', async () => {
  failing = true
  await receive(
    store,
    { space: eid, person: ada, channel: 'wake' },
    'Send the weekly digest',
  )
  await service.drain()
  let stopped = (await read(ada)).updates.filter((u) =>
    u.subject?.includes("couldn't finish")
  )
  assertEquals(stopped.length, 1)
  assertStringIncludes(stopped[0].words, "on yaks.app's side")
  assertEquals(await lands(stopped[0]), true)
})

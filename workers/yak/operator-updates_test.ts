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
import { notification, type Update, updating } from './operator-updates.ts'
import { parseHTML } from 'linkedom'
import { chatPage, updatesPage } from './operator-page.ts'
import { updatesAnswer } from './updates.ts'
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
let service = operatorService(
  p.env,
  { person: ada, role: 'owner', space: eid },
  operatorModel((req) => {
    asked.push(JSON.stringify(req.items))
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

test('a fixed break tells the space what the Operator did', async () => {
  script.push(said('Recipe box prints again.'))
  await receive(store, {
    space: eid,
    person: ada,
    channel: 'error',
    app: 'recipes',
  }, 'Fix this error in recipes')
  await service.drain()
  for (let person of [ada, bo]) {
    let fixed = (await read(person)).updates
      .find((u) => u.words == 'Recipe box prints again.')
    assertEquals(typeof fixed?.about, 'string')
  }
})

test('the Updates page and a new chat show what needs the person, and a button opens the chat', async () => {
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
  assertEquals(buttons(fresh), ['Send', 'Not yet'])
  let count = (d: Document) => d.querySelector('.Sidebar_Count')?.textContent
  assertEquals(Number(count(fresh)) > 1, true)
  let updates = await page(updatesPage(p.env, space, who))
  assertEquals(buttons(updates), ['Send', 'Not yet'])
  assertEquals(
    updates.querySelector('.Update-day')?.textContent?.trim(),
    'One thing needs you.',
  )
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
  assertEquals(buttons(await page(chatPage(p.env, space, who, 'new'))), [])
})

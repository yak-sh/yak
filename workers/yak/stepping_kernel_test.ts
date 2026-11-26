// Stepping into a home-page demo (D-462) end to end in one process: the demo
// space's guestbook released once a step, its conversation marked
// walkthrough{app} in the demo space's Operator store, and a visitor who
// asks for their own change at step 2. Their space gets the app as step 2
// released it, a conversation that begins with the demo's lines through
// step 2, and a first turn that answers their words, told what the demo set
// up outside the app. Somebody who has talked with their Operator before
// keeps that conversation, and is told where they came from instead.
import { cleanup, test, until } from '@yaks/testing'
import { line as q } from '@yaks/query'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { toolEid } from '@yaks/tools/result'
import { connector, fresh, owned, signIn } from './probe.ts'
import { ai } from './testing.ts'
import type { Env } from './env.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { stepsOf } from './site/home.tsx'
import { START } from './newcomer.ts'
import { sourceReference } from '@yaks/platform/operator-source'

let REQUESTS = [
  'A guestbook for Mum’s 70th that anyone with the link can sign.',
  'Let guests add a photo.',
  'Text me when someone signs.',
  'After the party, email everyone who signed a thank-you.',
]
let ANSWER = 'Made the photos round, as you asked.'
let model = ai(Array.from({ length: 8 }, () => ({ text: ANSWER })))

let env!: Env
let k = await fresh({ AI: model as Env['AI'] }, (e) => (env = e))
cleanup(() => k.stop())
let agent = connector(k, k.owner.cookie)
await owned(k, k.owner.person, 'yourname', 'Demos')
let demo = { space: 'yourname', app: 'guestbook' }
await agent.tool('app_new', {
  ...demo,
  slug: 'guestbook',
  title: 'Guestbook',
  access: 'private',
})
for (let [i] of REQUESTS.entries()) {
  await agent.tool('app_files', {
    ...demo,
    files: [{
      path: 'index.html',
      content: `<h1>Guestbook, step ${i + 1}</h1>`,
    }],
  })
  await agent.tool('app_deploy', { ...demo, message: `step ${i + 1}` })
}
await agent.tool('app_publish', { ...demo, name: 'birthday-guestbook' })
let space = (await k.dir.space('yourname'))!
let source = (await k.dir.app(space, 'guestbook'))!

// The demo space's Operator, its store in memory; every other space's is
// its own object, as it is live.
let person = k.owner.person
let service = operatorService(
  env,
  { person, role: 'owner', space: space.eid },
  operatorModel(() =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: 'test-model',
      items: [{ kind: 'assistant', text: 'Made the guestbook.' }],
      cost: 0.001,
    })
  ),
)
let builders = env.BUILDER
env.BUILDER = {
  ...builders,
  idFromName: (name: string) =>
    name == space.eid ? name : builders.idFromName(name),
  get: (id: unknown) =>
    id === space.eid
      ? service.binding.get(space.eid)
      : builders.get(id as Parameters<typeof builders.get>[0]),
} as Env['BUILDER']

await receive(
  service.store,
  { space: space.eid, person, channel: 'chat' },
  REQUESTS[0],
)
await service.drain()
let session = rootOf(space.eid, person)
let [newest] = await service.store.g.read(
  q`.entry.session=${session}&.order=-entry.seq&.limit=1&*`,
)
let seq = (newest.entry as { seq: number }).seq
let line = (rest: Record<string, unknown>) => ({
  entity: { eid: crypto.randomUUID() },
  entry: { session, seq: ++seq },
  ...rest,
})
// What step 2 did besides, none of which was said: a memory recalled, a reply
// written mid-work, the contact list read with its owner's address and
// number, and a Pending line; its request came by a channel that adds a note
// to the words.
let NOTE = sourceReference('b'.repeat(64))
// The visitor's own words carry a note of their own, so the demo's is told
// apart by its attachment.
let NOT_SAID = [
  'Mum is turning 70',
  'Looking at your contacts first.',
  'ada@example.com',
  '+1 555 0100',
  'Pending; its result will follow.',
  `attachment ${'b'.repeat(64)}`,
]

// Each step's release and the Operator's answer, each later step's request
// before them, and at step 2 a number bought for the alerts to come.
let call = (name: string, args: Record<string, unknown>, value: unknown) => {
  let made = line({ call: { to: toolEid(name), name, args } })
  return [made, line({ result: { call: made.entity.eid, value } })]
}
await service.store.g.apply([
  ...REQUESTS.flatMap((said, i) => [
    ...i ? [line({ content: { body: said + (i == 1 ? NOTE : '') } })] : [],
    ...i == 1
      ? [
        line({
          prompt: { scope: 'local', source: 'operator:earlier' },
          content: { body: NOT_SAID[0] },
        }),
        line({ output: {}, content: { body: NOT_SAID[1] } }),
        ...((read) => [
          ...read,
          line({
            tool_progress: { call: read[0].entity.eid },
            content: { body: NOT_SAID[4] },
          }),
        ])(call('contact_list', {}, { contacts: NOT_SAID.slice(2, 4) })),
        ...call('number_buy', { space: 'yourname' }, { number: '+1555' }),
      ]
      : [],
    ...call('app_deploy', demo, { deployed: true, version: i + 1 }),
    line({ output: {}, content: { body: `Released step ${i + 1}.` } }),
  ]),
  { entity: { eid: session }, walkthrough: { app: 'guestbook' } },
], { trusted: true })

// The box under a step, as the home page draws it (site/home.tsx `Step`),
// or with no step the home page's own box.
let stepIn = (say: string, step: string, cookie = '') =>
  k.at('yaks.app', START, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': '203.0.113.9',
      ...cookie ? { cookie } : {},
    },
    body: new URLSearchParams(
      step ? { say, demo: 'guestbook', step } : { say },
    ).toString(),
  })
let cookieOf = (r: Response) =>
  r.headers.getSetCookie().map((set) => set.split(';')[0]).join('; ')
// The space whose chat a response sends its reader to: yaks.app/<space>/….
let spaceOf = (r: Response) =>
  new URL(r.headers.get('location') ?? '/', 'https://yaks.app').pathname
    .split('/')[1]

// The model's conversation, apart from the tool definitions it was sent.
let lastAsked = () => JSON.stringify(model.asked.at(-1)?.input.messages ?? [])
// The chat they land in, once its `turns`th turn has answered.
let answered = (r: Response, cookie: string, turns = 1) =>
  until(async () => {
    await k.settled()
    let page = await (await k.at(
      'yaks.app',
      new URL(r.headers.get('location')!).pathname,
      { headers: { cookie } },
    )).text()
    return page.split(ANSWER).length > turns ? page : null
  }, { timeout: 10_000 })

test('a stranger stepping in at step 2 gets that app, that history and a first turn answering them', async () => {
  let step = stepsOf('guestbook')[1]
  let r = await stepIn('Make the photos round', step)
  assertEquals(r.status, 303)
  let cookie = cookieOf(r)
  let theirs = (await k.dir.space(spaceOf(r)))!
  let [owner] = await k.dir.owners(theirs)
  assert(await k.dir.newcomer(owner))

  // The app as step 2 released it, pinned to that release.
  let app = (await k.dir.apps(theirs)).find((a) => a.slug == 'guestbook')!
  assertEquals(app.installed?.of, source.eid)
  assertEquals(app.installed?.version, 2)

  // The conversation: the demo's lines through step 2, then their words,
  // then the Operator's answer, which it gave told whose the lines are and
  // what the demo set up outside the app.
  let page = await answered(r, cookie)
  let order = [
    REQUESTS[0],
    REQUESTS[1],
    'Released step 2.',
    'Make the photos round',
    ANSWER,
  ]
  let at = order.map((s) => page.indexOf(s))
  assert(at.every((n, i) => n > (at[i - 1] ?? -1)), JSON.stringify(at))
  assert(!page.includes(REQUESTS[2]))
  let asked = lastAsked()
  assertStringIncludes(asked, "yaks.app's demo of birthday-guestbook")
  assertStringIncludes(asked, `${theirs.slug}/guestbook`)
  assertStringIncludes(asked, 'it called number_buy')
  for (let said of [REQUESTS[0], REQUESTS[1], 'Released step 2.']) {
    assertStringIncludes(asked, said)
  }
  assert(!asked.includes(REQUESTS[2]))
  // Only what was said came with them, and of the tools it called, names.
  for (let unsaid of NOT_SAID) {
    assert(!page.includes(unsaid), unsaid)
    assert(
      !asked.includes(unsaid),
      unsaid + ' in ' +
        asked.slice(
          Math.max(0, asked.indexOf(unsaid) - 300),
          asked.indexOf(unsaid) + 200,
        ),
    )
  }
  assert(!asked.includes('+1555'))
})

// An app of `space`'s copied from the demo's guestbook.
let copyIn = async (space: string) =>
  (await k.dir.apps((await k.dir.space(space))!)).find((a) =>
    a.installed?.of == source.eid
  )!

test('a signed-in person who has never talked with their Operator gets the demo as their conversation', async () => {
  let { person, cookie } = await signIn(k)
  let r = await stepIn('Add a guest count', stepsOf('guestbook')[0], cookie)
  assertEquals(r.status, 303)
  let theirs = (await k.dir.space(spaceOf(r)))!
  assert((await k.dir.owners(theirs)).includes(person))
  assertEquals((await copyIn(theirs.slug)).installed?.version, 1)
  let page = await answered(r, cookie)
  assert(page.indexOf(REQUESTS[0]) < page.indexOf('Add a guest count'))
  assert(!page.includes(REQUESTS[1]))
})

test('a signed-in person who has talked before keeps their conversation, told where they came from', async () => {
  let { cookie } = await signIn(k)
  let BEFORE = 'A recipe box for my family'
  let first = await stepIn(BEFORE, '', cookie)
  await answered(first, cookie)
  let step = stepsOf('guestbook')[1]
  let r = await stepIn('Add a guest count', step, cookie)
  assertEquals(r.status, 303)
  assertEquals(spaceOf(r), spaceOf(first))
  assertEquals((await copyIn(spaceOf(r))).installed?.version, 2)
  let page = await answered(r, cookie, 2)
  assert(page.indexOf(BEFORE) < page.indexOf('Add a guest count'))
  for (let said of [REQUESTS[0], 'Released step 1.']) {
    assert(!page.includes(said), said)
  }
  let asked = lastAsked()
  assertStringIncludes(asked, BEFORE)
  assertStringIncludes(asked, 'stepped into its demo of birthday-guestbook')
  assertStringIncludes(asked, `${spaceOf(r)}/guestbook`)
  assertStringIncludes(asked, 'it called number_buy')
  assert(!asked.includes(REQUESTS[0]))
})

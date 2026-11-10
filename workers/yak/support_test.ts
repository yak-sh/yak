// Support threads (support.ts): feedback opens one, its person reads and adds
// to it, TaskMaster answers it through the platform's door, and every message
// from the thread's side owes a letter that waits out a mail outage.
import { cleanup, equal, ok, test, until } from '@yaks/testing'
import { assertRejects, assertStringIncludes } from '@std/assert'
import {
  answering,
  type Asking,
  opening,
  opens,
  saying,
  type Thread,
} from './support.ts'
import {
  connector,
  fresh,
  type Kernel,
  kernel,
  letters,
  meta,
  seed,
  signIn,
  unique,
} from './probe.ts'
import type { Env } from './env.ts'

// ---- who reads a thread ----------------------------------------------------

let thread = (person: string | null, space: string | null): Thread => ({
  eid: 't',
  title: '',
  words: '',
  person,
  session: null,
  call: null,
  space,
  app: null,
  version: null,
  release: null,
  at: null,
  completed: null,
  messages: [],
})
let asking = (
  person: string,
  { narrowed = null as string | null, seats = [] as string[], admin = false } =
    {},
): Asking => ({
  person,
  narrowed,
  member: (space) => Promise.resolve(seats.includes(space)),
  admin: () => Promise.resolve(admin),
})

test('a thread opens to its person, its space and the platform, within a credential', async () => {
  let cases: [string, Thread, Asking, boolean][] = [
    ['its person', thread('ada', 's'), asking('ada'), true],
    [
      'a member of its space',
      thread('ada', 's'),
      asking('bo', { seats: ['s'] }),
      true,
    ],
    [
      'somebody else',
      thread('ada', 's'),
      asking('bo', { seats: ['x'] }),
      false,
    ],
    ['nobody signed in', thread(null, 's'), asking(''), false],
    [
      'the platform',
      thread('ada', 's'),
      asking('admin', { admin: true }),
      true,
    ],
    [
      'the platform, on a signed-out thread',
      thread(null, null),
      asking('admin', { admin: true }),
      true,
    ],
    [
      'anybody else, on a signed-out thread',
      thread(null, null),
      asking('bo'),
      false,
    ],
    [
      'its person, narrowed to its space',
      thread('ada', 's'),
      asking('ada', { narrowed: 's' }),
      true,
    ],
    [
      'its person, narrowed elsewhere',
      thread('ada', 's'),
      asking('ada', { narrowed: 'x' }),
      false,
    ],
    [
      'the platform, narrowed elsewhere',
      thread('ada', 's'),
      asking('admin', { narrowed: 'x', admin: true }),
      false,
    ],
    [
      'a narrowed credential, on a thread of no space',
      thread('ada', null),
      asking('ada', { narrowed: 'x' }),
      false,
    ],
  ]
  for (let [name, t, a, want] of cases) equal(await opens(t, a), want, name)
})

// ---- the rows ---------------------------------------------------------------

let where = { release: 'r', at: '2026-11-10T00:00:00.000Z' }
let letter = { subject: 'feedback: x', lines: ['someone'] }

test('the same call opens the same thread and owes the same letter', () => {
  let said = { words: 'The board scrolls', call: 'call-1' }
  let once = opening({}, said, where, letter)
  equal(opening({}, said, where, letter), once)
  equal(once.length, 3)
  equal(once[2].mail, { from: 'hello@bot.yak.sh', target: once[0].entity.eid })
  equal(once[2].deliver, { to: once[1].entity.eid })
  ok(opening({}, { words: 'x' }, where, null).length == 1)
  ok(
    opening({}, { words: 'x' }, where, null)[0].entity.eid !=
      opening({}, { words: 'x' }, where, null)[0].entity.eid,
  )
  let more = saying({}, 'thread', { words: 'And', call: 'call-2' }, letter)
  equal(saying({}, 'thread', { words: 'And', call: 'call-2' }, letter), more)
  equal(more[0].comment, { target: 'thread' })
  equal((more[2].mail as { target: string }).target, more[0].entity.eid)
})

test("the platform's answer is a message without support, a fix edge and a mark", () => {
  let [message, edge, done] = answering('t', {
    words: 'Fixed.',
    reply_to: 'm',
    fix: 'f',
    complete: true,
  }, 'a')
  equal(message, {
    entity: { eid: 'a' },
    comment: { target: 't', reply_to: 'm' },
    doc: { body: 'Fixed.' },
  })
  equal([edge.edge, edge.about], [{ from: 'a', to: 'f' }, {}])
  equal(done, { entity: { eid: 't' }, completed: {} })
  equal(answering('t', { complete: true }, 'a'), [done])
  equal(answering('t', {}, 'a'), [])
})

// ---- through the kernel ------------------------------------------------------

let k = await kernel()
let them = await seed(k, [{ slug: unique('helped'), apps: ['board'] }])
let agent = connector(k, them.cookie)
let ana = await signIn(k)

type Value = {
  thread: string
  link: string
  completed: unknown
  messages: { message: string; from: string; words: string; fixes: string[] }[]
}
let feedback = async (who: ReturnType<typeof connector>, args: unknown) => {
  let { text, value } = await who.answer('feedback', args)
  return { text, value: value as Value }
}
let support = (fields?: Record<string, string>, cookie = k.owner.cookie) =>
  k.at(k.host, '/api/support', {
    ...(fields
      ? {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields).toString(),
      }
      : { headers: { cookie } }),
  })
let letterOf = async (about: string, at: Kernel = k) => {
  await at.settled()
  return (await meta(at).query(
    `.mail.target=${about}&?deliver&?delivered&?doc`,
  ))[0] as Record<string, Record<string, unknown>> | undefined
}

test('a thread is opened, answered and read in the same place', async () => {
  let opened = await feedback(agent, {
    app: 'board',
    text: 'The board scrolls sideways on a phone.',
  })
  let { thread, link } = opened.value
  assertStringIncludes(opened.text, `feedback(thread: '${thread}')`)
  equal(link, `https://yaks.app/support/${thread}`)
  let sent = (await letterOf(thread))!
  ok(sent.delivered, 'the letter went')
  assertStringIncludes(String(sent.doc.body), `thread ${thread}`)

  // TaskMaster sees it waiting, and answers it as the platform's admin.
  let listed = await (await support()).json()
  ok(listed.threads.some((t: { eid: string }) => t.eid == thread))
  equal((await support({ thread, text: 'x' }, them.cookie)).status, 403)
  let answered = await support({
    thread,
    text: 'Fixed: the board wraps now.',
    fix: crypto.randomUUID(),
    complete: 'true',
  })
  equal(answered.status, 200)
  assertStringIncludes((await answered.json()).text, 'yaks.app')

  // Its person reads the answer, the fix and the outcome.
  let read = await feedback(agent, { thread })
  equal(read.value.messages.map((m) => m.from), ['platform'])
  equal(read.value.messages[0].fixes.length, 1)
  ok(read.value.completed)
  assertStringIncludes(read.text, 'Fixed: the board wraps now.')
  assertStringIncludes(read.text, 'Completed')

  // And adds to it, which TaskMaster is told of in a letter of its own.
  let more = await feedback(agent, { thread, text: 'Thank you!' })
  let mine = more.value.messages.at(-1)!
  equal([mine.from, mine.words], ['person', 'Thank you!'])
  ok((await letterOf(mine.message))?.delivered)
  waiting = (await (await support()).json()).threads
  ok(!waiting.some((t: { eid: string }) => t.eid == thread), 'completed')
})
let waiting: { eid: string }[] = []

test('nobody else reads a thread, and nobody writes its owner', async () => {
  let { thread } =
    (await feedback(agent, { app: 'board', text: 'Mine alone.' }))
      .value
  let stranger = connector(k, undefined, undefined, '/mcp?auth=mixed')
  for (let who of [connector(k, ana.cookie), stranger]) {
    await assertRejects(() => who.answer('feedback', { thread }))
    await assertRejects(() =>
      who.answer('feedback', { thread, text: 'Not mine.' })
    )
  }
  let no = await assertRejects(
    () => connector(k, ana.cookie).answer('feedback', { thread }),
    Error,
  )
  assertStringIncludes(no.message, `no thread ${thread} that you can read`)
  // A thread's owner is the credential's, which no graph write can name.
  let forged = await connector(k, k.owner.cookie).answer('graph_apply', {
    app: 'yak/platform',
    entities: [{ entity: { eid: thread }, support: { person: ana.person } }],
  }).catch((e: Error) => e.message)
  assertStringIncludes(String(forged), 'server-owned')
  await assertRejects(() =>
    connector(k, ana.cookie).answer('feedback', { thread })
  )
})

test('a stranger still opens a thread, and cannot read it back', async () => {
  let stranger = connector(k, undefined, undefined, '/mcp?auth=mixed')
  let opened = await feedback(stranger, { text: 'Signed out, and stuck.' })
  assertStringIncludes(opened.text, 'said signed out')
  assertStringIncludes(
    String((await letterOf(opened.value.thread))?.doc.body),
    'someone, signed out',
  )
  let no = await assertRejects(
    () => stranger.answer('feedback', { thread: opened.value.thread }),
    Error,
  )
  assertStringIncludes(no.message, 'signed in')
})

// The kernel's mail fetch, which this test turns off to stand for an outage:
// the mail API declines with a 429, so the letter is known not to have left.
test('the words stand through a mail outage, and the letter goes once after it', async () => {
  let env!: Env
  let at = await fresh({}, (e) => env = e)
  cleanup(() => at.stop())
  let me = connector(at, (await signIn(at)).cookie)
  let letter = (thread: string) =>
    meta(at).query(`.mail.target=${thread}&?deliver&?delivered`) as Promise<
      Record<string, Record<string, unknown>>[]
    >
  env.MAIL_FETCH = () =>
    Promise.resolve(
      new Response('busy', { status: 429, headers: { 'retry-after': '1' } }),
    )
  let { thread } = (await feedback(me, { text: 'Said in an outage.' })).value
  let held = await until(async () =>
    (await letter(thread)).find((l) => l.deliver.waiting)
  )
  ok(!held.delivered, 'not marked delivered before it went')
  assertStringIncludes(
    (await feedback(me, { thread })).text,
    'Said in an outage.',
  )
  // The outage ends; the pool tries the same letter again, and only it.
  env.MAIL_FETCH = undefined
  let sent = await until(
    async () => (await letter(thread)).find((l) => l.delivered),
    { timeout: 10_000 },
  )
  equal(sent.entity.eid, held.entity.eid)
  equal(letters(at, 'hello@yaks.app').length, 1)
})

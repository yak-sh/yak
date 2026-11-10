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
import { carrying } from './support-reply.ts'
import { managePath } from './route.ts'
import { parseHTML } from 'linkedom'

// ---- who reads a thread ----------------------------------------------------

let thread = (person: string | null, space: string | null): Thread => ({
  eid: 't',
  title: '',
  words: '',
  person,
  session: null,
  call: null,
  agent: null,
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
  equal(more[1], { entity: { eid: 'thread' }, completed: null }, 'reopens')
  equal((more[3].mail as { target: string }).target, more[0].entity.eid)
})

test("the platform's answer is a message without support, a fix edge and a mark", () => {
  let [message, edge, kept, done] = answering('t', {
    words: 'Fixed.',
    reply_to: 'm',
    fix: { eid: 'f', title: 'Wrap the board' },
    complete: true,
  }, 'a')
  equal(message, {
    entity: { eid: 'a' },
    comment: { target: 't', reply_to: 'm' },
    doc: { body: 'Fixed.' },
  })
  equal([edge.edge, edge.about], [{ from: 'a', to: 'f' }, {}])
  equal(kept, { entity: { eid: 'f' }, doc: { title: 'Wrap the board' } })
  equal(done, { entity: { eid: 't' }, completed: {} })
  equal(answering('t', { complete: true }, 'a'), [done])
  equal(answering('t', {}, 'a'), [])
})

// ---- what an answer owes ---------------------------------------------------

let said = (
  eid: string,
  from: 'person' | 'platform',
  at: string,
): Thread['messages'][number] => ({
  eid,
  words: eid,
  from,
  by: null,
  via: null,
  at,
  reply_to: null,
  person: null,
  session: null,
  call: null,
  fixes: [],
})

test('an answer owes its person what it says, and a bare completion its outcome', () => {
  let t = (done: string | null, ...messages: Thread['messages']) => ({
    ...thread('ada', 's'),
    completed: done ? { at: done, by: null } : null,
    messages,
  })
  let answer = said('a', 'platform', '2')
  let cases: [string, Thread, string, unknown][] = [
    ['an answer', t(null, answer), 'a', { m: answer }],
    ['their own words', t(null, said('p', 'person', '1')), 'p', null],
    ['completed alone', t('3', answer), 't', {}],
    ['completed with an answer', t('2', answer), 't', null],
    ['still open', t(null, answer), 't', null],
    ['signed out', { ...t(null, answer), person: null }, 'a', null],
  ]
  for (let [name, th, eid, want] of cases) {
    equal(carrying(th, eid), want, name)
  }
})

// ---- through the kernel ------------------------------------------------------

let k = await kernel()
// Someone with a space of their own and an app in it, and their agent: each
// case its own, since a person opens three threads an hour.
let helped = async () => {
  let slug = unique('helped')
  let them = await seed(k, [{ slug, apps: ['board'] }])
  return { ...them, slug, agent: connector(k, them.cookie) }
}
let them = await helped()
let agent = them.agent
let ana = await signIn(k)

// A page as a person's browser gets it, and every word a tool's result
// carries, the lines riding beside its answer included.
let opened = async (path: string, cookie?: string) => {
  let r = await k.at(k.host, path, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  })
  return {
    status: r.status,
    location: r.headers.get('location'),
    document: parseHTML(await r.text()).document,
  }
}
let carried = async (who: ReturnType<typeof connector>, name: string) => {
  let out = await who.call('tools/call', { name, arguments: {} })
  return (out.content as { text: string }[]).map((c) => c.text).join('\n')
}

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

  // And adds to it, which TaskMaster is told of in a letter of its own, and
  // which puts the thread back among those waiting for an answer.
  let more = await feedback(agent, { thread, text: 'Thank you!' })
  let mine = more.value.messages.at(-1)!
  equal([mine.from, mine.words], ['person', 'Thank you!'])
  ok((await letterOf(mine.message))?.delivered)
  equal(more.value.completed, null)
  let waiting = (await (await support()).json()).threads
  ok(waiting.some((t: { eid: string }) => t.eid == thread), 'reopened')
})

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

test("an answer rides the agent's next result once, and the person's Updates lead to the thread and its outcome", async () => {
  let me = await helped()
  let { thread } =
    (await feedback(me.agent, { app: 'board', text: 'The chart is blank.' }))
      .value
  let reply = 'Fixed: the chart draws now.'
  equal((await support({ thread, text: reply, complete: 'true' })).status, 200)
  await k.settled()
  // A read carries it, and the next result does not again.
  assertStringIncludes(await carried(me.agent, 'about'), reply)
  await k.settled()
  ok(!(await carried(me.agent, 'about')).includes(reply), 'carried once')
  ok(!(await carried(agent, 'about')).includes(reply), 'nobody else hears it')

  let updates = await opened(managePath('updates', me.slug), me.cookie)
  let link = [...updates.document.querySelectorAll('a')]
    .map((a) => a.getAttribute('href') ?? '')
    .find((href) => href.endsWith(`/support/${thread}`))
  ok(link, 'their Updates link the thread')
  let shown = await opened(new URL(link!).pathname, me.cookie)
  equal(shown.status, 200)
  let text = shown.document.body.textContent ?? ''
  for (let words of ['The chart is blank.', reply, 'marked this done']) {
    assertStringIncludes(text, words)
  }
})

test('an answer on a thread said in no space reaches the Updates of their own space, and their agent', async () => {
  // Two spaces of theirs and no app named: the thread names no space.
  let me = await helped()
  let { thread } = (await feedback(me.agent, { text: 'Where did it go?' }))
    .value
  let one = async (q: string) =>
    (await meta(k).query(q))[0] as Record<string, Record<string, string>>
  let seat = await one(`.member.person=${me.person}&.member.own=true`)
  let own = await one(`.entity.eid=${seat.member.space}&?space`)
  ok(own.space.slug != me.slug, 'their own space is not the seeded one')
  let reply = 'It is back where it was.'
  equal((await support({ thread, text: reply })).status, 200)
  await k.settled()
  let linked = async (slug: string) =>
    [...(await opened(managePath('updates', slug), me.cookie)).document
      .querySelectorAll('a')]
      .some((a) =>
        (a.getAttribute('href') ?? '').endsWith(`/support/${thread}`)
      )
  ok(await linked(own.space.slug), 'their own Updates link the thread')
  ok(!await linked(me.slug), 'their other space hears nothing')
  assertStringIncludes(await carried(me.agent, 'about'), reply)
})

test('a fix that is a commit links to it in the public repository, and any other fix is its title', async () => {
  let me = await helped()
  let { thread } =
    (await feedback(me.agent, { app: 'board', text: 'Dates are wrong.' }))
      .value
  let sha = '82e93df529d08088f62fcb6997f6174fbc3353fa'
  let task = crypto.randomUUID(), bare = crypto.randomUUID()
  let answers: Record<string, string>[] = [
    { fix: sha, fix_message: 'T-1 Dates read in your zone\n\nWhy.' },
    { fix: task, fix_title: 'Dates read in your zone' },
    { fix: bare },
  ]
  for (let fields of answers) {
    equal((await support({ thread, ...fields })).status, 200)
  }
  await k.settled()
  let fixes = [
    ...(await opened(`/support/${thread}`, me.cookie)).document
      .querySelectorAll('.Support_Fix'),
  ].map((p) => {
    let a = p.querySelector('a')
    return [p.textContent, a?.getAttribute('href') ?? null]
  })
  equal(fixes, [
    [
      'Fix: T-1 Dates read in your zone',
      `https://github.com/yak-sh/yak/commit/${sha}`,
    ],
    ['Fix: Dates read in your zone', null],
    [`Fix: ${bare}`, null],
  ])
  let updates = await opened(managePath('updates', me.slug), me.cookie)
  ok(
    [...updates.document.querySelectorAll('a')].some((a) =>
      a.getAttribute('href')?.endsWith(`/commit/${sha}`)
    ),
    'their Updates link the commit',
  )
  assertStringIncludes(
    await carried(me.agent, 'about'),
    `T-1 Dates read in your zone (https://github.com/yak-sh/yak/commit/${sha})`,
  )
})

test('the person adds to a thread from its page, as the tool does', async () => {
  let me = await helped()
  let { thread } =
    (await feedback(me.agent, { app: 'board', text: 'Buttons overlap.' }))
      .value
  let posted = await k.at(k.host, `/support/${thread}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: me.cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ text: 'Only on a phone.' }).toString(),
  })
  equal(posted.status, 303)
  let mine = (await feedback(me.agent, { thread })).value.messages.at(-1)!
  equal([mine.from, mine.words], ['person', 'Only on a phone.'])
  ok((await letterOf(mine.message))?.delivered, 'TaskMaster is told')
  assertStringIncludes(
    (await opened(`/support/${thread}`, me.cookie)).document.body
      .textContent ?? '',
    'Only on a phone.',
  )
})

test("two spaces never read each other's threads, and a signed-out one opens to nobody here", async () => {
  let me = await helped(), you = await helped()
  let mine = (await feedback(me.agent, { app: 'board', text: 'Mine.' })).value
    .thread
  let yours = (await feedback(you.agent, { app: 'board', text: 'Yours.' }))
    .value.thread
  equal((await opened(`/support/${mine}`, me.cookie)).status, 200)
  equal((await opened(`/support/${yours}`, me.cookie)).status, 404)
  equal((await opened(`/support/${mine}`, you.cookie)).status, 404)
  await assertRejects(() => me.agent.answer('feedback', { thread: yours }))
  let stranger = connector(k, undefined, undefined, '/mcp?auth=mixed')
  let unsigned =
    (await feedback(stranger, { text: 'Said signed out.' })).value.thread
  equal((await opened(`/support/${unsigned}`, me.cookie)).status, 404)
  let away = await opened(`/support/${mine}`)
  equal(away.status, 303)
  assertStringIncludes(away.location ?? '', '/login?return=')
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

// A church member signs in to the directory with what it already holds for
// them, the address or the number a code proved (recognized.ts, join.ts,
// T-153688): their sign-ups start filled in and name them, Join opens the
// members' pages, and the church's sign-ups stay the church's.
import type { Comp } from '@yaks/graph'
import { cleanup, equal, ok, test } from '@yaks/testing'
import { connector, fresh, signedIn, signIn, unique } from './probe.ts'
import type { Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'

let env!: Env
let k = await fresh({}, (value) => env = value)
cleanup(() => k.stop())
let owner = await signIn(k), agent = connector(k, owner.cookie)
let host = `${owner.name}.${k.host}`, app = unique('directory')
let txt = { type: 'string' }
await agent.tool('app_new', {
  slug: app,
  title: 'Directory',
  access: 'private',
})
await agent.tool('app_files', {
  app,
  files: [
    { path: 'index.html', content: '<h1>Members</h1>' },
    {
      path: 'seed.json',
      content: JSON.stringify([{ entity: { eid: '$a' }, doc: { title: 'S' } }]),
    },
    {
      path: 'vocab.json',
      content: JSON.stringify({
        join: {
          emails: ['individual.email'],
          phones: ['phone.number'],
          where: '.individual.status=member,attender',
        },
        $defs: {
          individual: {
            properties: { first: txt, email: txt, phone: txt, status: txt },
          },
        },
      }),
    },
  ],
})
await agent.tool('app_deploy', { app })

let ann = await signIn(k, `${unique('ann')}@bot.yak.sh`)
let cy = await signIn(k, `${unique('cy')}@bot.yak.sh`)
let stranger = await signIn(k)
// Bo signed in by text: the platform holds his number, and no address.
let bo = crypto.randomUUID()
await meta(env).apply([
  { entity: { eid: bo }, person: {}, phone: { number: '+12695550177' } },
], KERNEL)
let boCookie = await signedIn(k, bo)

let [annRow, boRow, cyRow, form, email, first, said, share] = Array.from(
  { length: 8 },
  () => crypto.randomUUID(),
)
await agent.tool('graph_apply', {
  app,
  entities: [
    // As a secretary typed it, in capitals.
    {
      entity: { eid: annRow },
      individual: {
        first: 'Ann',
        email: ann.email.toUpperCase(),
        status: 'member',
      },
    },
    {
      entity: { eid: boRow },
      individual: { first: 'Bo', phone: '(269) 555-0177', status: 'attender' },
    },
    {
      entity: { eid: cyRow },
      individual: { first: 'Cy', email: cy.email, status: 'former' },
    },
    {
      entity: { eid: form },
      alias: { name: 'prayer' },
      form: { shares: { question: share, is: 'Our church' } },
    },
    {
      entity: { eid: share },
      question: { form, kind: 'choose', label: 'Share with', order: 1 },
    },
    {
      entity: { eid: first },
      question: {
        form,
        kind: 'line',
        label: 'Name',
        fills: 'individual.first',
      },
    },
    {
      entity: { eid: email },
      question: {
        form,
        kind: 'email',
        label: 'Email',
        fills: 'individual.email',
      },
    },
    {
      entity: { eid: said },
      question: {
        form,
        kind: 'lines',
        label: 'Your request',
        required: true,
        shared: true,
      },
    },
  ],
})

let at = (path: string, cookie?: string, init: RequestInit = {}) =>
  k.at(host, `/${app}/${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...cookie ? { cookie } : {}, ...init.headers },
  })
let shown = async (cookie?: string) =>
  (await (await at('api/form/prayer', cookie)).json()).answers
let pray = (cookie: string | undefined, words: string, to = 'Our church') =>
  at('api/form/prayer', cookie, {
    method: 'POST',
    body: JSON.stringify({ answers: { [said]: words, [share]: to } }),
  })
let joinFor = async (cookie: string) =>
  (await (await at('api/me', cookie)).json()).join

test('a member signed in by address or number finds their sign-up filled in', async () => {
  equal(await shown(ann.cookie), {
    [first]: 'Ann',
    [email]: ann.email.toUpperCase(),
  })
  equal(await shown(boCookie), { [first]: 'Bo' })
  for (let cookie of [undefined, stranger.cookie]) {
    equal(await shown(cookie), undefined)
  }
})

test('a sign-up names the member who sent it, and a stranger is nobody', async () => {
  equal((await pray(ann.cookie, 'Ann')).status, 204)
  equal((await pray(stranger.cookie, 'S', 'Just the prayer team')).status, 204)
  await k.settled()
  let rows = (await agent.answer('graph_query', {
    app,
    query: `.registration.form=${form}&*`,
  })).rows
  let by = (words: string) =>
    rows.find((r) => ((r.registration as Comp).answers as Comp)[said] == words)
      ?.registration as Comp
  equal([by('Ann').person, by('Ann').submitter], [annRow, ann.person])
  equal(by('S').submitter, stranger.person)
  ok(by('S').person != annRow)
})

test('current members are offered Join by address or number; others are not', async () => {
  equal(await joinFor(ann.cookie), 'viewer')
  equal(await joinFor(boCookie), 'viewer')
  equal(await joinFor(cy.cookie), null)
  equal(await joinFor(stranger.cookie), null)
})

test('a member who joins reads the directory and what was shared, not sign-ups', async () => {
  let joined = await at('api/join', boCookie, { method: 'POST' })
  equal(await joined.json(), { joined: 'viewer' })
  equal((await at('', boCookie)).status, 200)
  let read = async (q: string) =>
    await (await at(`api/query?q=${encodeURIComponent(q)}`, boCookie)).json()
  let names = (await read('.individual')).map((r: { individual: Comp }) =>
    r.individual.first
  )
  ok(['Ann', 'Bo', 'Cy'].every((n) => names.includes(n)), names)
  equal(await read('.registration'), [])
  equal(
    (await read('.shared')).map((r: { shared: Comp }) => r.shared.answers),
    [{ [said]: 'Ann' }],
  )
})

test('published, the directory shows a member Join and a stranger its sample', async () => {
  await agent.tool('app_publish', { app, name: app })
  let shut = await at('', ann.cookie)
  equal(shut.status, 403)
  ok((await shut.text()).includes('Join Directory'))
  let sample = await at('', stranger.cookie)
  await sample.body?.cancel()
  equal(sample.status, 200)
  equal((await (await at('api/me', stranger.cookie)).json()).visit, {
    kept: false,
  })
})

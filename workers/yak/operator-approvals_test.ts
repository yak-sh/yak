// A member's escalating act waits for their tap on every channel (T-2075):
// on a link texted to their number (T-1864), or given in the answer where
// only they, signed in, open it. The link is spent once, lives LIFE, and is
// bound to the one act and its arguments.
import { equal, test } from '@yaks/testing'
import { line } from '@yaks/query'
import type { Tool } from '@yaks/session'
import { operatorMemory } from './operator-testing.ts'
import { opened } from './lib/token.ts'
import {
  acquainted,
  answered,
  type Approval,
  approvals,
  asker,
  type At,
  confirming,
  digestOf,
  LIFE,
} from './operator-approvals.ts'
import { approvalCard } from './operator-approval-card.ts'
import { updatesOf, updating } from './operator-updates.ts'
import { renderToString } from 'preact-render-to-string'
import type { Env } from './env.ts'
import type { OperatorStore } from './operator-store.ts'
import type { Space } from './directory.ts'

let SECRET = 'secret'
let place = crypto.randomUUID()
let env = { SESSION_SECRET: SECRET } as Env
let store = operatorMemory()
let person = crypto.randomUUID(), session = crypto.randomUUID()
let NUMBER = '+12695550142'
let clock = Date.now()
await store.g.apply([{ entity: { eid: session }, session: {} }], {
  trusted: true,
})
let texts: { to: string; words: string }[] = []
let ask = asker(
  env,
  store,
  { eid: crypto.randomUUID() } as Space,
  { person, session, number: NUMBER },
  (to, words) => Promise.resolve(texts.push({ to, words })),
  () => clock,
)

// What a tool's calls were, by its name.
let ran: string[] = []
let tool = (name: string): Tool => ({
  name,
  description: name,
  parameters: { type: 'object' },
  run: (args) => (ran.push(`${name} ${JSON.stringify(args)}`), 'ran'),
})
// The space's one member, and an address the Operator wrote to before.
let known = acquainted(store, () => Promise.resolve(['Ada@x.com']))
await store.g.apply([{
  entity: { eid: crypto.randomUUID() },
  email: { address: 'bo@x.com' },
  recipient: {},
}], { trusted: true })
let tools = confirming(
  [
    tool('member_add'),
    tool('grant'),
    tool('app_files'),
    tool('mail_send'),
    tool('api_call'),
    tool('gmail_send'),
  ],
  ask,
  { known, texted: true, place: 'Craft & Concept' },
)
let named = (name: string) => tools.find((t) => t.name == name)!

// The approval the newest text links to.
let linked = async () => {
  let t = texts.at(-1)!.words.match(/approve\?t=(\S+)/)![1]
  let [, approval, digest] = (await opened<[string, string, string]>(
    'approval',
    t,
    SECRET,
  ))!
  return { approval, digest }
}
let press = approvals(
  store,
  async (a) =>
    (await tools.find((t) => t.name == 'app_files')!.run(
      { [a.tool]: a.args },
    )) as string,
  () => clock,
)

test('an escalating call texts a link instead of running; any other runs', async () => {
  let said = await named('member_add').run({
    email: 'eve@x.com',
    role: 'owner',
  })
  equal(String(said).startsWith('Nothing has happened yet'), true)
  equal(texts.at(-1)!.to, NUMBER)
  equal(
    texts.at(-1)!.words.startsWith(
      'Add eve@x.com to Craft & Concept as an owner? Tap',
    ),
    true,
  )
  await named('grant').run({ revoke: 'abc' })
  await named('app_files').run({ files: [] })
  equal(ran, ['grant {"revoke":"abc"}', 'app_files {"files":[]}'])
  equal(texts.length, 1)
})

test('opening spends nothing; the press runs it once; a second press runs nothing', async () => {
  let { approval, digest } = await linked()
  ran.length = 0
  equal((await press(approval, digest)).state, 'waiting')
  equal(ran, [])
  let [one, two] = await Promise.all([
    press(approval, digest, { press: true }),
    press(approval, digest, { press: true }),
  ])
  equal([one.state, two.state].sort(), ['done', 'used'])
  equal((await press(approval, digest, { press: true })).state, 'used')
  equal(ran, ['app_files {"member_add":{"email":"eve@x.com","role":"owner"}}'])
  let [note] = await store.g.read(
    line`.entry.session=${session} .notice !operator_approval .fields=content.body`,
  )
  equal(
    String((note.content as { body: string }).body).includes('eve@x.com'),
    true,
  )
})

test('Decline spends the link and runs nothing, and the conversation hears it', async () => {
  await named('member_add').run({ email: 'zed@x.com' })
  let { approval, digest } = await linked()
  ran.length = 0
  equal((await press(approval, digest, { decline: true })).state, 'declined')
  equal((await press(approval, digest, { press: true })).state, 'used')
  equal(ran, [])
  let notes = await store.g.read(
    line`.entry.session=${session} .notice !operator_approval .fields=content.body`,
  )
  equal(
    notes.some((n) =>
      /Decline .*zed@x\.com.* was not done/.test(
        String((n.content as { body: string }).body),
      )
    ),
    true,
  )
})

test('a link is bound to its act: changed arguments open nothing', async () => {
  await named('member_add').run({ email: 'eve@x.com' })
  let { approval, digest } = await linked()
  let [row] = await store.g.get([approval])
  let a = row.operator_approval as Parameters<typeof digestOf>[0]
  equal(digest, digestOf(a))
  await store.g.apply([{
    entity: { eid: approval },
    operator_approval: { args: { email: 'mallory@x.com', role: 'owner' } },
  }], { trusted: true })
  equal((await press(approval, digest, { press: true })).state, 'gone')
  equal((await press(approval, 'forged', { press: true })).state, 'gone')
})

test('a link dies after LIFE', async () => {
  await named('member_add').run({ email: 'eve@x.com' })
  let { approval, digest } = await linked()
  clock += LIFE + 1
  equal((await press(approval, digest, { press: true })).state, 'expired')
})

test('approval_request asks for any tool the turn holds, and only those', async () => {
  let asked = named('approval_request')
  await asked.run({
    tool: 'app_files',
    args: { files: ['index.html'] },
    say: 'Post the closing notice on the home page.',
  })
  equal(
    texts.at(-1)!.words.startsWith(
      'Post the closing notice on the home page? Tap',
    ),
    true,
  )
  let refused = await Promise.resolve()
    .then(() => asked.run({ tool: 'nothing', args: {}, say: 'x' }))
    .then(() => '', (e: Error) => e.message)
  equal(refused, 'This turn holds no tool called nothing.')
})

test('mail to a member or an address written to before sends at once; to someone new it waits', async () => {
  ran.length = 0
  let sent = texts.length
  await named('mail_send').run({ to: 'ada@x.com', text: 'hi' })
  await named('mail_send').run({ to: 'BO@x.com', text: 'hi' })
  equal(ran.length, 2)
  let said = await named('mail_send').run({ to: 'eve@x.com', text: 'hi' })
  equal(String(said).startsWith('Nothing has happened yet'), true)
  equal(texts.at(-1)!.words.startsWith('Email eve@x.com? Tap'), true)
  equal([ran.length, texts.length], [2, sent + 1])
})

test("an outside service's calls run with no tap, writes too; member_add still waits", async () => {
  ran.length = 0
  let sent = texts.length
  let reply = {
    integration: 'discord',
    method: 'POST',
    path: '/channels/7/messages',
    body: { content: 'hi' },
  }
  let role = {
    integration: 'discord',
    method: 'PUT',
    path: '/guilds/1/members/2/roles/3',
  }
  let mail = { to: 'eve@x.com', subject: 'hi' }
  await named('api_call').run(reply)
  await named('api_call').run(role)
  await named('gmail_send').run(mail)
  equal(ran, [
    `api_call ${JSON.stringify(reply)}`,
    `api_call ${JSON.stringify(role)}`,
    `gmail_send ${JSON.stringify(mail)}`,
  ])
  equal(texts.length, sent)
  await named('member_add').run({ email: 'eve@x.com' })
  equal([ran.length, texts.length], [3, sent + 1])
})

// member_add as a turn asks it where its person reads at `at`.
let asking = (at: Partial<At>) =>
  confirming(
    [tool('member_add')],
    asker(
      env,
      store,
      { eid: place } as Space,
      { person, session, ...at },
      () => Promise.reject(new Error('nothing is texted')),
      () => clock,
    ),
    { known },
  )[0]

test('elsewhere the link comes back in the answer with words, and opens only for its person signed in', async () => {
  let said = String(await asking({}).run({ email: 'eve@x.com' }))
  equal(
    said.includes('[Approve: Add eve@x.com to the space as an editor]('),
    true,
  )
  let t = said.match(/approve\?t=([^\s)]+)/)![1]
  let [, approval, digest] = (await opened<[string, string, string]>(
    'approval',
    t,
    SECRET,
  ))!
  equal((await press(approval, digest)).state, 'theirs')
  equal(
    (await press(approval, digest, { press: true, who: 'mallory' })).state,
    'theirs',
  )
  equal((await press(approval, digest, { who: person })).state, 'waiting')
  equal(
    (await press(approval, digest, { press: true, who: person })).state,
    'done',
  )
})

test('an approval of an act naming an integration carries its logo', async () => {
  let logos: OperatorStore = operatorMemory()
  logos.logos = (named: string[]) =>
    Promise.resolve(Object.fromEntries(named.map((n) => [n, `at:${n}`])))
  let row = {
    person,
    session,
    tool: 'connection_lend',
    say: 'Lend it',
    args: { app: 'a', integration: 'gmail', cap: 5 },
    number: NUMBER,
    expires: new Date(clock + LIFE).toISOString(),
  }
  let eid = crypto.randomUUID()
  await logos.g.apply([{ entity: { eid }, operator_approval: row }], {
    trusted: true,
  })
  let standing = await approvals(logos, () => Promise.resolve(''), () => clock)(
    eid,
    digestOf(row),
  )
  equal([standing.state, standing.logo], ['waiting', 'at:gmail'])
})

test('in their chat the answer carries no link: the card in the conversation is pressed in place, by them alone', async () => {
  let said = String(await asking({ chat: true }).run({ email: 'kim@x.com' }))
  equal([said.includes('http'), said.includes('a card')], [false, true])
  let [row] = await store.g.read(
    line`.operator_approval .entry.session=${session} .order=-created.at .limit=1`,
  )
  let drawn = () => renderToString(approvalCard(row, clock))
  equal(drawn().includes('Add kim@x.com to the space as an editor?'), true)
  equal(drawn().includes('data-act="approve"'), true)
  let digest = digestOf(row.operator_approval as Approval)
  let own = { own: true, press: true }
  equal((await press(row.entity.eid, digest, own)).state, 'theirs')
  equal(
    (await press(row.entity.eid, digest, { ...own, who: 'mallory' })).state,
    'theirs',
  )
  equal(
    (await press(row.entity.eid, digest, { ...own, who: person })).state,
    'done',
  )
  ;[row] = await store.g.get([row.entity.eid])
  equal([drawn().includes('Approved.'), drawn().includes('data-act')], [
    true,
    false,
  ])
})

test("a card pressed in a texted approval's conversation is still theirs alone", async () => {
  await named('member_add').run({ email: 'lu@x.com' })
  let { approval, digest } = await linked()
  let own = { own: true, press: true }
  equal(
    (await press(approval, digest, { ...own, who: 'mallory' })).state,
    'theirs',
  )
  equal((await press(approval, digest, { ...own, who: person })).state, 'done')
  let notes = await store.g.read(
    line`.entry.session=${session} .notice !operator_approval .fields=content.body`,
  )
  equal(
    notes.some((n) =>
      /Approve on its card .*lu@x\.com/.test(
        String((n.content as { body: string }).body),
      )
    ),
    true,
  )
})

// What waits on the person, in their Updates, by what it asks.
let needing = async () =>
  (await updatesOf(store, person, place)).updates.filter((u) => u.needs)
    .map((u) => u.words)
// The newest approval asked in their chat.
let newest = async () =>
  (await store.g.read(
    line`.operator_approval .entry.session=${session} .order=-created.at .limit=1`,
  ))[0]

test('an approval waits in their Updates, is answered there, and shows answered on its card', async () => {
  await asking({ chat: true }).run({ email: 'ivy@x.com' })
  let row = await newest()
  let say = 'Add ivy@x.com to the space as an editor?'
  equal((await needing()).includes(say), true)
  let [shown] = (await updatesOf(store, person, place)).updates
  equal(shown.choices?.map((c) => c.label), ['Approve', 'Decline'])
  ran.length = 0
  let did = await updating(store, { person, space: place }, {
    choose: row.entity.eid,
    choice: 'Approve',
  })
  equal(did, { answered: row.entity.eid, chat: session })
  equal((await needing()).includes(say), false)
  await answered(store, press, row.entity.eid)
  await answered(store, press, row.entity.eid)
  equal(ran, ['app_files {"member_add":{"email":"ivy@x.com"}}'])
  ;[row] = await store.g.get([row.entity.eid])
  equal(renderToString(approvalCard(row, clock)).includes('Approved.'), true)
  let notes = await store.g.read(
    line`.entry.session=${session} .notice !operator_approval .fields=content.body`,
  )
  equal(
    notes.some((n) =>
      /Approve on it in their Updates.*ivy@x\.com/.test(
        String((n.content as { body: string }).body),
      )
    ),
    true,
  )
})

test('an approval answered on its card or link leaves their Updates; one that lapsed asks nothing', async () => {
  await asking({ chat: true }).run({ email: 'jo@x.com' })
  let row = await newest()
  let digest = digestOf(row.operator_approval as Approval)
  await press(row.entity.eid, digest, { own: true, decline: true, who: person })
  equal(
    (await needing()).includes('Add jo@x.com to the space as an editor?'),
    false,
  )
  ;[row] = await store.g.get([row.entity.eid])
  equal((row.decided as { choice: string }).choice, 'Decline')
  await asking({ chat: true }).run({ email: 'al@x.com' })
  let waits = 'Add al@x.com to the space as an editor?'
  equal((await needing()).includes(waits), true)
  equal(
    (await updatesOf(store, person, place, 50, false, clock + LIFE + 1))
      .updates.some((u) => u.words == waits),
    false,
  )
})

// An act asked for by a number alone waits for a tap on a link texted to it
// (T-1864): the link is spent once, lives LIFE, and is bound to the one act
// and its arguments.
import { equal, test } from '@yaks/testing'
import { line } from '@yaks/query'
import type { Tool } from '@yaks/session'
import { operatorMemory } from './operator-testing.ts'
import { opened } from './lib/token.ts'
import {
  approvals,
  asker,
  confirming,
  digestOf,
  LIFE,
} from './operator-approvals.ts'
import type { Env } from './env.ts'
import type { OperatorStore } from './operator-store.ts'
import type { Space } from './directory.ts'

let SECRET = 'secret'
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
let tools = confirming(
  [tool('member_add'), tool('grant'), tool('app_files')],
  ask,
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
    texts.at(-1)!.words.startsWith('Add eve@x.com to the space as owner? Tap'),
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
  equal((await press(approval, digest, false)).state, 'waiting')
  equal(ran, [])
  let [one, two] = await Promise.all([
    press(approval, digest, true),
    press(approval, digest, true),
  ])
  equal([one.state, two.state].sort(), ['done', 'used'])
  equal((await press(approval, digest, true)).state, 'used')
  equal(ran, ['app_files {"member_add":{"email":"eve@x.com","role":"owner"}}'])
  let [note] = await store.g.read(
    line`.entry.session=${session} .notice .fields=content.body`,
  )
  equal(
    String((note.content as { body: string }).body).includes('eve@x.com'),
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
  equal((await press(approval, digest, true)).state, 'gone')
  equal((await press(approval, 'forged', true)).state, 'gone')
})

test('a link dies after LIFE', async () => {
  await named('member_add').run({ email: 'eve@x.com' })
  let { approval, digest } = await linked()
  clock += LIFE + 1
  equal((await press(approval, digest, true)).state, 'expired')
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

test('after words a number alone vouched for, an act runs when the turn asks for it in its own words', async () => {
  let turn = (said: string) =>
    confirming([tool('member_add'), tool('grant')], ask, said)
  let run = (said: string, name: string, args: Record<string, unknown>) =>
    turn(said).find((t) => t.name == name)!.run(args)
  ran.length = 0
  let sent = texts.length
  await run('Please add EVE@x.com', 'member_add', { email: 'eve@x.com' })
  await run('go ahead', 'member_add', { email: 'eve@x.com' })
  await run('add eve@x.com to recipes', 'member_add', {
    email: 'eve@x.com',
    app: 'blog',
  })
  await run('make me a token', 'grant', {})
  equal(ran, ['member_add {"email":"eve@x.com"}'])
  equal(texts.length, sent + 3)
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
    false,
  )
  equal([standing.state, standing.logo], ['waiting', 'at:gmail'])
})

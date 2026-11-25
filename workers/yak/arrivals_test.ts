// Where each person came from when they signed up (T-154825), through the
// whole kernel: a home page with a campaign's link, an app's badge, an
// assistant's connector, an invitation, a letter and the home page's box,
// and a person's invite link (T-3445) followed to the sign-in page and to the
// box, then one read listing them since a time.
import { cleanup, equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { managePath } from '@yaks/platform/routes'
import {
  authorizing,
  connector,
  fresh,
  letter,
  mailed,
  signIn,
} from './probe.ts'
import type { Env } from './env.ts'
import { arrivals } from './arrivals.ts'
import { COOKIE as CAME } from './arrival.ts'
import { COOKIE } from './lib/token.ts'
import { START } from './newcomer.ts'
import { meta } from './meta.ts'
import type { Row } from './directory.ts'

let env!: Env
let k = await fresh({}, (e) => {
  env = e
})
cleanup(() => k.stop())

let BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
let cookieIn = (r: Response, name: string) =>
  r.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(
    ';',
  )[0] ??
    ''
let post = (path: string, fields: Record<string, string>, cookie = '') =>
  k.at(k.host, path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': BROWSER,
      ...cookie ? { cookie } : {},
    },
    body: new URLSearchParams(fields).toString(),
  })
// The arrival a page opened from `path` keeps on the browser.
let opened = async (path: string) => {
  let r = await k.at(k.host, path, { headers: { 'user-agent': BROWSER } })
  await r.body?.cancel()
  return cookieIn(r, CAME)
}
// Signing up at /login by the code a letter carries, on a browser holding
// `came`, with an assistant's authorize request riding along where `q` is.
let signUp = async (address: string, came = '', q = '') => {
  let with_: Record<string, string> = q ? { q } : {}
  let asked = await post('/login', { address, ...with_ }, came)
  await asked.body?.cancel()
  let browser = [came, cookieIn(asked, COOKIE)].filter(Boolean).join('; ')
  let code = await mailed(k, address)
  let inn = await post('/login/code', { address, code, ...with_ }, browser)
  await inn.body?.cancel()
}

let owner = await signIn(k, 'owner@example.com')
let agent = connector(k, owner.cookie)
let app = (await agent.answer('app_new', { slug: 'recipes', title: 'Recipes' }))
  .value!.eid as string
let since = new Date().toISOString()

await signUp(
  'ana@example.com',
  await opened('/churches?utm_source=meta&utm_campaign=pilot'),
)
await signUp('bo@example.com', await opened(`/?app=${app}`))
await signUp('cy@example.com', '', (await authorizing(k, { name: 'Claude' })).q)
await agent.tool('member_add', { email: 'di@example.com' })
let invited = await letter(k, 'di@example.com', '/invite?t=')
let t = new URL(/https:\/\/\S+\/invite\?t=\S+/.exec(invited.body)![0])
  .searchParams.get('t')!
let pressed = await post('/invite', { t })
await pressed.body?.cancel()
let { joined } = await import('./identity.ts')
await joined(env, 'eve@example.com', 'Eve', 'Hello')
let church = await opened('/churches')
let built = await post(START, { say: 'A sign-up sheet' }, church)
await built.body?.cancel()
await signUp('fay@example.com', [church, cookieIn(built, COOKIE)].join('; '))

// The owner's invite link, from their invite page; Gil follows it to the
// sign-in page, and Hal to the box, which builds his first app before he
// signs up.
let page = (path: string, cookie = '') =>
  k.at(k.host, path, {
    headers: { 'user-agent': BROWSER, ...cookie ? { cookie } : {} },
  })
let mine = parseHTML(
  await (await page(managePath('invite'), owner.cookie)).text(),
).document
let link = new URL(mine.querySelector('.Invite_Link .Copy_Text')!.textContent!)
let landing = await page(link.pathname)
let kept = cookieIn(landing, CAME)
let card = parseHTML(await landing.text()).document
await signUp('gil@example.com', kept)
let boxed = await post(START, { say: 'A chore chart' }, kept)
await boxed.body?.cancel()
let hal = [kept, cookieIn(boxed, COOKIE)].join('; ')
await connector(k, cookieIn(boxed, COOKIE)).answer('app_new', {
  slug: 'chores',
  title: 'Chores',
})
await signUp('hal@example.com', hal)
await k.deliveries()
let referrals = await meta(env).query('.referral ?rewarded') as Row[]

test('one read lists each new person since a time and where they came from', async () => {
  let read = (await arrivals(env, since)).map(
    ({ who, door, page, campaign, slug, assistant, invited }) => ({
      who,
      door,
      ...page ? { page } : {},
      ...campaign ? { campaign } : {},
      ...slug ? { slug } : {},
      ...assistant ? { assistant } : {},
      ...invited ? { invited } : {},
    }),
  )
  equal(read, [
    {
      who: 'ana@example.com',
      door: 'login',
      page: 'church',
      campaign: 'meta//pilot',
    },
    { who: 'bo@example.com', door: 'login', page: 'ask', slug: 'recipes' },
    { who: 'cy@example.com', door: 'connector', assistant: 'Claude' },
    { who: 'di@example.com', door: 'invitation', invited: 'owner@example.com' },
    { who: 'eve@example.com', door: 'email' },
    { who: 'fay@example.com', door: 'box', page: 'church' },
    { who: 'gil@example.com', door: 'login', invited: 'owner@example.com' },
    { who: 'hal@example.com', door: 'box', invited: 'owner@example.com' },
  ])
})

test("a person's invite link says who invited them and what they get, over the sign-in form", () => {
  equal(link.pathname.length, '/i/'.length + 5)
  equal(card.querySelector('h1')?.textContent, 'owner invited you to yaks.app')
  ok(card.querySelector('h1 + p')?.textContent?.includes('a space of your own'))
  ok(card.querySelector('form[action="/login"] [name=address]'))
})

test("a sign-up on a browser that opened an invite link is credited, by whichever door, and the box's first app gives the month", () => {
  equal(referrals.length, 2)
  equal(referrals.filter((r) => r.rewarded).length, 1)
})

test('a sign-up before the time is not listed', async () => {
  equal((await arrivals(env, new Date().toISOString())).length, 0)
  equal(
    (await arrivals(env, '2000-01-01T00:00:00.000Z')).some((p) =>
      p.who == 'owner@example.com'
    ),
    true,
  )
})

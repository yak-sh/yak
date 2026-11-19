// Where each person came from when they signed up (T-154825), through the
// whole kernel: a home page with a campaign's link, an app's badge, an
// assistant's connector, an invitation, a letter and the home page's box,
// then one read listing them since a time.
import { cleanup, equal, test } from '@yaks/testing'
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

let env!: Env
let k = await fresh({}, (e) => {
  env = e
})
cleanup(() => k.stop())

let BROWSER = 'Mozilla/5.0 (Macintosh) AppleWebKit Safari'
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
console.log('BUILT', built.status, built.headers.getSetCookie(), church)
await built.body?.cancel()
await signUp('fay@example.com', [church, cookieIn(built, COOKIE)].join('; '))
await k.deliveries()

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
  ])
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

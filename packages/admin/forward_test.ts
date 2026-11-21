import { account } from './account.ts'
import { equal, test } from '@yaks/testing'
import { forward, FORWARDED, forwarded } from './forward.ts'

let bearer = 'private-bearer', session = 'private-session'
let renewed: string[] = []
let sent: Request[] = []
let handler = forward({
  credential: () => Promise.resolve({ bearer, session }),
  renewed: (value) => {
    renewed.push(value)
    return Promise.resolve()
  },
  fetch: (input, init) => {
    sent.push(new Request(input, init))
    return Promise.resolve(Response.json({ bearer, session }, {
      headers: {
        'set-cookie': 'yak_session=renewed-session; Secure',
        authorization: bearer,
      },
    }))
  },
})
let request = (target: string, credential = 'bearer') =>
  new Request(
    `http://localhost/?${new URLSearchParams({ url: target })}`,
    { headers: { 'x-yak-credential': credential } },
  )

await handler(request('https://yaks.app/api/fee')).then((r) => r.text())

test('forwarding adds credentials only in its private process and keeps renewal there', async () => {
  let before = sent.length
  let result = await handler(request('https://yaks.app/api/fee', 'session'))
  equal(sent.length, before + 1)
  equal(
    sent.at(-1)?.headers.get('cookie'),
    `yak_session=${session}; __Host-yak_session=${session}`,
  )
  equal(sent.at(-1)?.redirect, 'manual')
  equal(result.headers.get('set-cookie'), null)
  equal(result.headers.get('authorization'), null)
  equal(await result.json(), { bearer: '[redacted]', session: '[redacted]' })
  equal(renewed.at(-1), 'renewed-session')
})

for (
  let url of [
    'https://example.com/api/fee',
    'http://yaks.app/api/fee',
    'https://yaks.app:444/api/fee',
    'https://ann.yaks.app/code',
    'https://ann.yaks.app/api/fetch',
    'https://yaks.app/oauth/token',
    'https://yaks.app/login/code',
    'https://yaks.app/../oauth/allow',
    'https://yaks.app/api/fee@evil.com',
  ]
) {
  let asked = request(url)
  test(`forwarding refuses ${url}`, async () => {
    let before = sent.length
    equal((await handler(asked)).status, 403)
    equal(sent.length, before)
  })
}
let missing = request('https://yaks.app/api/fee', '')
test('forwarding requires an explicit credential selector', async () => {
  equal((await handler(missing)).status, 403)
})

let browse = (url: string, credential = 'session') =>
  new Request(request('https://yaks.app/api/browse').url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-yak-credential': credential,
    },
    body: JSON.stringify({ url }),
  })

test('the private admin forwards only visits to admin pages, using the private OAuth grant', async () => {
  let before = sent.length
  for (
    let denied of [
      browse('https://checks.yaks.app/admin/spending'),
      browse('https://yaks.app/manage/checks/operator'),
      browse('https://yaks.app/admin/spending', 'bearer'),
      request('https://yaks.app/api/browse', 'session'),
    ]
  ) equal((await handler(denied)).status, 403)
  equal(sent.length, before)
  let page = 'https://yaks.app/admin/spending'
  let response = await handler(browse(page))
  equal(response.status, 200)
  equal(sent.at(-1)?.url, 'https://yaks.app/api/browse/admin')
  equal(await sent.at(-1)?.json(), { url: page })
  equal(sent.at(-1)?.headers.get('cookie'), null)
  equal(sent.at(-1)?.headers.get('authorization'), `Bearer ${bearer}`)
  equal(await response.json(), { bearer: '[redacted]', session: '[redacted]' })
})

test('forwarding preserves the platform free-space allowance door', async () => {
  let url = 'https://yaks.app/api/spaces?person=checks%40bot.yak.sh'
  equal((await handler(request(url))).status, 200)
  equal(sent.at(-1)?.url, url)
})

test('forwarding preserves built-in store calls without returning the bearer', async () => {
  for (let door of ['query?q=.doc', 'vocab']) {
    let response = await handler(
      request(`https://ann.yaks.app/notes/api/${door}`),
    )
    equal(response.status, 200)
    equal(sent.at(-1)?.headers.get('authorization'), `Bearer ${bearer}`)
  }
})

test('admin caller replaces credential placeholders with a local transport', () => {
  let result = forwarded(
    'https://yaks.app/api/fee',
    `${FORWARDED}http://127.0.0.1:5176`,
    false,
    {
      headers: { authorization: `${FORWARDED}http://127.0.0.1:5176` },
    },
  )
  equal(new URL(result.url).searchParams.get('url'), 'https://yaks.app/api/fee')
  equal(new Headers(result.init.headers).get('authorization'), null)
  equal(new Headers(result.init.headers).get('x-yak-credential'), 'bearer')
  equal(result.init.redirect, 'manual')
})

test('selecting the private admin returns its transport without opening graph or vault', async () => {
  let selected = account({
    config: {
      plugins: [{
        use: '@yaks/admin',
        with: { forward: 'http://127.0.0.1:5176' },
      }],
    },
    graph: null!,
    vault: null!,
  })
  for (let as of ['admin', 'admin@bot.yak.sh']) {
    equal(await selected(as), {
      address: 'admin@bot.yak.sh',
      bearer: FORWARDED + 'http://127.0.0.1:5176',
      session: FORWARDED + 'http://127.0.0.1:5176',
    })
  }
})

let accountClose = request(
  'https://yaks.app/api/account?address=probe%40bot.yak.sh',
)
test('forwarding allows the platform account cleanup door', async () => {
  equal((await handler(accountClose)).status, 200)
})

test('forwarding allows the directory graves door', async () => {
  let graves = request('https://yaks.app/api/graves?since=2026-10-20')
  equal((await handler(graves)).status, 200)
})

test("forwarding allows the door reading an app's uses", async () => {
  let uses = request('https://yaks.app/api/uses?app=jeff%2Frecipes')
  equal((await handler(uses)).status, 200)
})

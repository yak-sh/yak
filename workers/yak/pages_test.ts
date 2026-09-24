import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  askCode,
  askConnect,
  askEmail,
  connect,
  lost,
  spaceBinned,
  spaceIndex,
  type SpacePage,
} from './pages.ts'

let env = { APEX: 'yaks.fyi' }
let page: SpacePage = {
  space: 'ada',
  title: 'Ada',
  apps: [],
  hidden: 0,
  role: 'owner',
  person: true,
  signIn: 'https://yaks.fyi/login',
  sell: 'none',
}

let staged = async (response: Response, contains: string[]) => {
  let html = await response.text()
  assertEquals(html.includes('https://yaks.app'), false)
  assertStringIncludes(html, 'yaks.app')
  for (let text of contains) assertStringIncludes(html, text)
}

Deno.test('pages: staging sign-in and error pages link to their own apex', async () => {
  for (
    let response of [
      lost(env),
      askEmail(null, null, undefined, undefined, 200, env),
      askCode('ada@example.test', null, null, undefined, 200, env),
      spaceBinned({ slug: 'ada', title: 'Ada', days: 3 }, env),
    ]
  ) {
    await staged(response, [
      'https://yaks.fyi/controls.css',
      'https://yaks.fyi/',
    ])
  }
})

Deno.test('pages: staging space management and connector forms keep their host', async () => {
  for (let view of ['apps', 'settings', 'connect', 'selling'] as const) {
    await staged(spaceIndex({ ...page, view }, env), [
      'ada.yaks.fyi',
      'https://yaks.fyi/help',
    ])
  }
  await staged(spaceIndex({ ...page, role: null, person: false }, env), [
    'https://yaks.fyi/login',
  ])
  await staged(
    connect(
      {
        slug: 'ada',
        fixed: false,
        plan: { plus: false, ends: '', known: false },
      },
      200,
      env,
    ),
    [
      'ada.yaks.fyi',
      'https://yaks.fyi/mcp',
      'https://yaks.fyi/mcp?auth=required',
      'https://yaks.fyi/oauth/authorize',
      'https://yaks.fyi/oauth/token',
      'https://yaks.fyi/oauth/register',
      'https://yaks.fyi/yaks-app.png',
      'https://yaks.fyi/pricing',
      'Connect yaks.app',
    ],
  )
})

Deno.test('pages: only production offers its repository marketplace shortcut', async () => {
  let yours = {
    slug: 'ada',
    fixed: true,
    plan: { plus: false, ends: '', known: false },
  }
  for (let host of [{}, env]) {
    let html = await connect(yours, 200, host).text()
    assertEquals(
      html.includes('Add plugin marketplace'),
      host == env ? false : true,
    )
    assertEquals(html.includes('yak-sh/yak'), host == env ? false : true)
  }
})

Deno.test('connections: the space’s ask of each person offers nothing to connect, and a person’s own is theirs to remove', async () => {
  let drawn = async (own: boolean) =>
    await spaceIndex({
      ...page,
      view: 'connections',
      connections: {
        on: true,
        list: [{
          eid: 'c',
          integration: 'Weather',
          own,
          each: true,
          status: 'needed',
          account: '',
          keyed: true,
          hosts: [],
          apps: ['Notes'],
          saving: '',
          failed: '',
        }],
        services: [],
        built: [],
      },
    }, env).text()
  let ask = await drawn(false)
  assertStringIncludes(ask, 'Each person who uses Notes connects their own')
  assertEquals(ask.includes('Paste the key for Weather'), false)
  assertEquals(ask.includes('value="disconnect"'), false)
  let own = await drawn(true)
  assertStringIncludes(own, 'Paste the key for Weather')
  assertStringIncludes(own, 'value="disconnect">Remove')
})

Deno.test('askConnect: the app, the service, the one form, and the way back', async () => {
  let html = await askConnect({
    app: 'Notes',
    integration: 'Cal',
    keyed: false,
    on: true,
    status: 'connected',
    back: 'https://ada.yaks.fyi/notes/',
  }, env).text()
  for (
    let text of [
      'Notes asks each person who uses it to connect their own Cal account',
      'Yours is connected.',
      'Connect again',
      'href="https://ada.yaks.fyi/notes/">Back to Notes',
    ]
  ) assertStringIncludes(html, text)
})

Deno.test('paid plan settings describe unlimited apps', async () => {
  const html = await spaceIndex({
    ...page,
    view: 'billing',
    plan: { plus: true, ends: '', known: true },
  }, env).text()
  assertStringIncludes(html, 'Unlimited apps')
  assertEquals(html.includes('null apps'), false)
})

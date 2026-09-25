import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import {
  askCode,
  askConnect,
  askEmail,
  connect,
  desk,
  type DeskPage,
  lost,
  spaceBinned,
  spaceIndex,
} from './pages.ts'

let env = { APEX: 'yaks.fyi' }
// A service as a page draws it, bare but for its name.
let named = (title: string) => ({ title, tagline: '', site: '', logo: '' })
let CAL = {
  title: 'Cal',
  tagline: 'Your calendar.',
  site: 'https://cal.test/',
  logo: '<svg xmlns="http://www.w3.org/2000/svg"/>',
}
// What a face draws: its logo as an image, never as markup, its line, and its
// site linked by its host.
let drawn = [
  `<img class="Connection_Logo" src="data:image/svg+xml,${
    encodeURIComponent(CAL.logo).replaceAll("'", '&#39;')
  }"`,
  'Your calendar. <a href="https://cal.test/">cal.test</a>',
]
let page: DeskPage = { space: 'ada', apps: [], sell: 'none' }

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
    await staged(desk({ ...page, view }, env), [
      'ada.yaks.fyi',
      'https://yaks.fyi/help',
    ])
  }
  await staged(
    spaceIndex({
      space: 'ada',
      title: 'Ada',
      apps: [],
      hidden: 0,
      role: null,
      person: false,
      signIn: 'https://yaks.fyi/login',
    }, env),
    ['https://yaks.fyi/login'],
  )
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
    await desk({
      ...page,
      view: 'connections',
      connections: {
        on: true,
        list: [{
          eid: 'c',
          integration: 'Weather',
          face: named('Weather'),
          own,
          space: own ? null : 'ada',
          each: true,
          status: 'needed',
          account: '',
          keyed: true,
          hosts: [],
          apps: [{
            app: 'n',
            title: 'Notes',
            binding: 'WEATHER',
            direct: false,
            anyone: false,
          }],
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
  assertStringIncludes(own, 'Notes reads it as <code>env.WEATHER</code>.')
  assertEquals(own.includes('Open to anyone'), false)
})

Deno.test('connections: the person’s own, then this space with what it could add, then each other space', async () => {
  let shown = (integration: string, space: string | null) => ({
    eid: integration,
    integration,
    face: named(integration),
    own: space == null,
    space,
    each: false,
    status: 'connected' as const,
    account: '',
    keyed: true,
    hosts: [],
    apps: [],
    saving: '',
    failed: '',
  })
  let drawn = (enable?: string[]) =>
    desk({
      ...page,
      pick: 'ada',
      view: 'connections',
      connections: {
        on: true,
        list: [
          shown('Mail', null),
          shown('Weather', 'ada'),
          shown('Maps', 'bob'),
        ],
        services: [],
        built: [{ name: 'openrouter', keyed: true, face: named('OpenRouter') }],
        enable,
      },
    }, env).text()
  let { document } = parseHTML(await drawn())
  let groups = [...document.querySelectorAll('.Desk_Group')]
  assertEquals(groups.map((g) => g.textContent), [
    'Yours',
    'ada.yaks.fyi',
    'bob.yaks.fyi',
  ])
  let under = (i: number) => {
    let names = []
    for (
      let at = groups[i].nextElementSibling;
      at && !at.classList.contains('Desk_Group');
      at = at.nextElementSibling
    ) names.push(at.querySelector('h2')?.textContent)
    return names
  }
  assertEquals(under(0), ['Mail'])
  assertEquals(under(1), ['Weather', 'OpenRouter', 'Add a key'])
  assertEquals(under(2), ['Maps'])
  // Each posts for the space that keeps it; the person's own, for the page's.
  let actions = [...document.querySelectorAll('form.Connection_Do')].map((f) =>
    f.getAttribute('action')
  )
  assertEquals(
    new Set(actions),
    new Set([
      '/manage/connections?space=ada',
      '/manage/connections?space=bob',
    ]),
  )
  // A page opened with `?enable=` posts every form with it, so the page a
  // post draws again still offers the testing integration.
  let kept = parseHTML(await drawn(['google-calendar'])).document
  let posts = [...kept.querySelectorAll('form')].map((f) =>
    new URL(f.getAttribute('action')!, 'https://yaks.fyi')
  ).filter((to) => to.pathname == '/manage/connections')
  assertEquals(posts.length, 8)
  assertEquals(
    new Set(posts.map((to) => to.searchParams.get('enable'))),
    new Set(['google-calendar']),
  )
})

Deno.test('askConnect: the app, the service, the one form, and the way back', async () => {
  let html = await askConnect({
    app: 'Notes',
    face: CAL,
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
      ...drawn,
    ]
  ) assertStringIncludes(html, text)
})

Deno.test('connections: a built integration is offered by its face, and a site is linked only at https', async () => {
  let offered = async (site: string) =>
    await desk({
      ...page,
      view: 'connections',
      connections: {
        on: true,
        list: [],
        services: [],
        built: [{ name: 'cal', keyed: false, face: { ...CAL, site } }],
      },
    }, env).text()
  let html = await offered(CAL.site)
  for (let text of ['<h2>Cal</h2>', ...drawn]) assertStringIncludes(html, text)
  assertEquals((await offered('javascript:alert(1)')).includes('alert'), false)
})

Deno.test('paid plan settings describe unlimited apps', async () => {
  const html = await desk({
    ...page,
    view: 'billing',
    plan: { plus: true, ends: '', known: true },
  }, env).text()
  assertStringIncludes(html, 'Unlimited apps')
  assertEquals(html.includes('null apps'), false)
})

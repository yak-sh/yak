import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
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
import type { Borrowed, Connections, Shown, Using } from './connections.ts'

let env = { APEX: 'yaks.fyi' }
// A service as a page draws it, bare but for its name.
let named = (title: string) => ({
  title,
  tagline: '',
  site: '',
  logo: '',
  instructions: '',
  theirs: false,
})
let CAL = {
  title: 'Cal',
  tagline: 'Your calendar.',
  site: 'https://cal.test/',
  logo: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  instructions: '',
  theirs: false,
}
// What a face draws: its logo as an image, never as markup, its line, and its
// site linked by its host.
let drawn = [
  `<img class="Card_Mark" src="data:image/svg+xml,${
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

test('pages: staging sign-in and error pages link to their own apex', async () => {
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

for (
  let [back, wanted] of [
    [
      'https://ada.yaks.fyi/potluck/',
      'Sign in to continue to ada.yaks.fyi/potluck.',
    ],
    [null, 'Build an app by asking Claude or ChatGPT.'],
    ['/connect', 'Build an app by asking Claude or ChatGPT.'],
    [
      'https://elsewhere.test/yaks.fyi/',
      'Build an app by asking Claude or ChatGPT.',
    ],
  ] as const
) {
  test(`pages: the sign-in card names only its own app return: ${back}`, async () => {
    let html = await askEmail(null, back, undefined, undefined, 200, env).text()
    // Check the card's actual direct-child markup, not shared stylesheet parsing.
    let card = html.slice(html.indexOf('<main>'), html.indexOf('</main>') + 7)
    let lead = parseHTML(card).document.querySelector('main > p')?.textContent
    assertEquals(lead, wanted)
  })
}

test('pages: staging space management and connector forms keep their host', async () => {
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

test('pages: only production offers its repository marketplace shortcut', async () => {
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

test('connections: the space’s ask of each person offers nothing to connect, and a person’s own is theirs to remove', async () => {
  let drawn = async (own: boolean) =>
    await desk({
      ...page,
      view: 'connections',
      connections: {
        on: true,
        borrowed: [],
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
          about: null,
          listed: false,
          scopes: [],
          available: [],
          binding: 'WEATHER',
          apps: [{
            app: 'n',
            title: 'Notes',
            binding: 'WEATHER',
            direct: false,
            anyone: false,
            calls: 3,
            cap: 10,
            lends: null,
            borrower: null,
          }],
          saving: '',
          failed: '',
        }],
        services: [],
        built: [],
      },
    }, env).text()
  // Only the connection's own card, not the page's box for a new key.
  let card = (html: string) => {
    let at = html.indexOf('data-connection="c"')
    return html.slice(at, html.indexOf('</section>', at))
  }
  let ask = card(await drawn(false))
  assertStringIncludes(ask, 'Each person who uses Notes connects their own')
  assertEquals(ask.includes('name="key"'), false)
  assertEquals(ask.includes('value="disconnect"'), false)
  let own = card(await drawn(true))
  assertStringIncludes(own, 'name="key"')
  assertStringIncludes(own, 'value="disconnect">Remove')
  assertStringIncludes(own, '<code>env.WEATHER</code>')
  assertStringIncludes(own, '3 of 10 calls this month')
  assertEquals(ask.includes('calls this month'), false)
  assertEquals(own.includes('Open to anyone'), false)
})

test('connections: the person’s own, then this space with what it could add, then each other space', async () => {
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
    about: null,
    listed: false,
    scopes: [],
    available: [],
    binding: integration.toUpperCase(),
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
        borrowed: [],
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
  let groups = [...document.querySelectorAll('.Group')]
  assertEquals(groups.map((g) => g.textContent), [
    'Yours',
    'ada.yaks.fyi',
    'bob.yaks.fyi',
  ])
  let under = (i: number) => {
    let names = []
    for (
      let at = groups[i].nextElementSibling;
      at && !at.classList.contains('Group');
      at = at.nextElementSibling
    ) names.push(at.querySelector('h2')?.textContent)
    return names
  }
  assertEquals(under(0), ['Mail'])
  assertEquals(under(1), ['Weather', 'OpenRouter', 'Add a key'])
  assertEquals(under(2), ['Maps'])
  // Each posts for the space that keeps it; the person's own, for the page's.
  let actions = [...document.querySelectorAll('form')].filter((f) =>
    f.querySelector('input[name="connection"]')
  ).map((f) => f.getAttribute('action'))
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
  assertEquals(
    posts.length,
    document.querySelectorAll('form[action^="/manage/connections"]').length,
  )
  assertEquals(
    new Set(posts.map((to) => to.searchParams.get('enable'))),
    new Set(['google-calendar']),
  )
})

// A service this space added, saying how to get its key, as the page is handed
// it: the instructions already drawn (theirs.ts), and what they were written as.
let HOW =
  '<p>Sign up at <a href="https://weather.test" rel="nofollow ugc">weather.test</a>.</p>'
let added = (status: 'needed' | 'connected', listed = false) => ({
  eid: 'w',
  integration: 'Weather',
  face: { ...named('Weather'), instructions: HOW },
  own: false,
  space: 'ada',
  each: false,
  status,
  account: '',
  keyed: true,
  hosts: ['api.weather.test'],
  about: {
    title: 'Weather',
    tagline: '',
    site: '',
    instructions: 'Sign up at [weather.test](https://weather.test) & <b>.',
  },
  listed,
  scopes: [],
  available: [],
  binding: 'WEATHER',
  apps: [],
  saving: '',
  failed: '',
})
let listing = (
  status: 'needed' | 'connected',
  listed = false,
  asked?: Connections['asked'],
) =>
  desk({
    ...page,
    view: 'connections',
    connections: {
      on: true,
      borrowed: [],
      list: [added(status, listed)],
      services: [],
      built: [],
      asked,
    },
  }, env).text()

test('connections: how to get a key sits open beside a connection needing one, and closed once connected', async () => {
  assertStringIncludes(
    await listing('needed'),
    `<details class="More" open><summary>How to get the key</summary><div class="More_Body">${HOW}</div></details>`,
  )
  assertStringIncludes(
    await listing('connected'),
    `<details class="More"><summary>How to get the key</summary><div class="More_Body">${HOW}</div></details>`,
  )
})

test('connections: a service the space added can be changed there, all but where its key goes', async () => {
  let html = await listing('connected')
  for (
    let text of [
      'Change what Weather says',
      'name="title" value="Weather"',
      '>Sign up at [weather.test](https://weather.test) &amp; &lt;b&gt;.</textarea>',
      'value="about">Save',
    ]
  ) assertStringIncludes(html, text)
  let told = html.slice(html.indexOf('Change what Weather says'))
  assertEquals(
    told.slice(0, told.indexOf('</details>')).includes('name="hosts"'),
    false,
  )
})

test('connections: a service the space added is listed in the integration directory from there, or taken out', async () => {
  assertStringIncludes(
    await listing('connected'),
    'value="list">List in the integration directory',
  )
  let out = await listing('connected', true)
  assertStringIncludes(
    out,
    'href="/integrations#Weather">integration directory',
  )
  assertStringIncludes(out, 'value="unlist">Take it out')
})

test('connections: a page opened to add one from the directory offers it first, saying how to get its key', async () => {
  let html = await listing('connected', false, {
    name: 'ESV',
    keyed: true,
    face: {
      ...named('ESV API'),
      site: 'https://api.esv.org',
      instructions: HOW,
      theirs: true,
    },
  })
  let at = html.indexOf('>ESV API</h2>')
  assert(at > 0 && at < html.indexOf('>Weather</h2>'), html)
  let card = html.slice(
    html.lastIndexOf('<form', at),
    html.indexOf('</form>', at),
  )
  for (
    let text of [
      `<details class="More" open><summary>How to get the key</summary><div class="More_Body">${HOW}`,
      // Its site is its maker's word, linked as theirs.
      '<a href="https://api.esv.org" rel="nofollow ugc">api.esv.org</a>',
      'name="integration" value="ESV"',
      'value="add">Save key',
    ]
  ) assertStringIncludes(card, text)
})

// An app's use of a connection, as a row draws it.
let used = (over: Partial<Using> = {}): Using => ({
  app: 'notes',
  title: 'Notes',
  binding: 'WEATHER',
  direct: false,
  anyone: false,
  calls: 0,
  cap: null,
  lends: null,
  borrower: null,
  ...over,
})
// Each button on the first card matching `at`, read off its markup (a
// document costs a millisecond to parse): its label, its `do`, and the app and
// cap its form posts, the form a `form` attribute names or the one around it.
let buttons = async (at: string, connections: Partial<Connections>) => {
  let html = await desk({
    ...page,
    view: 'connections',
    connections: {
      on: true,
      borrowed: [],
      list: [],
      services: [],
      built: [],
      ...connections,
    },
  }, env).text()
  let from = html.lastIndexOf('<section', html.indexOf(at))
  let card = html.slice(from, html.indexOf('</section>', from))
  let forms = [...card.matchAll(/<form([^>]*)>(.*?)<\/form>/gs)]
  let attr = (tag: string, name: string) =>
    tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1]
  let field = (form: string, name: string) =>
    form.match(new RegExp(`name="${name}"[^>]* value="([^"]*)"`))?.[1]
  return {
    text: card.replace(/<[^>]*>/g, ''),
    pressed: forms.flatMap(([, , inner]) =>
      [...inner.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(
        ([, tag, label]) => {
          let named = attr(tag, 'form')
          let form = named
            ? forms.find(([, head]) => attr(head, 'id') == named)![2]
            : inner
          return [
            label,
            attr(tag, 'value'),
            field(form, 'app'),
            field(form, 'cap'),
          ]
        },
      )
    ),
  }
}

test('connections: a lent connection names each copy borrowing it, recalls one, and changes or stops the lend', async () => {
  let { text, pressed } = await buttons('data-connection=', {
    list: [{
      ...added('connected'),
      apps: [
        used({ app: 'copy', calls: 3, cap: 5, borrower: 'Sam' }),
        used({ lends: 5 }),
      ],
    }],
  })
  assertStringIncludes(text, 'Lent to installed copies, 5 calls a month each')
  assertStringIncludes(text, 'SamTheir copy of Notes · 3 of 5 calls this month')
  assertEquals(
    pressed.filter(([, does]) => does == 'recall' || does == 'lend'),
    [
      ['Recall', 'recall', 'copy', undefined],
      ['Save', 'lend', 'notes', '5'],
      ['Stop lending', 'lend', 'notes', undefined],
    ],
  )
})

test('connections: a borrowed connection says whose it is, and gives way to a key, a sign-in or the space’s own', async () => {
  let lent: Borrowed = {
    eid: 'lent',
    integration: 'Weather',
    face: named('Weather'),
    keyed: true,
    hosts: ['api.weather.test'],
    lender: 'Jeff',
    space: 'ada',
    app: used({ app: 'copy', calls: 3, cap: 100 }),
  }
  let replaced = async (borrowed: Borrowed, list: Shown[] = []) => {
    let { text, pressed } = await buttons('data-borrowed=', {
      borrowed: [borrowed],
      list,
    })
    assertStringIncludes(text, 'Borrowed from Jeff')
    assertStringIncludes(
      text,
      'Only members call out · 3 of 100 calls this month',
    )
    return pressed
  }
  // Who may call out through it is the borrowing space's to say.
  let open = ['Open to anyone', 'open', 'copy', undefined]
  assertEquals(await replaced(lent), [open, [
    'Save key',
    'own',
    'copy',
    undefined,
  ]])
  assertEquals(await replaced({ ...lent, keyed: false }), [
    ['Connect your own', 'own', 'copy', undefined],
    open,
  ])
  assertEquals(await replaced(lent, [added('connected')]), [
    ['Use your own', 'attach', 'copy', undefined],
    open,
  ])
})

test('askConnect: how to get the key, above the box it is pasted in', async () => {
  let html = await askConnect({
    app: 'Notes',
    face: { ...CAL, instructions: HOW },
    keyed: true,
    on: true,
    status: 'needed',
    back: 'https://ada.yaks.fyi/notes/',
  }, env).text()
  let at = html.indexOf(HOW)
  assert(at > 0 && at < html.indexOf('Paste your key'), html)
})

test('askConnect: the app, the service, the one form, and the way back', async () => {
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
      'Yours is connected',
      'Connect again',
      'href="https://ada.yaks.fyi/notes/">Back to Notes',
      ...drawn,
    ]
  ) assertStringIncludes(html, text)
})

test('connections: a built integration is offered by its face, and a site is linked only at https', async () => {
  let offered = async (site: string) =>
    await desk({
      ...page,
      view: 'connections',
      connections: {
        on: true,
        borrowed: [],
        list: [],
        services: [],
        built: [{ name: 'cal', keyed: false, face: { ...CAL, site } }],
      },
    }, env).text()
  let html = await offered(CAL.site)
  for (let text of ['>Cal</h2>', ...drawn]) assertStringIncludes(html, text)
  assertEquals((await offered('javascript:alert(1)')).includes('alert'), false)
})

test('paid plan settings describe unlimited apps', async () => {
  const html = await desk({
    ...page,
    view: 'billing',
    plan: { plus: true, ends: '', known: true },
  }, env).text()
  assertStringIncludes(html, 'Unlimited apps')
  assertEquals(html.includes('null apps'), false)
})

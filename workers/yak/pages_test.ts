import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { KEY, type Status } from '@yaks/connections'
import { type DeskPage, lost, spaceBinned, spaceIndex } from './pages.ts'
import { askCode, askConnect, askEmail, connect } from './signin-pages.ts'
import { desk } from './desk-pages.ts'
import type { Borrowed, Connections, Shown, Using } from './connections.ts'

let env = { APEX: 'yaks.fyi' }
// A service as a page draws it, bare but for its name.
let named = (title: string) => ({
  title,
  tagline: '',
  site: '',
  logo: '',
  image: '',
  instructions: '',
  theirs: false,
  fields: [KEY],
})
let CAL = {
  title: 'Cal',
  tagline: 'Your calendar.',
  site: 'https://cal.test/',
  logo: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  image: '',
  instructions: '',
  theirs: false,
  fields: [KEY],
}
// What a card says of its service: its logo as an image, never as markup,
// its line, and its site linked by its host.
let faced = (card: Element) => ({
  logo: card.querySelector('img.Card_Mark')?.getAttribute('src'),
  line: card.querySelector('.Card_Sub')?.textContent,
  site: card.querySelector('.Card_Sub a')?.getAttribute('href'),
})
let drawn = {
  logo: `data:image/svg+xml,${encodeURIComponent(CAL.logo)}`,
  line: 'Your calendar. cal.test',
  site: 'https://cal.test/',
}
// How a card says to get its service's key: whether it stands open, and what
// it says.
let how = (card: Element) => {
  let fold = [...card.querySelectorAll('details.More')].find((d) =>
    d.querySelector('summary')?.textContent == 'How to get the key'
  )
  return fold && {
    open: fold.hasAttribute('open'),
    says: fold.querySelector('.More_Body')!.innerHTML,
  }
}
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
      askEmail({}, env),
      askEmail({ texts: true }, env),
      askCode({ address: 'ada@example.test' }, env),
      askCode({ address: '+12695550142' }, env),
      spaceBinned({ slug: 'ada', title: 'Ada', days: 3 }, env),
    ]
  ) {
    await staged(response, [
      'https://yaks.fyi/pages.css',
      'https://yaks.fyi/',
    ])
  }
})

test('pages: staging space management and connector forms keep their host', async () => {
  for (let view of ['apps', 'settings', 'agents', 'selling'] as const) {
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
        plan: { tier: 'free' as const, ends: '', known: false },
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
    plan: { tier: 'free' as const, ends: '', known: false },
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
            slug: 'notes',
            binding: 'WEATHER',
            direct: false,
            anyone: false,
            each: false,
            calls: 3,
            cap: 10,
            lends: null,
            borrower: null,
          }],
          saving: '',
          instructions: '',
          failed: '',
        }],
        services: [],
        built: [],
        open: 'c',
      },
    }, env).text()
  // Only the connection's own card, opened on it, not the page's box for a
  // new key.
  let card = async (own: boolean) =>
    parseHTML(await drawn(own)).document
      .querySelector('[data-connection="c"]')!
  let ask = await card(false)
  assertStringIncludes(
    ask.textContent!,
    'Each person who uses Notes connects their own',
  )
  assertEquals(ask.querySelector('[name="key"]'), null)
  assertEquals(ask.querySelector('[value="disconnect"]'), null)
  let own = await card(true)
  assert(own.querySelector('[name="key"]'))
  assertEquals(pressed(own, 'disconnect'), 'Remove')
  assertEquals(own.querySelector('code')?.textContent, 'env.WEATHER')
  assertStringIncludes(own.textContent!, '3 of 10 calls this month')
  assertEquals(ask.textContent!.includes('calls this month'), false)
  assertEquals(own.textContent!.includes('Open to anyone'), false)
})

test('connections: first a grid of cards, theirs on their own space and then the space’s, each opening the rest behind its button', async () => {
  let shown = (integration: string, own = false, status = 'connected') => ({
    eid: integration,
    integration,
    face: named(integration),
    own,
    each: false,
    status: status as Status,
    account: '',
    keyed: true,
    hosts: [],
    about: null,
    listed: false,
    scopes: [],
    available: [],
    binding: integration.toUpperCase(),
    apps: status == 'needed' ? [used()] : [],
    saving: '',
    instructions: '',
    failed: '',
  })
  let drawn = (enable?: string[], own = true, open?: string) =>
    desk({
      ...page,
      view: 'connections',
      connections: {
        on: true,
        borrowed: [],
        list: [
          ...own ? [shown('Mail', true)] : [],
          shown('Weather'),
          shown('Maps', false, 'needed'),
        ],
        services: [],
        built: [{ name: 'openrouter', keyed: true, face: named('OpenRouter') }],
        enable,
        open,
      },
    }, env).text()
  let { document } = parseHTML(await drawn())
  let groups = [...document.querySelectorAll('.Group')]
  assertEquals(groups.map((g) => g.textContent), [
    'Requested by agents',
    'Yours',
    'Connected for ada.yaks.fyi',
    'All services',
  ])
  // Each group's cards, and the one link each card's button follows.
  let under = (g: Element) =>
    [...g.nextElementSibling!.querySelectorAll('.Card')].map((c) => [
      c.querySelector('h2')?.textContent,
      c.getAttribute('href'),
    ])
  assertEquals(under(groups[0]), [
    ['Maps', '/manage/ada/connections?connect=Maps#connect'],
  ])
  assertEquals(under(groups[1]), [
    ['Mail', '/manage/ada/connections?connect=Mail#connect'],
  ])
  assertEquals(under(groups[2]), [
    ['Weather', '/manage/ada/connections?connect=Weather#connect'],
  ])
  assertEquals(
    [...document.querySelectorAll('[data-found] .Card h2')]
      .map((h) => h.textContent),
    ['OpenRouter'],
  )
  // Nothing on the first visit asks for a key but the fold for a service
  // nobody lists.
  assertEquals(
    [...document.querySelectorAll('input[type="password"]')]
      .map((i) => i.closest('details')?.querySelector('summary')?.textContent),
    ['Add a key for a service not listed'],
  )
  // Elsewhere the page is the space's alone.
  let other = parseHTML(await drawn(undefined, false)).document
  assertEquals(
    [...other.querySelectorAll('.Group')].map((g) => g.textContent),
    ['Requested by agents', 'Connected', 'All services'],
  )
  // Opened on one, it is drawn whole at the top, saying which space it is
  // connected for, and every form there posts to the page it is on.
  let opened = parseHTML(await drawn(undefined, true, 'Weather')).document
  let top = opened.querySelector('#connect')!
  assertStringIncludes(top.textContent!, 'Connected for ada.yaks.fyi')
  assert(top.querySelector('[data-connection="Weather"]'))
  let actions = [...opened.querySelectorAll('form')].filter((f) =>
    f.querySelector('input[name="connection"]')
  ).map((f) => f.getAttribute('action'))
  assertEquals(new Set(actions), new Set(['/manage/ada/connections']))
  // A page opened with `?enable=` posts every form and links every card
  // with it, so the page a post draws again still offers the testing
  // integration.
  let kept = parseHTML(await drawn(['google-calendar'], true, 'Weather'))
    .document
  let posts = [
    ...[...kept.querySelectorAll('form[method="post"]')]
      .map((f) => f.getAttribute('action')!),
    ...[...kept.querySelectorAll('.Card-button')]
      .map((a) => a.getAttribute('href')!),
  ].map((at) => new URL(at, 'https://yaks.fyi'))
    .filter((to) => to.pathname == '/manage/ada/connections')
  assert(posts.length > 3)
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
  instructions: '',
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
      open: asked ? undefined : 'w',
    },
  }, env).text()

// The page as a document, its service connected, and listed or not.
let listed = async (listed = false) =>
  parseHTML(await listing('connected', listed)).document
// What the button a form sends with `value` says.
let pressed = (root: ParentNode, value: string) =>
  root.querySelector(`button[value="${value}"]`)?.textContent

test('connections: how to get a key sits open beside a connection needing one, and closed once connected', async () => {
  let card = async (status: 'needed' | 'connected') =>
    parseHTML(await listing(status)).document
      .querySelector('[data-connection="w"]')!
  assertEquals(how(await card('needed')), { open: true, says: HOW })
  assertEquals(how(await card('connected')), { open: false, says: HOW })
})

test('connections: a service the space added can be changed there, all but where its key goes', async () => {
  let told = [...(await listed()).querySelectorAll('details')].find((d) =>
    d.querySelector('summary')?.textContent == 'Change what Weather says'
  )!
  assertEquals(
    told.querySelector('[name="title"]')?.getAttribute('value'),
    'Weather',
  )
  // What the box holds, read as a browser reads it (linkedom leaves a
  // textarea's entities as they were written).
  let typed = told.ownerDocument.createElement('p')
  typed.innerHTML = told.querySelector('textarea[name="instructions"]')!
    .innerHTML
  assertEquals(
    typed.textContent,
    'Sign up at [weather.test](https://weather.test) & <b>.',
  )
  assertEquals(pressed(told, 'about'), 'Save')
  assertEquals(told.querySelector('[name="hosts"]'), null)
})

test('connections: a service the space added is listed in the integration directory from there, or taken out', async () => {
  assertEquals(
    pressed(await listed(), 'list'),
    'List in the integration directory',
  )
  let out = await listed(true)
  assertEquals(
    out.querySelector('a[href="/integrations#Weather"]')?.textContent,
    'integration directory',
  )
  assertEquals(pressed(out, 'unlist'), 'Take it out')
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
  let top = parseHTML(html).document.querySelector('#connect')!
  let card = top.querySelector('.Card')!
  assertEquals(card.querySelector('h2')?.textContent, 'Connect ESV API')
  assertStringIncludes(top.textContent!, 'It will be connected to ada.yaks.fyi')
  assertEquals(how(card), { open: true, says: HOW })
  // Its site is its maker's word, linked as theirs.
  let site = card.querySelector('a[href="https://api.esv.org"]')!
  assertEquals(
    [site.getAttribute('href'), site.getAttribute('rel'), site.textContent],
    ['https://api.esv.org', 'nofollow ugc', 'Service homepage'],
  )
  assertEquals(
    card.querySelector<HTMLInputElement>('[name=integration]')!.value,
    'ESV',
  )
  assertEquals(
    card.querySelector('button[value=add]')!.textContent,
    'Connect',
  )
})

// An app's use of a connection, as a row draws it.
let used = (over: Partial<Using> = {}): Using => ({
  app: 'notes',
  title: 'Notes',
  slug: 'notes',
  binding: 'WEATHER',
  direct: false,
  anyone: false,
  each: false,
  calls: 0,
  cap: null,
  lends: null,
  borrower: null,
  ...over,
})
// Each button on the first card matching `at`, read off its markup (a
// document costs a millisecond to parse): its label, its `do`, and the app and
// cap its form posts, the form a `form` attribute names or the one around it.
let buttons = async (
  at: string,
  connections: Partial<Connections>,
  open: string,
) => {
  let html = await desk({
    ...page,
    view: 'connections',
    connections: {
      on: true,
      borrowed: [],
      list: [],
      services: [],
      built: [],
      open,
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
  }, 'w')
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
    app: used({ app: 'copy', calls: 3, cap: 100 }),
  }
  let replaced = async (borrowed: Borrowed, list: Shown[] = []) => {
    let { text, pressed } = await buttons('data-borrowed=', {
      borrowed: [borrowed],
      list,
    }, 'lent')
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
    ]
  ) assertStringIncludes(html, text)
  assertEquals(
    faced(parseHTML(html).document.querySelector('.Card')!),
    drawn,
  )
})

test('connections: a built integration is offered by its face, and a site is linked only at https', async () => {
  let offered = async (site: string, asked = false) =>
    await desk({
      ...page,
      view: 'connections',
      connections: {
        on: true,
        borrowed: [],
        list: [],
        services: [],
        built: [{ name: 'cal', keyed: false, face: { ...CAL, site } }],
        ...asked
          ? { asked: { name: 'cal', keyed: false, face: { ...CAL, site } } }
          : {},
      },
    }, env).text()
  // A card in the grid: its logo, name and line, and Connect.
  let tile = parseHTML(await offered(CAL.site)).document
    .querySelector('[data-found] .Card')!
  assertEquals(tile.querySelector('h2')!.textContent, 'Cal')
  assertEquals(
    tile.getAttribute('href'),
    '/manage/ada/connections?add=cal#connect',
  )
  // Pressed, the page draws it whole: its site linked by its host.
  let card = parseHTML(await offered(CAL.site, true)).document
    .querySelector('#connect .Card')!
  assertEquals(card.querySelector('h2')!.textContent, 'Connect Cal')
  assertEquals(
    card.querySelector('img.Card_Mark')!.getAttribute('src'),
    drawn.logo,
  )
  assertEquals(
    card.querySelector('a[href="https://cal.test/"]')?.textContent,
    'Service homepage',
  )
  assertEquals(
    (await offered('javascript:alert(1)', true)).includes('alert'),
    false,
  )
})

test('paid plan settings describe unlimited apps', async () => {
  for (let tier of ['plus', 'pro'] as const) {
    const html = await desk({
      ...page,
      view: 'billing',
      plan: { tier, ends: '', known: true },
    }, env).text()
    assertStringIncludes(html, 'Unlimited apps')
    assertEquals(html.includes('null apps'), false)
    assertEquals(html.includes('data-door="checkout"'), false, tier)
  }
})

test('a space on the Plus plan free says through when, and offers to keep it after', async () => {
  let html = await desk({
    ...page,
    view: 'billing',
    plan: {
      tier: 'plus',
      ends: '',
      known: false,
      free: '2026-12-05T15:00:00.000Z',
    },
  }, env).text()
  assertStringIncludes(html, 'free through 5 December 2026')
  assertStringIncludes(html, 'Keep the Plus plan for ada — $9 a month')
})

test('the plan card offers the Pro plan only where it is on sale', async () => {
  let card = (pro: ('month' | 'year')[]) =>
    desk({
      ...page,
      view: 'billing',
      plan: { tier: 'free', ends: '', known: false, pro },
    }, env).text()
  let none = await card([])
  assertStringIncludes(none, 'Get the Plus plan for ada — $9 a month')
  assertEquals(none.includes('data-plan="pro"'), false)
  assertStringIncludes(none, 'The Pro plan is not on sale here yet')
  let both = await card(['month', 'year'])
  assertStringIncludes(
    both,
    'Get the Pro plan for ada — $49 a month',
  )
  assertStringIncludes(both, 'data-plan="pro" data-per="year"')
  assertStringIncludes(
    both,
    'Get the Pro plan for ada — $490 a year',
  )
  assertEquals(both.includes('not on sale'), false)
})

// The Billing page (T-131895): the space's allowances and its use of each,
// and whom it is billed to.
test('billing shows each allowance and whom it bills', async () => {
  let GB = 1024 ** 3
  let limits = {
    apps: { used: 3, limit: 5 },
    requests: { used: 41_000, limit: 50_000 },
    bytes: { used: 0, limit: GB },
    files: { used: GB, limit: GB },
    emails: { used: 12, limit: 100 },
    builds: { used: 1, limit: 5 },
    seconds: { used: 90, limit: 3_600 },
  }
  let billing = (bill: Partial<NonNullable<DeskPage['bill']>>, known = false) =>
    desk({
      ...page,
      spaces: [{ slug: 'ada', title: 'Ada’s kitchen', owner: true, own: true }],
      view: 'billing',
      provider: 'Paybox',
      plan: { tier: known ? 'plus' : 'free', ends: '', known },
      bill: {
        limits,
        budget: { spent: 0.05, limit: 0.2 },
        read: '2026-11-03T14:00:00.000Z',
        ...bill,
      },
    }, env).text()
  let one = await billing({})
  for (
    let text of [
      'Get the Plus plan for Ada’s kitchen — $9 a month',
      'Nothing is billed.',
      'last read at 14:00 UTC',
      '3 of 5',
      '41,000 of 50,000',
      '12 of 100',
      '25% used',
    ]
  ) assertStringIncludes(one, text)
  // Four fifths of request units is near; all of the files is at the limit.
  assertStringIncludes(one, 'Near the limit')
  assertStringIncludes(one, 'At the limit')
  assertStringIncludes(
    await billing({ read: null }),
    'None counted yet this month, of 50,000',
  )
  let paying = await billing({
    payer: { email: 'ada@x.test', name: 'Ada' },
  }, true)
  assertStringIncludes(
    paying,
    'Billed to <b>ada@x.test</b> (Ada) through Paybox',
  )
  assertStringIncludes(
    await billing({ payer: undefined }, true),
    'Billed through Paybox.',
  )
})

// The selling card names the payment provider it was lent, at every stage.
test('selling names the provider it sells through', async () => {
  let selling = (at: Partial<DeskPage>) =>
    desk({ ...page, view: 'selling', provider: 'Paybox', ...at }, env).text()
  for (
    let [at, text] of [
      [{ paying: true }, 'Connect your Paybox account'],
      [{ paying: true, sell: 'ready' }, 'Disconnect Paybox'],
      [{ paying: false, fee: '1%' }, 'plus Paybox processing fees'],
    ] as const
  ) assertStringIncludes(await selling(at), text)
  assertStringIncludes(
    await selling({ provider: undefined }),
    'Selling is not available here yet.',
  )
})

test('a service detail URL is a server-open modal with its pitch, access, provider, space and Connect form', async () => {
  for (let keyed of [false, true]) {
    let face = {
      ...CAL,
      tagline: 'Team calendars',
      description: 'Cal keeps a team’s appointments together.',
      details:
        'Read calendars and create events. Access depends on the account and granted permissions.',
      docs: 'https://cal.test/docs',
      connects: keyed ? 'key' as const : 'signin' as const,
      broker: 'nango',
    }
    let catalog = {
      q: 'calendar',
      found: [],
      featured: [],
      total: 1,
      matched: 0,
      kinds: [],
    }
    let html = await desk({
      ...page,
      view: 'connections',
      connections: {
        on: true,
        list: [],
        services: [],
        borrowed: [],
        built: [],
        enable: ['cal'],
        catalog,
        asked: { name: 'cal', keyed, face },
      },
    }, env).text()
    let { document } = parseHTML(html)
    let modal = document.querySelector('dialog[open]')!
    assert(modal)
    assertEquals(modal.id, 'connect')
    for (
      let text of [
        face.tagline,
        face.description,
        face.details,
        `Connects with ${keyed ? 'API key' : 'OAuth'} through Nango.`,
        'It will be connected to ada.yaks.fyi',
      ]
    ) {
      assertStringIncludes(modal.textContent!, text)
    }
    assertEquals(
      modal.querySelector('a[href="https://cal.test/"]')?.textContent,
      'Service homepage',
    )
    assertEquals(
      modal.querySelector('a[href="https://cal.test/docs"]')?.textContent,
      'Integration docs',
    )
    let form = modal.querySelector('form')!
    assertEquals(form.getAttribute('method'), 'post')
    assertEquals(
      form.querySelector('input[name=integration]')?.getAttribute('value'),
      'cal',
    )
    assertEquals(form.querySelector('button[name=do]')?.textContent, 'Connect')
    assertEquals(!!form.querySelector('input[type=password]'), keyed)
    let back = '/manage/ada/connections?enable=cal&q=calendar'
    assertEquals(form.getAttribute('action'), back)
    assertEquals(
      modal.querySelector('[data-modal-close]')?.getAttribute('href'),
      back,
    )
    assertEquals(
      modal.querySelector('.Modal_Backdrop')?.getAttribute('href'),
      back,
    )
    assert(document.querySelector('[data-connections]')?.hasAttribute('inert'))
    assert(!modal.closest('[inert]'))
    assertStringIncludes(html, '/modal.js')
  }
})

test('a catalog service without a connectable host still opens its details', async () => {
  let html = await desk({
    ...page,
    view: 'connections',
    connections: {
      on: true,
      list: [],
      services: [],
      borrowed: [],
      built: [],
      asked: {
        name: 'cal',
        keyed: false,
        available: false,
        face: {
          ...CAL,
          description: 'A calendar service.',
          details:
            'This provider does not expose an API host for this service.',
          docs: 'https://cal.test/docs',
        },
      },
    },
  }, env).text()
  let modal = parseHTML(html).document.querySelector('dialog[open]')!
  assertStringIncludes(modal.textContent!, 'A calendar service.')
  assertStringIncludes(modal.textContent!, 'does not expose an API host')
  assert(modal.querySelector('a[href="https://cal.test/docs"]'))
  assertEquals(modal.querySelector('button[disabled]')?.textContent, 'Connect')
  assertEquals(modal.querySelector('form'), null)
})

import { test } from '@yaks/testing'
import { pageRow } from '@yaks/platform/connections-page'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { fieldsOf, KEY, keyed, seeds, type Status } from '@yaks/connections'
import { type DeskPage, lost, spaceBinned, spaceIndex } from './pages.ts'
import { askCode, askConnect, askEmail } from './signin-pages.ts'
import { desk } from './desk-pages.ts'
import type {
  Borrowed,
  Connections,
  Shown,
  Using,
} from '@yaks/platform/connections-page'
import { drawn as theirs } from './theirs.ts'
import { STARTER } from '@yaks/platform/plans'

let env = { APEX: 'yaks.fyi' }
// A service as a page draws it, bare but for its name.
let named = (title: string) => ({
  name: title.toLowerCase(),
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
  name: 'cal',
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
let page: DeskPage = { space: 'ada', apps: [] }

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

// What a sign-in card reads, start to end, and the picture it shows.
let reads = async (response: Response) => {
  let { document } = parseHTML(await response.text())
  let main = document.querySelector('main')!
  return {
    says: [...main.querySelectorAll('h1, p')].map((p) => p.textContent),
    picture: main.querySelector('img.Pictured_Image')?.getAttribute('src'),
  }
}

test('pages: a stranger signing in for a copy reads which app it is of', async () => {
  let copy = { title: 'Recipe box', image: 'https://yaks.fyi/r.png' }
  assertEquals(
    await reads(askEmail({ copy: { ...copy, free: true } }, env)),
    {
      says: [
        'Your own copy of Recipe box',
        'Free, at your own address, with your own data.',
        `Enter your email to get a sign-in code. Once you're in, your copy is one press away. Signing up is free, with $${STARTER} of building credit.`,
      ],
      picture: copy.image,
    },
  )
  assertEquals(
    (await reads(
      askEmail({ copy: { ...copy, free: true, pressed: true } }, env),
    ))
      .says[2],
    `Enter your email to get a sign-in code. The code is the last step to your copy. Signing up is free, with $${STARTER} of building credit.`,
  )
  let sold = await reads(
    askEmail({ copy: { title: 'Recipe box', free: false } }, env),
  )
  assertEquals(sold.says[1], 'At your own address, with your own data.')
  assertEquals(sold.picture, undefined)
  assertEquals((await reads(askEmail({}, env))).says.slice(0, 2), [
    'Sign in or sign up',
    'Build, host and share web apps.',
  ])
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
    desk({ ...page, view: 'agents' }, env),
    [
      'https://yaks.fyi/mcp',
      'https://yaks.fyi/mcp?auth=required',
      'https://yaks.fyi/oauth/authorize',
      'https://yaks.fyi/oauth/token',
      'https://yaks.fyi/oauth/register',
      'https://yaks.fyi/yaks-app.png',
      'Connect another agent',
    ],
  )
})

test('pages: only production offers its repository marketplace shortcut', async () => {
  for (let host of [{}, env]) {
    let html = await desk({ ...page, view: 'agents' }, host).text()
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
      drawn: [pageRow('space', '', {
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
          title: '',
          lacking: [],
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
      })],
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
    title: '',
    lacking: [],
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
      drawn: [pageRow('space', '', {
        on: true,
        borrowed: [],
        list: [
          ...own ? [shown('Mail', true)] : [],
          shown('Weather'),
          shown('Maps', false, 'needed'),
          // Begun on this page and not finished: nobody's ask.
          { ...shown('Discord', false, 'needed'), apps: [] },
        ],
        services: [],
        built: [{ name: 'openrouter', keyed: true, face: named('OpenRouter') }],
        enable,
        open,
      })],
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
    ['Maps', '/manage/ada/connections#Maps'],
  ])
  assertEquals(under(groups[1]), [
    ['Mail', '/manage/ada/connections#Mail'],
  ])
  assertEquals(under(groups[2]), [
    ['Weather', '/manage/ada/connections#Weather'],
  ])
  assertEquals(
    [...document.querySelectorAll('[data-found] .Card h2')]
      .map((h) => h.textContent),
    ['OpenRouter'],
  )
  // A card whose service has no logo leads with the neutral mark.
  for (let card of document.querySelectorAll('.Card-button')) {
    assert(card.firstElementChild?.matches('.Card_Mark.Logo_Mark-none'))
  }
  // Nothing on the first visit asks for a key but the fold for a service
  // nobody lists.
  assertEquals(
    [...document.querySelectorAll('input[type="password"]')]
      .filter((input) => !input.closest('[hidden]'))
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
  assert(top.querySelector('.Card_Mark.Logo_Mark-none'))
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
  title: '',
  lacking: [],
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
    drawn: [pageRow('space', '', {
      on: true,
      borrowed: [],
      list: [added(status, listed)],
      services: [],
      built: [],
      asked,
      open: asked ? undefined : 'w',
    })],
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
  assertEquals(
    told.querySelector('form[data-save] [name=do]')?.getAttribute('value'),
    'about',
  )
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
    drawn: [pageRow('space', '', {
      on: true,
      borrowed: [],
      list: [],
      services: [],
      built: [],
      open,
      ...connections,
    })],
  }, env).text()
  let { document } = parseHTML(html)
  let card = document.querySelector(`[${at}"${open}"]`)!
  let value = (el: Element | null) => el?.getAttribute('value') ?? undefined
  return {
    text: card.textContent ?? '',
    pressed: [...card.querySelectorAll('form button')].map((b) => {
      let named = b.getAttribute('form')
      let form = named ? document.getElementById(named)! : b.closest('form')!
      return [
        b.textContent,
        value(b),
        value(form.querySelector('[name="app"]')),
        value(form.querySelector('[name="cap"]')),
      ]
    }),
  }
}

test('connections: retained credentials offer restore and a separate confirmation page', async () => {
  let html = await desk({
    ...page,
    view: 'connections',
    drawn: [pageRow('space', '', {
      on: true,
      list: [],
      borrowed: [],
      services: [],
      built: [],
      trash: [{ id: 'saved', integration: 'Weather', at: 1 }],
    })],
  }, env).text()
  let document = parseHTML(html).document
  let restore = document.querySelector('button[value="restore-credential"]')!
  assertEquals(
    restore.closest('form')?.getAttribute('action'),
    '/manage/ada/connections?trash=1',
  )
  assertEquals(
    restore.closest('form')?.querySelector('input[name="retained"]')
      ?.getAttribute('value'),
    'saved',
  )
  assertEquals(
    document.querySelector('a[href*="/confirm/credentialerase/"]')
      ?.getAttribute('href'),
    '/space/ada/confirm/credentialerase/saved',
  )
})

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
  assertEquals(await replaced(lent), [open])
  assertEquals(await replaced({ ...lent, keyed: false }), [
    ['Connect your own', 'own', 'copy', undefined],
    open,
  ])
  assertEquals(await replaced(lent, [added('connected')]), [
    ['Use your own', 'attach', 'copy', undefined],
    open,
  ])
})

test('connection dialogs have one card: its title and close in its head, what acts on the connection in a card at the top of its main pane', async () => {
  let cases: Partial<Connections>[] = [
    ...(['connected', 'needed'] as const).map((status) => ({
      list: [{ ...added(status), face: CAL }],
      open: 'w',
    })),
    {
      borrowed: [{
        eid: 'lent',
        integration: 'Weather',
        face: CAL,
        keyed: true,
        hosts: ['api.weather.test'],
        lender: 'Jeff',
        app: used(),
      }],
      open: 'lent',
    },
    ...[true, false].map((keyed) => ({
      asked: { name: 'cal', keyed, face: CAL },
    })),
  ]
  for (let over of cases) {
    let html = await desk({
      ...page,
      view: 'connections',
      drawn: [pageRow('space', '', {
        on: true,
        list: [],
        borrowed: [],
        services: [],
        built: [],
        ...over,
      })],
    }, env).text()
    let { document } = parseHTML(html)
    let modal = document.querySelector('dialog[open]')!
    assertEquals(modal.querySelectorAll('.Card').length, 1)
    let body = modal.querySelector('.Modal_Body.Card')!
    let head = body.firstElementChild!
    assert(head.matches('.Card_Head'))
    assertEquals(
      head.querySelector('.Card_Title')?.textContent,
      over.asked ? 'Connect Cal' : 'Cal',
    )
    assert(head.querySelector('.Card_Mark'))
    if (!over.asked) assert(head.querySelector('.State'))
    if (over.list?.[0].status == 'connected') {
      let acts = body.querySelector('.Modal_Main > .Modal_Actions')!
      assertEquals(pressed(acts, 'disconnect'), 'Disconnect')
      assertEquals(pressed(head, 'disconnect'), undefined)
    }
    let close = head.querySelector('.Card_Actions [data-modal-close]')!
    assert(close.querySelector('svg.Icon'))
    assertEquals(close.textContent, '')
    assertEquals(close.getAttribute('data-tip'), 'Close')
    assertEquals(close.getAttribute('aria-label'), 'Close connection details')
    assertEquals(close.getAttribute('href'), '/manage/ada/connections#')
  }
})

test('a connection signed in to reconnects in place, from its card and its dialog, and says when it lacks access', async () => {
  let drawn = async (over: Partial<Shown>) => {
    let one = {
      ...added('connected'),
      keyed: false,
      account: '81384788765712384',
      title: 'Yak Barn',
      scopes: ['bot'],
      ...over,
    } as Shown
    let html = await desk({
      ...page,
      view: 'connections',
      drawn: [pageRow('space', '', {
        on: true,
        borrowed: [],
        list: [one],
        services: [],
        built: [],
        open: 'w',
      })],
    }, env).text()
    let { document } = parseHTML(html)
    let dialog = document.querySelector('[data-connection="w"]')!
    let tile = document.querySelector('.Cards .Card')!
    let button = (at: Element) => at.querySelector('button[value="reconnect"]')
    return { dialog, tile, button }
  }
  let full = await drawn({})
  let acts = full.dialog.querySelector('.Modal_Actions')!
  assertEquals(full.button(acts)?.textContent, 'Reconnect')
  assert(!full.button(acts)!.className.includes('go'))
  assertEquals(full.button(full.tile)?.textContent, 'Reconnect')
  assert(full.tile.querySelector('.Card_Link[href$="#Weather"]'))
  assertStringIncludes(full.dialog.textContent!, 'Connected as Yak Barn')
  assert(!full.dialog.textContent!.includes('81384788765712384'))
  assert(!full.dialog.textContent!.includes('Reconnect to give it full access'))

  let short = await drawn({ lacking: ['identify'] })
  assertStringIncludes(
    short.dialog.textContent!,
    'Reconnect to give it full access.',
  )
  assertStringIncludes(
    short.tile.textContent!,
    'Reconnect to give it full access.',
  )
  assert(short.button(short.dialog)!.className.includes('go'))

  // A refused one signs in again the same way, in place of Connect.
  let broken = await drawn({ status: 'broken' })
  assert(broken.button(broken.dialog))
  assertEquals(broken.dialog.querySelector('button[value="signin"]'), null)

  // A key is replaced, not signed in to again.
  let keyed = await drawn({ keyed: true })
  assertEquals(keyed.button(keyed.dialog), null)
  assertEquals(keyed.button(keyed.tile), null)
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

// Every built service a key is pasted for, as its connect page draws it: each
// step of how to get the key one list item read as a sentence, and each box
// showing what its field looks like, or a row of dots.
test('askConnect: every built key service says its steps as sentences, and shows its key shape', async () => {
  for (let i of seeds().filter(keyed)) {
    let { document } = parseHTML(
      await askConnect({
        app: 'Notes',
        face: {
          ...named(i.title ?? i.name),
          instructions: await theirs(i.instructions),
          fields: fieldsOf(i),
        },
        keyed: true,
        on: true,
        status: 'needed',
        back: 'https://ada.yaks.fyi/notes/',
      }, env).text(),
    )
    for (let li of document.querySelectorAll('.More_Body .Body_Item')) {
      assert(/^\S.*[.:)]$/.test(li.textContent!.trim()), li.outerHTML)
      for (let c of li.children) {
        assert(['A', 'STRONG', 'EM', 'CODE'].includes(c.tagName), li.outerHTML)
      }
    }
    assertEquals(
      [...document.querySelectorAll('input[name^=key]')].map((b) =>
        b.getAttribute('placeholder')
      ),
      fieldsOf(i).map((f) => f.example ?? '••••••••'),
      i.name,
    )
  }
  let shapes = Object.fromEntries(
    seeds().map((i) => [i.name, fieldsOf(i).map((f) => f.example)]),
  )
  assertEquals(shapes.elevenlabs, ['sk_••••••••'])
  assertEquals(shapes.anthropic, ['sk-ant-••••••••'])
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
      drawn: [pageRow('space', '', {
        on: true,
        borrowed: [],
        list: [],
        services: [],
        built: [{ name: 'cal', keyed: false, face: { ...CAL, site } }],
        ...asked
          ? { asked: { name: 'cal', keyed: false, face: { ...CAL, site } } }
          : {},
      })],
    }, env).text()
  // A card in the grid: its logo, name and line, and Connect.
  let tile = parseHTML(await offered(CAL.site)).document
    .querySelector('[data-found] .Card')!
  assertEquals(tile.querySelector('h2')!.textContent, 'Cal')
  assertEquals(
    tile.querySelector('img.Card_Mark')!.getAttribute('src'),
    drawn.logo,
  )
  assertEquals(
    tile.getAttribute('href'),
    '/manage/ada/connections#cal',
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
  let unsafe = parseHTML(await offered('javascript:alert(1)', true)).document
    .querySelector('#connect .Card')!
  assertEquals(unsafe.querySelector('a[href^="javascript:"]'), null)
  assertEquals(unsafe.textContent.includes('Service homepage'), false)
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
      drawn: [pageRow('space', '', {
        on: true,
        list: [],
        services: [],
        borrowed: [],
        built: [],
        enable: ['cal'],
        catalog,
        asked: { name: 'cal', keyed, face },
      })],
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
    // A sign-in through the broker opens its page in a new tab.
    assertEquals(
      form.querySelector('button[name=do]')?.getAttribute('formtarget'),
      keyed ? null : '_blank',
    )
    assertEquals(!!form.querySelector('input[type=password]'), keyed)
    let back = '/manage/ada/connections?enable=cal&q=calendar'
    assertEquals(form.getAttribute('action'), back)
    assertEquals(
      modal.querySelector('[data-modal-close]')?.getAttribute('href'),
      `${back}#`,
    )
    assertEquals(
      modal.querySelector('.Modal_Backdrop')?.getAttribute('href'),
      `${back}#`,
    )
    assert(document.querySelector('[data-connections]')?.hasAttribute('inert'))
    assert(!modal.closest('[inert]'))
    assertStringIncludes(html, '/_connections.')
  }
})

test('a catalog service without a connectable host still opens its details', async () => {
  let html = await desk({
    ...page,
    view: 'connections',
    drawn: [pageRow('space', '', {
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
    })],
  }, env).text()
  let modal = parseHTML(html).document.querySelector('dialog[open]')!
  assertStringIncludes(modal.textContent!, 'A calendar service.')
  assertStringIncludes(modal.textContent!, 'does not expose an API host')
  assert(modal.querySelector('a[href="https://cal.test/docs"]'))
  assertEquals(modal.querySelector('button[disabled]')?.textContent, 'Connect')
  assertEquals(modal.querySelector('form'), null)
})

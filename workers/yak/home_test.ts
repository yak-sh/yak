// A space's dashboard and front door, drawn straight: pages.ts `desk` and
// `spaceIndex` are pure, so every state a person passes through is one call
// here. The address itself, served by the kernel, is home_kernel_test.ts's.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { spaceIndex } from './pages.ts'
import { desk } from './desk-pages.ts'
import { managePath } from './route.ts'

// The dashboard itself, drawn straight (pages.ts `desk` is pure): the order
// it puts its blocks in, and what stands where the connect steps were. Every
// state a person passes through is one call here — landed, connected,
// something built — where reaching each through the kernel is a sign-in, an
// OAuth grant and an app apiece (identity_test.ts holds those ends).
let block = (
  at: Partial<Parameters<typeof desk>[0]> = {},
  env: Parameters<typeof desk>[1] = {},
) => desk({ space: 'dana', apps: [], name: 'dana', ...at }, env).text()

// The space's front door, which anybody may be shown.
let face = (at: Partial<Parameters<typeof spaceIndex>[0]> = {}) =>
  spaceIndex({
    space: 'dana',
    title: 'dana',
    apps: [],
    hidden: 0,
    role: null,
    person: false,
    signIn: 'https://yaks.app/login',
    ...at,
  }).text()

// The side's links, by section: the space's, then the person's own, and the
// way back to the Operator over them.
let sides = (html: string) => {
  let { document } = parseHTML(html)
  let links = (nav: string) =>
    [...document.querySelectorAll(`nav[${nav}] a`)].map((a) => ({
      label: a.textContent!.trim(),
      href: a.getAttribute('href'),
    }))
  return {
    document,
    account: links('aria-labelledby="side-account"'),
    space: links('aria-labelledby="side-space"'),
    back: document.querySelector('.Desk_Back'),
    current: document.querySelector('.SideNav [aria-current]')?.textContent
      ?.trim(),
  }
}

// A space of Dana's whose Operator is Pip.
let pip = [{ slug: 'dana', title: '', owner: true, own: true, operator: 'Pip' }]

// The top of the side on one line (T-151731): the way back says "Back to"
// and the Operator's name, the name first so "Back to" is what gives way
// where both do not fit, and says it whole as its name and tooltip; the
// space selector is its tile, its name and a chevron, with no "Change".
test('the side’s top keeps its words to one line, and the selector has no Change', async () => {
  let { document } = parseHTML(
    await block({
      spaces: [
        {
          slug: 'dana',
          title: 'Loch Lomond Allotments',
          owner: true,
          own: true,
          operator: 'Menno',
        },
        { slug: 'grove', title: 'Grove', owner: true, own: false },
      ],
    }),
  )
  let back = document.querySelector('.Desk_Back')!
  assertEquals(
    [back.getAttribute('aria-label'), back.getAttribute('title')],
    ['Back to Menno', 'Back to Menno'],
  )
  assertEquals(
    [...back.querySelectorAll('.Desk_Way > span')].map((s) => s.textContent),
    ['Menno', 'Back to'],
  )
  assertEquals(back.querySelector('.Desk_To')?.textContent, 'Menno')
  let pick = document.querySelector('.Desk_Pick > summary')!
  assertEquals(
    pick.getAttribute('aria-label'),
    'Change space: Loch Lomond Allotments',
  )
  assertEquals(
    pick.getAttribute('title'),
    'Change space: Loch Lomond Allotments',
  )
  assertEquals(pick.querySelector('.Desk_Change')?.textContent, '')
  assert(pick.querySelector('.Desk_Change .Icon'))
  assert(!pick.textContent!.includes('Change'))
})

test('Manage is one side: back to the Operator, the space you manage, then your account', async () => {
  let page = await block({
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
    spaces: pip,
  })
  assertStringIncludes(page, 'href="https://dana.yaks.app/recipes/"')
  let { document, account, space, back } = sides(page)
  assertEquals(back?.getAttribute('aria-label'), 'Back to Pip')
  assertEquals(back?.getAttribute('href'), '/manage/dana')
  assertEquals(document.querySelector('.Desk_Title')?.textContent, 'Manage')
  assertEquals(account, [
    { label: 'Profile', href: '/manage/account/profile' },
    { label: 'Invite a friend', href: '/manage/account/invite' },
    { label: 'Agents', href: '/manage/account/agents' },
    { label: 'Shared with you', href: '/manage/account/shared' },
  ])
  // No Dashboard: the space's own address is its chat.
  assertEquals(space, [
    { label: 'Apps', href: '/manage/dana/apps' },
    { label: 'People', href: '/manage/dana/people' },
    { label: 'Pip, your Operator', href: '/manage/dana/operator' },
    { label: 'Connections', href: '/manage/dana/connections' },
    { label: 'Visits', href: '/manage/dana/visits' },
    { label: 'Billing', href: '/manage/dana/billing' },
    { label: 'Space settings', href: '/manage/dana/settings' },
    { label: 'Trash', href: '/manage/dana/trash' },
  ])
  // Each page is titled as the side names it.
  for (
    let [view, title] of [
      ['operator', 'Pip, your Operator'],
      ['connections', 'Connections'],
      ['settings', 'Space settings'],
      ['invite', 'Invite a friend'],
    ] as const
  ) {
    let { document } = parseHTML(await block({ view, spaces: pip }))
    assertEquals(document.querySelector('h1')?.textContent, title)
  }
  // Where the space's Operator has no name, it is yours.
  assertEquals(
    sides(await block()).back?.getAttribute('aria-label'),
    'Back to your Operator',
  )
  assertStringIncludes(page, 'Connect your agent')
  assertEquals(
    document.querySelector('.Desk_Connect .Button')?.getAttribute('href'),
    managePath('agents'),
  )
  assertEquals(document.querySelector('.Desk_Whose')?.textContent, 'dana')
  // Sign out is the side's one form; the library has none.
  assertEquals(
    document.querySelector('.Desk_Foot form')?.getAttribute('action'),
    'https://yaks.app/logout',
  )
  assert(!document.querySelector('#content form'), page)
  assert(!page.includes('src="/api/build.js"'), page)
})

test("a space's Settings change only the space, and delete it", async () => {
  let { document } = sides(await block({ view: 'settings' }))
  let form = document.querySelector('#content form.Form')!
  assertEquals(form.getAttribute('action'), managePath('settings', 'dana'))
  assertEquals(form.querySelector('[name=name]'), null)
  assert(form.querySelector('[name=space]'))
  assertEquals(
    document.querySelector('.Desk_Danger .Button')?.getAttribute('href'),
    'https://yaks.app/space/dana/delete',
  )
})

test('Profile holds the name, the email and the space opened first', async () => {
  let spaces = [
    { slug: 'dana', title: 'Dana', owner: true, own: true },
    { slug: 'grove', title: 'Grove', owner: true, own: false },
    { slug: 'club', title: 'Club', owner: false, own: false },
  ]
  let { document, current } = sides(
    await block({ view: 'profile', email: 'dana@x.test', spaces }),
  )
  assertEquals(current, 'Profile')
  assertEquals(
    document.querySelector('.Desk_Whose')?.textContent,
    'Your account',
  )
  let form = document.querySelector('#content form')!
  assertEquals(form.getAttribute('action'), managePath('profile'))
  assertEquals(form.querySelector('[name=name]')?.getAttribute('value'), 'dana')
  assertStringIncludes(form.textContent!, 'dana@x.test')
  // Only spaces of their own can open first.
  assertEquals(
    [...form.querySelectorAll('[name=first] option')].map((o) =>
      o.getAttribute('value')
    ),
    ['dana', 'grove'],
  )
})

test('the selector names the space, not its address, and keeps the page when another is chosen', async () => {
  let spaces = [
    { slug: 'dana', title: 'Dana', owner: true, own: true },
    { slug: 'grove', title: 'Locust Grove', owner: true, own: false },
    {
      slug: 'club',
      title: 'Book club',
      owner: false,
      own: false,
      whose: 'Ana',
    },
    { slug: 'quilt', title: 'Quilts', owner: false, own: false },
  ]
  let rows = (html: string) =>
    [...parseHTML(html).document.querySelectorAll('.Desk_Row')].map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent,
      here: a.hasAttribute('aria-current'),
    }))
  let page = await block({ view: 'billing', space: 'grove', spaces })
  assertEquals(
    parseHTML(page).document.querySelector('summary.Desk_Space')?.textContent,
    'LLocust Grove',
  )
  assertEquals(rows(page), [
    {
      href: '/manage/dana/billing',
      text: 'DDana',
      here: false,
    },
    {
      href: '/manage/grove/billing',
      text: 'LLocust Grove✓',
      here: true,
    },
    // A space they are a member of opens at its Operator.
    {
      href: '/manage/club/operator',
      text: 'BBook clubAna’s space · you’re a member',
      here: false,
    },
    // One whose owner has no name says only that.
    {
      href: '/manage/quilt/operator',
      text: 'QQuiltsYou’re a member',
      here: false,
    },
  ])
  // On a page of their own, choosing a space stays on it.
  assertEquals(
    rows(await block({ view: 'shared', space: 'grove', spaces }))[0].href,
    '/manage/account/shared?space=dana',
  )
  // With one space there is nothing to change, only a way to make another.
  let alone = parseHTML(await block({ spaces: [spaces[0]] })).document
  assertEquals(alone.querySelector('.Desk_Pick'), null)
  assertEquals(
    alone.querySelector('.Desk_New')?.getAttribute('href'),
    '/manage/account/space',
  )
})

test('the Operator page is drawn beside the side, which a member sees with only the Operator', async () => {
  let owner = sides(
    await block({ view: 'operator', operator: '<p id="ask">Ask</p>' }),
  )
  assertEquals(owner.current, 'Your Operator')
  assertEquals(owner.space.length > 1, true)
  assertStringIncludes(
    owner.document.querySelector('#content')!.innerHTML,
    '<p id="ask">Ask</p>',
  )
  let member = sides(await block({ view: 'operator', member: true }))
  assertEquals(member.space.map((l) => l.label), ['Your Operator'])
  assertEquals(member.back?.getAttribute('href'), '/manage/dana')
  assertEquals(member.account.length, 4)
  // On the person's own space it is the Operator too.
  let own = sides(
    await block({
      view: 'operator',
      spaces: [{ slug: 'dana', title: 'Dana', owner: true, own: true }],
    }),
  )
  assertEquals(own.current, 'Your Operator')
})

test('on a phone, Menu opens the same side', async () => {
  let { document } = sides(await block({ view: 'people' }))
  let menu = document.querySelector('.Desk_Bar a')!
  assertEquals(menu.textContent, '☰ Menu')
  assertEquals(menu.getAttribute('href'), '#menu')
  assertEquals(document.querySelector('#menu')?.tagName, 'ASIDE')
  assertEquals(
    document.querySelector('.Desk_Where')?.textContent,
    'Peopledana',
  )
})

test('new app exposes separate build and upload forms below the agent route', async () => {
  let page = await block({ view: 'new' })
  let { document } = parseHTML(page)
  let build = document.querySelector('textarea')!
  let upload = document.querySelector('input[type=file]')!
  for (let field of [build, upload]) {
    assert(!field.closest('details, [hidden]'))
    assert(field.hasAttribute('required'))
    assert(field.closest('section')?.querySelector('h2'))
  }
  assertEquals(
    build.closest('form')?.getAttribute('action'),
    'https://dana.yaks.app/api/build',
  )
  assertEquals(
    upload.closest('form')?.getAttribute('action'),
    'https://dana.yaks.app/deploy',
  )
  assertEquals(
    upload.closest('form')?.getAttribute('enctype'),
    'multipart/form-data',
  )
  assert(
    page.indexOf(`href="${managePath('agents')}"`) < page.indexOf('<textarea'),
    page,
  )
})

// The value a page's input named `name` is drawn with, read off the markup
// by where its quotes fall: parsing a whole page into a document takes half a
// millisecond, and a regular expression's first match compiles it.
let quoted = (text: string, from: string) => {
  let at = text.indexOf(from) + from.length
  return at < from.length ? undefined : text.slice(at, text.indexOf('"', at))
}
let field = (html: string, name: string) =>
  quoted(
    html.split('<input').slice(1).map((tag) => tag.slice(0, tag.indexOf('>')))
      .find((tag) => tag.includes(` name="${name}"`)) ?? '',
    ' value="',
  )

test('the app address can be changed from settings whatever the space holds', async () => {
  assertEquals(field(await block({ view: 'settings' }), 'space'), 'dana')
})

// The copy buttons outside the connect card, which holds the link for an
// agent and stays on the page, hidden, until a connection drops.
let asks = (html: string) =>
  [...parseHTML(html).document.querySelectorAll('.Copy_Go')]
    .filter((go) => !go.closest('[data-disconnected]')).length

test('connected empty library offers a copyable request', async () => {
  let page = await block({
    agents: [{
      id: 'chatgpt',
      brand: 'chatgpt',
      name: 'ChatGPT',
      connectedAt: 1,
    }],
  })
  assert(asks(page), page)
  assert(!page.includes('<textarea'), page)
  let built = await block({
    agents: [{
      id: 'chatgpt',
      brand: 'chatgpt',
      name: 'ChatGPT',
      connectedAt: 1,
    }],
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
  })
  assertEquals(asks(built), 0, built)
  for (let html of [page, built]) {
    let { document } = parseHTML(html)
    assertEquals(document.querySelector('.Agents'), null)
    assertEquals(document.querySelector('[data-agent-row]'), null)
    assertEquals(document.querySelector('[data-agent-name]'), null)
    assert(
      document.querySelector('[data-disconnected]')!.hasAttribute('hidden'),
    )
  }
})

test('connected pages show the named client and keep the way to connect another in view', async () => {
  let agents = [{
    id: 'chatgpt',
    brand: 'chatgpt' as const,
    name: 'ChatGPT',
    connectedAt: 1,
  }]
  for (let view of ['new', 'agents'] as const) {
    let { document } = parseHTML(await block({ view, agents }))
    let list = document.querySelector('.Agents')!
    assertStringIncludes(list.textContent!, 'ChatGPT')
    assertEquals(
      list.querySelector('a')?.getAttribute('href'),
      'https://chatgpt.com/',
    )
    assert(!list.querySelector('a[href*="claude.ai"]'))
    for (let el of document.querySelectorAll('[data-disconnected]')) {
      assert(el.hasAttribute('hidden'))
    }
    if (view == 'agents') {
      let another = document.querySelector('.Connect_Setup .Group')!
      assertEquals(another.textContent, 'Connect another agent')
      assert(!another.hasAttribute('hidden'))
      assert(!document.querySelector('details .Tabs'))
    }
  }
  let { document } = parseHTML(await block({ view: 'agents' }))
  assert(
    document.querySelector('.Connect_Setup .Group')!.hasAttribute('hidden'),
  )
  assert(document.querySelector('.Connect_Setup .Tabs'))
})

test('new app tells an agent with no web link what to ask, not an empty list', async () => {
  let page = await block({
    view: 'new',
    agents: [{
      id: 'claude-code',
      brand: 'claude-code',
      name: 'Claude Code',
      connectedAt: 1,
    }],
  })
  let { document } = parseHTML(page)
  let hidden = (cls: string) =>
    document.querySelector(`.${cls}`)!.hasAttribute('hidden')
  assert(!hidden('Desk_Start'))
  assert(hidden('Agents'))
  assertStringIncludes(page, 'chat history')
})

// Who visited (views.ts, T-34497): the owner's block, drawn straight. What
// matters here is that it is the owner's, that it draws itself without a
// script, and that a platform with no analytics token says one sentence rather
// than an empty chart.
let VISITS = {
  slug: 'recipes',
  title: 'Recipes',
  stats: {
    days: 3,
    total: 9,
    daily: [
      { day: '2026-09-04', views: 2 },
      { day: '2026-09-05', views: 0 },
      { day: '2026-09-06', views: 7 },
    ],
    pages: [{ name: '/dinner', views: 6 }],
    from: [{ name: 'news.example.com', views: 4 }],
    countries: [{ name: 'US', views: 9 }],
  },
}

test('who visited: a bar per day and three lists, no script', async () => {
  let page = await block({
    view: 'visits',
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
    views: [VISITS],
    viewDays: 3,
  })
  assertStringIncludes(page, '9 visits')
  // One rect per day, the tallest full height and the empty day absent.
  let bars = page.match(/class="Chart_Bar"/g)
  assertEquals(bars?.length, 3)
  assertStringIncludes(page, 'height="40.00"')
  assertStringIncludes(page, 'height="0.00"')
  // The three lists, and the ends of the axis.
  assertStringIncludes(page, '/dinner')
  assertStringIncludes(page, 'news.example.com')
  assertStringIncludes(page, '>US<')
  assertStringIncludes(page, '4 Sep')
  assertStringIncludes(page, '6 Sep')
  // Nothing here runs: the chart is markup, not a canvas somebody paints.
  assertStringIncludes(page, 'class="Chart Chart-bars"')

  // Not the owner's, not their business: the front door has no such block.
  let theirs = await face({
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
  })
  assert(!parseHTML(theirs).document.querySelector('.Report'))
})

test('who visited: no token is one sentence, no chart', async () => {
  let page = await block({
    view: 'visits',
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
    views: null,
    viewsOff: 'Visitor counts are not switched on for this platform yet.',
  })
  assertStringIncludes(page, 'not switched on')
  assert(
    !page.includes('class="Chart Chart-bars"'),
    'an empty chart is worse than a line',
  )
})

test('who visited: an app nobody opened says so', async () => {
  let page = await block({
    view: 'visits',
    apps: [{ eid: 'recipes', slug: 'recipes', title: 'Recipes' }],
    views: [{
      ...VISITS,
      stats: {
        ...VISITS.stats,
        total: 0,
        daily: [],
        pages: [],
        from: [],
        countries: [],
      },
    }],
  })
  let { document } = parseHTML(page)
  assertEquals(document.querySelector('.Report_Total')?.textContent, '0 visits')
  assert(!page.includes('class="Chart Chart-bars"'), page)
})

test('trash has restore forms only on its own page', async () => {
  let trash = [{
    eid: '6abfba87-7e72-42d6-b954-73aa236acb14',
    slug: 'notes',
    title: 'Notes',
    days: 12,
  }]
  let page = await block({ view: 'trash', trash })
  assertStringIncludes(page, `action="${managePath('trash', 'dana')}"`)
  assertStringIncludes(page, `name="restore" value="${trash[0].eid}"`)
  assertStringIncludes(page, '12 days left')
  let other = await block({ trash })
  assert(!other.includes('name="restore"'), other)
  assert(!other.includes('Notes'), other)
})

test("none of the dashboard is anybody else's", async () => {
  for (let role of [null, 'editor', 'owner']) {
    let page = await face({ role, person: !!role })
    assert(!page.includes('name="name"'), page)
    assert(!/class="[^"]*\bCopy_Go\b/.test(page), page)
    assert(!page.includes('class="SideNav"'), page)
  }
})

test('Billing is a management page beside Settings with space checkout and portal', async () => {
  let settings = await block({ view: 'settings' })
  assertStringIncludes(settings, `href="${managePath('billing', 'dana')}"`)
  let { document: profile } = parseHTML(settings)
  assertEquals(profile.querySelector('.Settings_Tabs'), null)
  assertEquals(
    profile.querySelector('.SideNav [aria-current]')?.getAttribute('href'),
    managePath('settings', 'dana'),
  )
  for (let plus of [false, true]) {
    let page = await block({
      view: 'billing',
      plan: {
        tier: plus ? 'plus' : 'free',
        known: true,
        ends: '2026-10-01T00:00:00Z',
      },
    })
    let { document } = parseHTML(page)
    assertEquals(!!document.querySelector('[data-door="checkout"]'), !plus)
    assertEquals(
      document.querySelector('[data-door="portal"]')?.getAttribute(
        'data-target',
      ),
      managePath('billing', 'dana'),
    )
    assertEquals(
      document.querySelector('.SideNav [aria-current]')?.getAttribute('href'),
      managePath('billing', 'dana'),
    )
    assertEquals(document.querySelector('.Settings_Tabs'), null)
    assertEquals(
      [...document.querySelectorAll('nav[aria-labelledby="side-space"] a')].map(
        (a) => a.getAttribute('href'),
      ).slice(-4),
      (['visits', 'billing', 'settings', 'trash'] as const).map((view) =>
        managePath(view, 'dana')
      ),
    )
    if (plus) assertStringIncludes(page, 'stops renewing')
  }
})

// A space's dashboard and front door, drawn straight: pages.ts `desk` and
// `spaceIndex` are pure, so every state a person passes through is one call
// here. The address itself, served by the kernel, is home_kernel_test.ts's.
import { test } from '@yaks/testing'
import { planRow } from '@yaks/platform/payment-rows'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { spaceIndex } from './pages.ts'
import { desk } from './desk-pages.ts'
import { binnedRows, settingsRow } from '@yaks/platform/space-pages'
import { managePath } from '@yaks/platform/routes'
import { accountRow } from '@yaks/platform/account-rows'
import { appRows, spaceRows } from '@yaks/platform/side-rows'
import { countRows } from '@yaks/platform/visit-counts'
import { listedRows } from '@yaks/platform/space-apps'
import { type Agent, agentsRow } from '@yaks/platform/agents'

// The dashboard itself, drawn straight (pages.ts `desk` is pure): the order
// it puts its blocks in, and what stands where the connect steps were. Every
// state a person passes through is one call here — landed, connected,
// something built — where reaching each through the kernel is a sign-in, an
// OAuth grant and an app apiece (identity_test.ts holds those ends).
// The Apps, New app and Agents pages are drawn from rows
// (@yaks/platform/space-apps, agents): the apps, and the agents connected
// where they are known.
let block = (
  at: Partial<Parameters<typeof desk>[0]> & { agents?: Agent[] } = {},
  env: Parameters<typeof desk>[1] = {},
) =>
  desk({
    space: 'dana',
    apps: [],
    name: 'dana',
    spaceEid: 'space-dana',
    ...at,
    drawn: at.drawn ?? [
      ...listedRows('person-dana', 'space-dana', at.apps ?? []),
      ...at.agents ? [agentsRow('person-dana', at.agents)] : [],
    ],
  }, env).text()

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
    back: document.querySelector('.Sidebar_Back'),
    current: document.querySelector('.SideNav [aria-current]')?.textContent
      ?.trim(),
  }
}

// A space of Dana's whose Operator is Pip.
let pip = [{
  slug: 'dana',
  title: '',
  owner: true,
  own: true,
  operator: 'Pip',
}]

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
  let back = document.querySelector('.Sidebar_Back')!
  assertEquals(
    [back.getAttribute('aria-label'), back.getAttribute('title')],
    ['Back to Menno', 'Back to Menno'],
  )
  assertEquals(
    [...back.querySelectorAll('.Sidebar_Way > span')].map((s) => s.textContent),
    ['Menno', 'Back to'],
  )
  assertEquals(back.querySelector('.Sidebar_To')?.textContent, 'Menno')
  let pick = document.querySelector('.Menu_Fold > summary')!
  assertEquals(
    pick.getAttribute('aria-label'),
    'Change space: Loch Lomond Allotments',
  )
  assertEquals(
    pick.getAttribute('title'),
    'Change space: Loch Lomond Allotments',
  )
  assertEquals(pick.querySelector('.Identity_Action')?.textContent, '')
  assert(pick.querySelector('.Identity_Action .Icon'))
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
  assertEquals(back?.getAttribute('href'), '/dana/operator')
  assertEquals(document.querySelector('.Sidebar_Title')?.textContent, 'Manage')
  assertEquals(account, [
    { label: 'Profile', href: '/manage/account/profile' },
    { label: 'Friends', href: '/manage/account/friends' },
    { label: 'Invite a friend', href: '/manage/account/invite' },
    { label: 'Agents', href: '/manage/account/agents' },
    { label: 'Shared with you', href: '/manage/account/shared' },
  ])
  // No Dashboard: the space's own address is its chat.
  assertEquals(space, [
    { label: 'Apps', href: '/manage/dana/apps' },
    { label: 'People', href: '/manage/dana/people' },
    { label: 'Operator', href: '/manage/dana/operator' },
    { label: 'Connections', href: '/manage/dana/connections' },
    { label: 'Visits', href: '/manage/dana/visits' },
    { label: 'Billing', href: '/manage/dana/billing' },
    { label: 'Space settings', href: '/manage/dana/settings' },
    { label: 'Domains', href: '/manage/dana/domains' },
    { label: 'Trash', href: '/manage/dana/trash' },
  ])
  // Each page is titled as the side names it.
  for (
    let [view, title] of [
      ['operator', 'Operator'],
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
    document.querySelector('.Card-accent .Button')?.getAttribute('href'),
    managePath('agents'),
  )
  assertEquals(document.querySelector('.Head_Eyebrow')?.textContent, 'dana')
  // Sign out is the side's one form; the library has none.
  assertEquals(
    document.querySelector('.Sidebar_Foot form')?.getAttribute('action'),
    'https://yaks.app/logout',
  )
  assert(!document.querySelector('#content form'), page)
  assert(!page.includes('src="/api/build.js"'), page)
})

test('Profile holds the name, the email and the space opened first', async () => {
  let spaces = [
    { slug: 'dana', title: 'Dana', owner: true, own: true },
    { slug: 'grove', title: 'Grove', owner: true, own: false },
    { slug: 'club', title: 'Club', owner: false, own: false },
  ]
  let drawn = [
    accountRow('dana', { name: 'dana', email: 'dana@x.test', hidden: false }),
    ...spaceRows('dana', spaces.map((s) => ({ ...s, eid: s.slug }))),
  ]
  let { document, current } = sides(
    await block({ view: 'profile', person: 'dana', spaces, drawn }),
  )
  assertEquals(current, 'Profile')
  assertEquals(
    document.querySelector('.Head_Eyebrow')?.textContent,
    'Your account',
  )
  let form = document.querySelector('#content form')!
  assertEquals(form.getAttribute('action'), managePath('profile'))
  assertEquals(
    form.querySelector('[name=name]')?.getAttribute('value'),
    'dana',
  )
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
    [...parseHTML(html).document.querySelectorAll('.Menu_Item')].map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent,
      here: a.hasAttribute('aria-current'),
    }))
  let page = await block({ view: 'billing', space: 'grove', spaces })
  assertEquals(
    parseHTML(page).document.querySelector('summary.Identity')?.textContent,
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
      text: 'LLocust Grove',
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
  assertEquals(alone.querySelector('.Menu_Fold'), null)
  assertEquals(
    alone.querySelector('.Identity_Add')?.getAttribute('href'),
    '/manage/account/space',
  )
})

test('the Operator page is drawn beside the side, which a member sees with only the Operator', async () => {
  let owner = sides(
    await block({ view: 'operator', operator: '<p id="ask">Ask</p>' }),
  )
  assertEquals(owner.current, 'Operator')
  assertEquals(owner.space.length > 1, true)
  assertStringIncludes(
    owner.document.querySelector('#content')!.innerHTML,
    '<p id="ask">Ask</p>',
  )
  let member = sides(await block({ view: 'operator', member: true }))
  assertEquals(member.space.map((l) => l.label), ['Operator'])
  assertEquals(member.back?.getAttribute('href'), '/dana/operator')
  assertEquals(member.account.length, 5)
  // On the person's own space it is the Operator too.
  let own = sides(
    await block({
      view: 'operator',
      spaces: [{ slug: 'dana', title: 'Dana', owner: true, own: true }],
    }),
  )
  assertEquals(own.current, 'Operator')
})

test('on a phone, Menu opens the same side', async () => {
  let { document } = sides(await block({ view: 'people' }))
  let menu = document.querySelector('.Frame_Menu')!
  assertEquals(menu.textContent, 'Menu')
  assert(menu.querySelector('svg.Icon'), 'Menu wears the kit’s icon')
  assertEquals(menu.getAttribute('href'), '#menu')
  assertEquals(document.querySelector('#menu')?.tagName, 'ASIDE')
  assertEquals(
    document.querySelector('.Toolbar_Text')?.textContent,
    'Peopledana',
  )
})

test('new app exposes separate Operator and upload forms below the agent route', async () => {
  let page = await block({ view: 'new' })
  let { document } = parseHTML(page)
  let build = document.querySelector('textarea')!
  let upload = document.querySelector('input[type=file]')!
  for (let field of [build, upload]) {
    assert(!field.closest('details, [hidden]'))
    assert(field.hasAttribute('required'))
    assert(field.closest('section')?.querySelector('h2'))
  }
  // The words go to the space's Operator, as a request for a new app.
  let ask = build.closest('form')!
  assertEquals(ask.getAttribute('action'), managePath('operator', 'dana'))
  assertEquals(ask.getAttribute('enctype'), 'multipart/form-data')
  assert(ask.querySelector('input[name=new_app]'))
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
    }],
  })
  assert(asks(page), page)
  assert(!page.includes('<textarea'), page)
  let built = await block({
    agents: [{
      id: 'chatgpt',
      brand: 'chatgpt',
      name: 'ChatGPT',
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
    }],
  })
  let { document } = parseHTML(page)
  let hidden = (cls: string) =>
    document.querySelector(`.${cls}`)!.hasAttribute('hidden')
  assert(!hidden('Desk_Start'))
  assert(hidden('Agents'))
  assertStringIncludes(page, 'chat history')
})

// Who visited (@yaks/platform/visits-view): the owner's page, drawn from the
// rows it carries for the page graph, and nowhere on the front door.
test('who visited is drawn from the rows the page carries, and only for the owner', async () => {
  let space = 'b0a2c5e1-0000-4000-8000-0000000000a5'
  let recipes = { eid: 'recipes', slug: 'recipes', title: 'Recipes' }
  let counted = {
    days: 3,
    total: 9,
    daily: [{ day: '2026-09-06', views: 9 }],
    pages: [{ name: '/dinner', views: 9 }],
    from: [],
    countries: [],
  }
  let page = await block({
    view: 'visits',
    person: 'dana',
    spaceEid: space,
    drawn: [
      ...appRows('dana', space, [recipes]),
      ...countRows(space, new Map([[recipes.eid, counted]])),
    ],
  })
  let { document } = parseHTML(page)
  let view = document.querySelector('[data-view="visits"]')!
  assertEquals(view.querySelector('.Report_Total')?.textContent, '9 visits')
  assertEquals(
    JSON.parse(view.getAttribute('data-visits-view')!).space,
    space,
  )
  assert(view.querySelector('script[data-page-graph]'), 'carries its rows')
  let theirs = await face({ apps: [{ ...recipes, href: '/recipes/' }] })
  assert(!parseHTML(theirs).document.querySelector('.Report'))
})

test('the trash is drawn from its rows, with Restore, on its own page alone', async () => {
  let space = '6abfba87-7e72-42d6-b954-73aa236acb15'
  let held = {
    settings: [settingsRow(space, {
      slug: 'dana',
      title: 'Dana',
      home: '',
      byline: false,
      paying: false,
      included: false,
    })],
    apps: [],
    page: binnedRows(space, [{
      item: 'notes-eid',
      kind: 'app',
      name: 'Notes',
    }]),
  }
  let spaceView = {
    person: 'ada',
    space,
    page: 'trash' as const,
    apex: 'yaks.app',
  }
  let page = await block({
    view: 'trash',
    person: 'ada',
    spaceView,
    held,
    drawn: [...held.settings, ...held.page],
  })
  let { document } = parseHTML(page)
  assertEquals(
    document.querySelector('[data-restore]')?.getAttribute('data-restore'),
    'notes-eid',
  )
  assertStringIncludes(page, 'data-page-graph')
  let other = await block({ person: 'ada' })
  assert(!other.includes('data-restore'), other)
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
      person: 'p',
      spaceEid: 'e',
      drawn: [planRow('e', {
        tier: plus ? 'plus' : 'free',
        known: true,
        ends: '2026-10-01T00:00:00Z',
        sold: { plus: ['month'], pro: [] },
      })],
    })
    let { document } = parseHTML(page)
    assertEquals(!!document.querySelector('[data-door="checkout"]'), !plus)
    assertEquals(!!document.querySelector('[data-door="portal"]'), true)
    assertEquals(
      document.querySelector('.SideNav [aria-current]')?.getAttribute('href'),
      managePath('billing', 'dana'),
    )
    assertEquals(document.querySelector('.Settings_Tabs'), null)
    assertEquals(
      [...document.querySelectorAll('nav[aria-labelledby="side-space"] a')].map(
        (a) => a.getAttribute('href'),
      ).slice(-5),
      (['visits', 'billing', 'settings', 'domains', 'trash'] as const).map((
        view,
      ) => managePath(view, 'dana')),
    )
    if (plus) assertStringIncludes(page, 'stops renewing')
  }
})
